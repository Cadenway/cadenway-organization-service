import { createHash } from 'node:crypto';
import net from 'node:net';

import {
  GetInvitationInternalResponse,
  InviteMembersInternalResponse,
} from '@cadenway/contracts/validators/internal/organization-service';
import type {
  InvitationBatchResult,
  InvitationState,
} from '@cadenway/contracts/types/internal/organization-service';
import { DATABASE_POOL, SystemTransactionRunner } from '@cadenway/nest-common/database';
import type { TransactionDatabase, TransactionOptions } from '@cadenway/nest-common/database';
import {
  JobProducer,
  JobScheduler,
  JobsRuntimeModule,
  JobWorkerRegistry,
} from '@cadenway/nest-jobs/runtime';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test as NestTest } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import type { Response, Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { jobQueues, PURGE_INVITATION_BATCH_REPLAYS_QUEUE } from '../src/config/job-queues.js';
import { InvitationBatchReplayPurgeCutShortError } from '../src/modules/organizations/application/models/invitations/invitation-batch-replay-purge-cut-short.model.js';
import { distinctAddresses } from '../src/modules/organizations/domain/policies/invitations/invitation-batch.policy.js';
import { InvitationBatchRequest } from '../src/modules/organizations/domain/value-objects/invitations/invitation-batch-request.value-object.js';
import { inlinePurgeOf } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/invitations/drizzle-invitation-batch-replay.repository.js';
import {
  ExpiredInvitationBatchReplays,
  expiredPurgeOf,
} from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/invitations/expired-invitation-batch-replays.repository.js';
import { DiscardableSystemTransactions } from '../src/modules/organizations/infrastructure/persistence/drizzle/transactions/invitations/discardable-system.transaction.js';
import { PurgeInvitationBatchReplaysHandler } from '../src/modules/organizations/presentation/jobs/handlers/invitations/purge-invitation-batch-replays.handler.js';
import { DeclaredErrors } from './support/declared-errors.js';
import type { SeenError } from './support/declared-errors.js';
import { newId, ServiceStack } from './support/service-stack.js';

// The `Idempotency-Key` of `inviteMembers` and the read of one invitation in any state
// (`openapi/internal/organization-service.yaml` of `@cadenway/contracts` 0.45.0), on real
// PostgreSQL and NATS, with the people of the mockup: Camille Martin owns Atelier Nord, Inès Robert
// is its admin and owns Coopérative Lumen, Hugo Dubois is a member of Atelier Nord.

/** An account of identity-service. */
interface Account {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

const camille: Account = {
  id: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
  name: 'Camille Martin',
  email: 'camille.martin@ateliernord.fr',
};
const ines: Account = {
  id: '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31',
  name: 'Inès Robert',
  email: 'ines.robert@ateliernord.fr',
};
const hugo: Account = {
  id: '019a5f3c-a0b1-7c2d-9e3f-5a6b7c8d9e32',
  name: 'Hugo Dubois',
  email: 'hugo.dubois@ateliernord.fr',
};
const marc: Account = { id: newId(), name: 'Marc Roux', email: 'marc.roux@ateliernord.fr' };
const lucie: Account = { id: newId(), name: 'Lucie Bernard', email: 'lucie.bernard@exemple.fr' };

const INVITATIONS = '/internal/v1/invitations';

describe('idempotent invitation batches and the invitation state', () => {
  const atelierNordId: string = newId();
  const lumenId: string = newId();
  let stack: ServiceStack;
  let app: NestExpressApplication;

  /** Every client error a route answered, checked against the contract at the end. */
  const errors: SeenError[] = [];

  /** The outcome of the first keyed batch, which the later replays answer. */
  let first: InvitationBatchResult;

  /**
   * Sends a request as the gateway would, for a user and the organization of their session.
   *
   * @param method - HTTP method.
   * @param path - Path of the route.
   * @param account - The user.
   * @param organizationId - The organization of the token, or `null`.
   * @param options - The body and the extra headers.
   * @returns The response.
   */
  async function call(
    method: 'get' | 'post' | 'delete',
    path: string,
    account: Account,
    organizationId: string | null,
    options: { readonly body?: object; readonly key?: string } = {},
  ): Promise<Response> {
    let pending: Test = request(app.getHttpServer())
      [method](path)
      .set('Authorization', await stack.bearer(account.id, organizationId));
    if (options.key !== undefined) {
      pending = pending.set('Idempotency-Key', options.key);
    }
    const response: Response = await (options.body === undefined
      ? pending
      : pending.send(options.body));
    const code: unknown = (response.body as { code?: unknown } | undefined)?.code;
    if (response.status >= 400 && response.status < 500 && typeof code === 'string') {
      errors.push({ method, path, status: response.status, code });
    }
    return response;
  }

  /**
   * Invites addresses with a key.
   *
   * @param account - The sender.
   * @param organizationId - The organization of the token.
   * @param key - The `Idempotency-Key`.
   * @param emails - The addresses.
   * @param role - The role.
   * @returns The response.
   */
  function invite(
    account: Account,
    organizationId: string,
    key: string,
    emails: readonly string[],
    role: 'admin' | 'member' | 'guest' = 'member',
  ): Promise<Response> {
    return call('post', INVITATIONS, account, organizationId, { body: { emails, role }, key });
  }

  /**
   * Sends two different batches under one key at once and settles both against the winner. The
   * loser answers `422` when it reads the winner's reservation, but under load it can give up on
   * the 100 ms key lock the winner's reservation holds and answer the retryable `409` instead, as
   * the contract allows; once both answered, the winner's record is committed, so the loser's
   * retry (the same request) must answer `422`.
   *
   * @param send - Sends one of the two batches, by its index.
   * @returns The two final responses, in the order of their indexes.
   */
  async function contend(send: (index: 0 | 1) => Promise<Response>): Promise<Response[]> {
    const first: Response[] = await Promise.all([send(0), send(1)]);
    return Promise.all(
      first.map((response: Response, index: number) =>
        response.status === 409 &&
        (response.body as { code?: unknown }).code === 'idempotency.request-in-progress'
          ? send(index === 0 ? 0 : 1)
          : Promise.resolve(response),
      ),
    );
  }

  /**
   * Counts rows of an organization.
   *
   * @param text - A `select count(*)::int as count` query with the organization as `$1`.
   * @param organizationId - The organization.
   * @returns The count.
   */
  async function count(text: string, organizationId: string): Promise<number> {
    const rows = await stack.system<{ count: number }>(text, [organizationId]);
    return rows[0]?.count ?? 0;
  }

  /**
   * Builds the error of a purge call cut short, as the composition gives it to the store.
   *
   * @param phase - The phase it stood in.
   * @param trigger - What cut it short.
   * @returns The error.
   */
  function cutShortOf(
    phase: InvitationBatchReplayPurgeCutShortError['phase'],
    trigger: InvitationBatchReplayPurgeCutShortError['trigger'],
  ): InvitationBatchReplayPurgeCutShortError {
    return new InvitationBatchReplayPurgeCutShortError(phase, trigger);
  }

  /**
   * A store of the expired replay records on the pool of the application, as the purge job has.
   *
   * @param pool - The pool its transactions check connections out of.
   * @returns The store.
   */
  function purgeStore(
    pool: pg.Pool = app.get<pg.Pool>(DATABASE_POOL),
  ): ExpiredInvitationBatchReplays {
    return new ExpiredInvitationBatchReplays(new DiscardableSystemTransactions(pool), cutShortOf);
  }

  /** What a batch writes in an organization, to compare before and after a request. */
  async function effects(organizationId: string): Promise<Record<string, number>> {
    return {
      invitations: await count(
        'select count(*)::int as count from invitations where organization_id = $1',
        organizationId,
      ),
      emails: await count(
        'select count(*)::int as count from invitation_emails where organization_id = $1',
        organizationId,
      ),
      events: await count(
        `select count(*)::int as count from outbox_events
         where organization_id = $1 and event_name = 'invitation.issued.v1'`,
        organizationId,
      ),
      replays: await count(
        'select count(*)::int as count from invitation_batch_replays where organization_id = $1',
        organizationId,
      ),
    };
  }

  /**
   * Counts the emails a sender sent in the last 24 hours, under the policy of its ledger.
   *
   * @param account - The sender.
   * @returns The count.
   */
  async function senderEmails(account: Account): Promise<number> {
    const client: pg.PoolClient = await stack.migrator.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.invitation_sender_id', $1::uuid::text, true)`, [
        account.id,
      ]);
      const result = await client.query<{ count: number }>(
        `select count(*)::int as count from invitation_sender_emails where sender_id = $1`,
        [account.id],
      );
      await client.query('commit');
      return result.rows[0]?.count ?? 0;
    } finally {
      client.release();
    }
  }

  /**
   * Sets the role of an active membership of Atelier Nord.
   *
   * @param account - The member.
   * @param role - The role.
   */
  async function setRole(account: Account, role: 'admin' | 'member'): Promise<void> {
    await stack.system(
      `update members set role = $3, version = version + 1
       where organization_id = $1 and user_id = $2 and removed_at is null`,
      [atelierNordId, account.id, role],
    );
  }

  /**
   * The SHA-256 digest, in hexadecimal, the service stores and locks under.
   *
   * @param value - The key or the canonical batch.
   * @returns The digest.
   */
  function digestOf(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  /**
   * The canonical form of a `member` batch, as the domain defines the equivalence.
   *
   * @param emails - The addresses, as sent.
   * @returns The canonical form.
   */
  function canonicalOf(emails: readonly string[]): string {
    return InvitationBatchRequest.of(distinctAddresses(emails), 'member').canonical;
  }

  /**
   * Writes the reservation a `member` batch of Inès in Atelier Nord holds while it runs, as a
   * request in flight (or one that crashed) leaves it.
   *
   * @param key - The key.
   * @param emails - The addresses of the batch.
   * @param leaseSeconds - How long the lease still holds; negative for a lease that ran out.
   */
  async function reservedBy(
    key: string,
    emails: readonly string[],
    leaseSeconds = 30,
  ): Promise<void> {
    await stack.system(
      `insert into invitation_batch_replays
         (organization_id, actor_user_id, key_digest, request_digest, state, lease_id, outcome,
          expires_at)
       values ($1, $2, $3, $4, 'reserved', uuidv7(), null,
               clock_timestamp() + make_interval(secs => $5))`,
      [atelierNordId, ines.id, digestOf(key), digestOf(canonicalOf(emails)), leaseSeconds],
    );
  }

  beforeAll(async () => {
    stack = await ServiceStack.start('invitation-idempotency');
    app = await stack.startApplication();
    // The purge runs when the tests call it, never on its minute schedule in between.
    await app
      .get(JobScheduler)
      .unschedule(PURGE_INVITATION_BATCH_REPLAYS_QUEUE, { key: 'minutely' });
    await stack.system(
      `insert into directory_users (user_id, name, email, email_verified, email_version)
       values ($1, 'Camille Martin', $2, true, 1), ($3, 'Inès Robert', $4, true, 1),
              ($5, 'Hugo Dubois', $6, true, 1), ($7, 'Marc Roux', $8, true, 1),
              ($9, 'Lucie Bernard', $10, true, 1)`,
      [
        camille.id,
        camille.email,
        ines.id,
        ines.email,
        hugo.id,
        hugo.email,
        marc.id,
        marc.email,
        lucie.id,
        lucie.email,
      ],
    );
    await stack.system(
      `insert into organizations
       (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Atelier Nord', 'atelier nord', 'atelier-nord', 'fr', '6-20', 'other', $3),
              ($2, 'Coopérative Lumen', 'cooperative lumen', 'lumen', 'fr', '1-5', 'other', $4)`,
      [atelierNordId, lumenId, camille.id, ines.id],
    );
    await stack.system(
      `insert into members (organization_id, user_id, role, joined_at)
       values ($1, $3, 'owner', now()), ($1, $4, 'admin', now()), ($1, $5, 'member', now()),
              ($2, $4, 'owner', now())`,
      [atelierNordId, lumenId, camille.id, ines.id, hugo.id],
    );
    for (const account of [camille, ines, hugo, marc, lucie]) {
      stack.verifiedEmails.set(account.id, 1, account.email);
    }
  });

  afterAll(async () => {
    await stack.stop();
  });

  describe('Idempotency-Key of inviteMembers', () => {
    const key = 'members-page-batch-1';

    it('replays an equivalent batch without sending, emitting or charging the allowances again', async () => {
      const created: Response = await invite(ines, atelierNordId, key, [
        'paul.lefevre@ateliernord.fr',
        'sarah.morel@ateliernord.fr',
      ]);
      expect(created.status).toBe(200);
      expect(InviteMembersInternalResponse.parse(created.body)).toEqual(created.body);
      first = created.body as InvitationBatchResult;
      expect(first.invitations.map((outcome) => outcome.outcome)).toEqual(['invited', 'invited']);
      const before: Record<string, number> = await effects(atelierNordId);
      const sent: number = await senderEmails(ines);
      expect(before).toMatchObject({ invitations: 2, emails: 2, events: 2, replays: 1 });

      const replayed: Response = await invite(ines, atelierNordId, key, [
        'Paul.Lefevre@AtelierNord.fr',
        'sarah.morel@ateliernord.fr',
        'SARAH.MOREL@ateliernord.fr',
      ]);

      expect(replayed.status).toBe(200);
      expect(replayed.body).toEqual(first);
      expect(await effects(atelierNordId)).toEqual(before);
      expect(await senderEmails(ines)).toBe(sent);
    });

    it('refuses a different batch under the same key with idempotency.key-reused', async () => {
      const before: Record<string, number> = await effects(atelierNordId);

      for (const [emails, role] of [
        [['sarah.morel@ateliernord.fr', 'paul.lefevre@ateliernord.fr'], 'member'],
        [['paul.lefevre@ateliernord.fr', 'sarah.morel@ateliernord.fr'], 'guest'],
        [['paul.lefevre@ateliernord.fr'], 'member'],
      ] as const) {
        const reused: Response = await invite(ines, atelierNordId, key, emails, role);
        expect(reused.status).toBe(422);
        expect(reused.body).toMatchObject({ code: 'idempotency.key-reused' });
      }
      expect(await effects(atelierNordId)).toEqual(before);
    });

    it('answers 409 to the batch in flight and 422 to another under its reservation, until its lease runs out', async () => {
      const busy = 'members-page-batch-busy';
      await reservedBy(busy, ['nina@ateliernord.fr']);
      const before: Record<string, number> = await effects(atelierNordId);

      const running: Response = await invite(ines, atelierNordId, busy, ['Nina@AtelierNord.fr']);
      const other: Response = await invite(ines, atelierNordId, busy, ['olga@ateliernord.fr']);

      expect(running.status).toBe(409);
      expect(running.body).toMatchObject({ code: 'idempotency.request-in-progress' });
      expect(other.status).toBe(422);
      expect(other.body).toMatchObject({ code: 'idempotency.key-reused' });
      expect(await effects(atelierNordId)).toEqual(before);

      // The holder crashed: nothing deletes its reservation, but its lease runs out.
      await stack.system(
        `update invitation_batch_replays set expires_at = clock_timestamp() - interval '1 second'
         where organization_id = $1 and actor_user_id = $2 and key_digest = $3`,
        [atelierNordId, ines.id, digestOf(busy)],
      );
      const freed: Response = await invite(ines, atelierNordId, busy, ['olga@ateliernord.fr']);
      expect(freed.status).toBe(200);
      expect((freed.body as InvitationBatchResult).invitations[0]).toMatchObject({
        email: 'olga@ateliernord.fr',
        outcome: 'invited',
      });
      const replayed: Response = await invite(ines, atelierNordId, busy, ['olga@ateliernord.fr']);
      expect(replayed.body).toEqual(freed.body);
    });

    it('replays a committed batch to concurrent retries, never answering 409', async () => {
      const committed = 'members-page-batch-committed';
      const emails: readonly string[] = ['ilan@ateliernord.fr', 'jade@ateliernord.fr'];
      const original: Response = await invite(ines, atelierNordId, committed, emails);
      expect(original.status).toBe(200);
      const before: Record<string, number> = await effects(atelierNordId);

      const retries: Response[] = await Promise.all(
        Array.from({ length: 4 }, () => invite(ines, atelierNordId, committed, emails)),
      );
      const different: Response[] = await Promise.all(
        Array.from({ length: 2 }, () =>
          invite(ines, atelierNordId, committed, ['kim@ateliernord.fr']),
        ),
      );

      expect(retries.map((response) => response.status)).toEqual([200, 200, 200, 200]);
      for (const response of retries) {
        expect(response.body).toEqual(original.body);
      }
      expect(different.map((response) => response.status)).toEqual([422, 422]);
      expect(await effects(atelierNordId)).toEqual(before);
    });

    it('lets one of two concurrent different batches under a key commit, and refuses the other', async () => {
      const contested = 'members-page-batch-contested';
      const before: Record<string, number> = await effects(atelierNordId);

      const emails: readonly (readonly string[])[] = [
        ['leo@ateliernord.fr'],
        ['mia@ateliernord.fr'],
      ];
      const [left, right] = await contend((index) =>
        invite(ines, atelierNordId, contested, emails[index] ?? []),
      );

      const statuses: number[] = [left?.status ?? 0, right?.status ?? 0].sort();
      expect(statuses).toEqual([200, 422]);
      const refused: Response | undefined = left?.status === 422 ? left : right;
      expect(refused?.body).toMatchObject({ code: 'idempotency.key-reused' });
      expect(await effects(atelierNordId)).toEqual({
        invitations: (before.invitations ?? 0) + 1,
        emails: (before.emails ?? 0) + 1,
        events: (before.events ?? 0) + 1,
        replays: (before.replays ?? 0) + 1,
      });
    });

    /**
     * Holds the sender allowance lock of Inès in a transaction of its own, as a batch of hers
     * would, until `release` commits it.
     *
     * @returns The holder and a wait for a number of transactions blocked behind an advisory lock.
     */
    async function holdSenderLock(): Promise<{
      readonly waiting: (count: number) => Promise<void>;
      readonly release: () => Promise<void>;
    }> {
      const holder: pg.PoolClient = await stack.migrator.connect();
      await holder.query('begin');
      await holder.query(
        `select pg_advisory_xact_lock(hashtextextended('invitation-sender:' || $1::uuid::text, 0))`,
        [ines.id],
      );
      return {
        waiting: async (count: number): Promise<void> => {
          for (let attempt = 0; attempt < 100; attempt += 1) {
            const rows = await stack.migrator.query<{ blocked: number }>(
              `select count(*)::int as blocked from pg_locks
               where locktype = 'advisory' and not granted`,
            );
            if ((rows.rows[0]?.blocked ?? 0) >= count) return;
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
          }
          throw new Error('The batches never reached the sender allowance lock.');
        },
        release: async (): Promise<void> => {
          try {
            await holder.query('commit');
          } finally {
            holder.release();
          }
        },
      };
    }

    it('answers key-reused, not 429, to a batch that waited while another one of its key took the last send', async () => {
      const lyonId: string = newId();
      const key = 'lyon-batch-last-send';
      await stack.system(
        `insert into organizations
         (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
         values ($1, 'Atelier Nord Lyon', 'atelier nord lyon', 'atelier-nord-lyon', 'fr', '1-5',
                 'other', $2)`,
        [lyonId, ines.id],
      );
      await stack.system(
        `insert into members (organization_id, user_id, role, joined_at) values ($1, $2, 'owner', now())`,
        [lyonId, ines.id],
      );
      const [anchor] = await stack.system<{ id: string }>(
        `insert into invitations (organization_id, email, role, invited_by_user_id, sent_at, expires_at)
         values ($1, 'ancien@ateliernord.fr', 'member', $2, now(), now() + interval '7 days')
         returning id`,
        [lyonId, ines.id],
      );
      await stack.system(
        `insert into invitation_emails (organization_id, invitation_id, sent_at)
         select $1, $2, now() from generate_series(1, 99)`,
        [lyonId, anchor?.id],
      );
      const lock = await holdSenderLock();
      const emails: readonly (readonly string[])[] = [
        ['noe@ateliernord.fr'],
        ['oscar@ateliernord.fr'],
      ];
      const pending: Promise<Response[]> = contend((index) =>
        invite(ines, lyonId, key, emails[index] ?? []),
      );
      try {
        await lock.waiting(1);
      } finally {
        await lock.release();
      }
      const responses: Response[] = await pending;

      expect(responses.map((response) => response.status).sort()).toEqual([200, 422]);
      expect(responses.find((response) => response.status === 422)?.body).toMatchObject({
        code: 'idempotency.key-reused',
      });
      expect(await effects(lyonId)).toMatchObject({ invitations: 2, emails: 100, replays: 1 });
    });

    it('commits a batch that outlives its lease, which neither a purge nor another request takes', async () => {
      const slow = 'members-page-batch-slow';
      // Every lease this batch takes or renews has already run out, as for a batch slower than
      // the 30 seconds of its lease.
      await stack.migrator.query(
        `create function expire_invitation_batch_lease() returns trigger language plpgsql as
         $$ begin
           if new.state = 'reserved' then
             new.expires_at := clock_timestamp() - interval '1 second';
           end if;
           return new;
         end $$`,
      );
      await stack.migrator.query(
        `create trigger expire_invitation_batch_lease before insert or update on invitation_batch_replays
         for each row execute function expire_invitation_batch_lease()`,
      );
      let original: Response;
      let competitor: Response;
      let retry: Response;
      let purged: number | null;
      try {
        const lock = await holdSenderLock();
        const pending: Promise<Response> = invite(ines, atelierNordId, slow, [
          'sven@ateliernord.fr',
        ]);
        try {
          await lock.waiting(1);
          purged = await purgeStore().purge(500, {
            deadline: performance.now() + 5_000,
            signal: new AbortController().signal,
          });
          competitor = await invite(ines, atelierNordId, slow, ['tess@ateliernord.fr']);
          retry = await invite(ines, atelierNordId, slow, ['Sven@AtelierNord.fr']);
        } finally {
          await lock.release();
        }
        original = await pending;
      } finally {
        await stack.migrator.query(
          'drop trigger expire_invitation_batch_lease on invitation_batch_replays',
        );
        await stack.migrator.query('drop function expire_invitation_batch_lease()');
      }

      expect(purged).toBe(0);
      // Past its visible lease, who holds the key is unknown: the answer is the retryable one
      // whatever the body.
      expect(competitor.status).toBe(409);
      expect(competitor.body).toMatchObject({ code: 'idempotency.request-in-progress' });
      expect(retry.status).toBe(409);
      expect(retry.body).toMatchObject({ code: 'idempotency.request-in-progress' });
      expect(original.status).toBe(200);
      expect((original.body as InvitationBatchResult).invitations[0]).toMatchObject({
        email: 'sven@ateliernord.fr',
        outcome: 'invited',
      });
      const replayed: Response = await invite(ines, atelierNordId, slow, ['sven@ateliernord.fr']);
      expect(replayed.status).toBe(200);
      expect(replayed.body).toEqual(original.body);
    });

    it('answers 409, never 422, to an equivalent retry while a takeover of the expired key is uncommitted', async () => {
      const taken = 'members-page-batch-taken-over';
      const emails: readonly string[] = ['abby@ateliernord.fr'];
      await reservedBy(taken, ['old.batch@ateliernord.fr'], -10);
      const takeover: pg.PoolClient = await stack.migrator.connect();
      let retry: Response;
      try {
        await takeover.query('begin');
        await takeover.query(`select set_config('app.system_access', 'on', true)`);
        // A request takes the expired reservation over for this very batch and has not committed.
        await takeover.query(
          `update invitation_batch_replays
           set request_digest = $4, lease_id = uuidv7(),
               expires_at = clock_timestamp() + interval '30 seconds'
           where organization_id = $1 and actor_user_id = $2 and key_digest = $3`,
          [atelierNordId, ines.id, digestOf(taken), digestOf(canonicalOf(emails))],
        );
        retry = await invite(ines, atelierNordId, taken, emails);
      } finally {
        await takeover.query('rollback');
        takeover.release();
      }

      expect(retry.status).toBe(409);
      expect(retry.body).toMatchObject({ code: 'idempotency.request-in-progress' });
      const runs: Response = await invite(ines, atelierNordId, taken, emails);
      expect(runs.status).toBe(200);
      expect((runs.body as InvitationBatchResult).invitations[0]?.outcome).toBe('invited');
    });

    it('answers 409 while a purge holds the expired row of a key, then runs the key once it is free', async () => {
      const purged = 'members-page-batch-purging';
      const emails: readonly string[] = ['bert@ateliernord.fr'];
      await reservedBy(purged, emails, -10);
      const purge: pg.PoolClient = await stack.migrator.connect();
      let held: Response;
      try {
        await purge.query('begin');
        await purge.query(`select set_config('app.system_access', 'on', true)`);
        await purge.query(
          `select key_digest from invitation_batch_replays
           where organization_id = $1 and actor_user_id = $2 and key_digest = $3 for update`,
          [atelierNordId, ines.id, digestOf(purged)],
        );
        held = await invite(ines, atelierNordId, purged, emails);
      } finally {
        await purge.query('rollback');
        purge.release();
      }

      expect(held.status).toBe(409);
      expect(held.body).toMatchObject({ code: 'idempotency.request-in-progress' });
      const runs: Response = await invite(ines, atelierNordId, purged, emails);
      expect(runs.status).toBe(200);
    });

    it('waits for a long change of the organization to reserve a new key, instead of a false 409', async () => {
      const patched = 'members-page-batch-organization-locked';
      const editor: pg.PoolClient = await stack.migrator.connect();
      let response: Response;
      let durationMs: number;
      try {
        await editor.query('begin');
        await editor.query(`select set_config('app.system_access', 'on', true)`);
        // A change of the organization in progress, as a patch of its profile holds it.
        await editor.query('select id from organizations where id = $1 for update', [
          atelierNordId,
        ]);
        const started: number = Date.now();
        const pending: Promise<Response> = invite(ines, atelierNordId, patched, [
          'cleo@ateliernord.fr',
        ]);
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
        await editor.query('commit');
        response = await pending;
        durationMs = Date.now() - started;
      } finally {
        editor.release();
      }

      expect(response.status).toBe(200);
      expect((response.body as InvitationBatchResult).invitations[0]?.outcome).toBe('invited');
      expect(durationMs).toBeGreaterThanOrEqual(500);
    });

    it('never waits to reserve a key that another transaction is writing, answering 409 at once', async () => {
      const contested = 'members-page-batch-reserving';
      const emails: readonly string[] = ['wanda@ateliernord.fr'];
      // A row of the key that the read of a reservation cannot see yet and an insert would wait
      // on: another transaction has written it and not committed.
      const writer: pg.PoolClient = await stack.migrator.connect();
      const timed: { status: number; code: unknown; durationMs: number }[] = [];
      try {
        await writer.query('begin');
        await writer.query(`select set_config('app.system_access', 'on', true)`);
        await writer.query(
          `insert into invitation_batch_replays
             (organization_id, actor_user_id, key_digest, request_digest, state, lease_id,
              outcome, expires_at)
           values ($1, $2, $3, $4, 'reserved', uuidv7(), null,
                   clock_timestamp() + interval '30 seconds')`,
          [atelierNordId, ines.id, digestOf(contested), digestOf(canonicalOf(emails))],
        );
        for (const body of [emails, ['xena.b@ateliernord.fr']]) {
          const started: number = Date.now();
          const response: Response = await invite(ines, atelierNordId, contested, body);
          timed.push({
            status: response.status,
            code: (response.body as { code?: unknown }).code,
            durationMs: Date.now() - started,
          });
        }
      } finally {
        await writer.query('rollback');
        writer.release();
      }

      for (const answer of timed) {
        expect(answer).toMatchObject({ status: 409, code: 'idempotency.request-in-progress' });
        expect(answer.durationMs).toBeLessThan(1_000);
      }
      const free: Response = await invite(ines, atelierNordId, contested, emails);
      expect(free.status).toBe(200);
    });

    it('answers 409 at once while another request reserves the same key', async () => {
      const contested = 'members-page-batch-serialized';
      const holder: pg.PoolClient = await stack.migrator.connect();
      let answer: Response;
      let durationMs: number;
      try {
        await holder.query('begin');
        // The reservation lock of the key, which a request holds while it reserves it.
        await holder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `invitation-batch-reservation:${atelierNordId}:${ines.id}:${digestOf(contested)}`,
        ]);
        const started: number = Date.now();
        answer = await invite(ines, atelierNordId, contested, ['yann.b@ateliernord.fr']);
        durationMs = Date.now() - started;
      } finally {
        await holder.query('rollback');
        holder.release();
      }

      expect(answer.status).toBe(409);
      expect(answer.body).toMatchObject({ code: 'idempotency.request-in-progress' });
      expect(durationMs).toBeLessThan(1_000);
      expect((await invite(ines, atelierNordId, contested, ['yann.b@ateliernord.fr'])).status).toBe(
        200,
      );
    });

    it('starts the 24 hours of a replay on the database clock when the record is written', async () => {
      const key = 'members-page-batch-delayed';
      const lock = await holdSenderLock();
      const pending: Promise<Response> = invite(ines, atelierNordId, key, ['paz@ateliernord.fr']);
      let released: Date | undefined;
      try {
        await lock.waiting(1);
        await new Promise<void>((resolve) => setTimeout(resolve, 1500));
        const [clock] = await stack.system<{ now: Date }>('select clock_timestamp() as now');
        released = clock?.now;
      } finally {
        await lock.release();
      }
      const response: Response = await pending;
      const [stored] = await stack.system<{ expires_at: Date }>(
        `select expires_at from invitation_batch_replays
         where organization_id = $1 and actor_user_id = $2 and key_digest = $3`,
        [atelierNordId, ines.id, digestOf(key)],
      );

      expect(response.status).toBe(200);
      expect(stored?.expires_at.getTime()).toBeGreaterThanOrEqual(
        (released?.getTime() ?? Number.POSITIVE_INFINITY) + 24 * 60 * 60_000,
      );
    });

    it('answers 409 at once to retries of a batch in flight, keeping the pool free, then replays it', async () => {
      const racing = 'members-page-batch-claimed';
      const emails: readonly string[] = ['ruth@ateliernord.fr'];
      const outcome: InvitationBatchResult = {
        invitations: [{ email: 'ruth@ateliernord.fr', outcome: 'invited', invitationId: newId() }],
      };
      // The original batch, in flight: the key is reserved under its lease, nothing committed.
      await reservedBy(racing, emails);
      /**
       * Times a request.
       *
       * @param pending - The request.
       * @returns Its status and how long it took.
       */
      const timed = async (
        pending: PromiseLike<Response>,
      ): Promise<{ readonly status: number; readonly durationMs: number }> => {
        const started: number = Date.now();
        const response: Response = await pending;
        return { status: response.status, durationMs: Date.now() - started };
      };
      // More retries than the five connections of the pool, with a readiness probe and a read of
      // another tenant at the same time.
      const started: number = Date.now();
      const pendingRetries: Promise<Response>[] = Array.from({ length: 12 }, () =>
        invite(ines, atelierNordId, racing, emails),
      );
      const pendingProbes = [
        timed(request(app.getHttpServer()).get('/health/ready')),
        timed(call('get', '/internal/v1/organization', ines, lumenId)),
      ];
      const retries: Response[] = await Promise.all(pendingRetries);
      const retriesMs: number = Date.now() - started;
      const probes = await Promise.all(pendingProbes);
      // The original batch commits its record.
      await stack.system(
        `update invitation_batch_replays
         set state = 'committed', lease_id = null, outcome = $4,
             expires_at = clock_timestamp() + interval '24 hours'
         where organization_id = $1 and actor_user_id = $2 and key_digest = $3`,
        [atelierNordId, ines.id, digestOf(racing), JSON.stringify(outcome.invitations)],
      );
      const replayed: Response = await invite(ines, atelierNordId, racing, emails);

      expect(retries.map((response) => response.status)).toEqual(Array(12).fill(409));
      for (const response of retries) {
        expect(response.body).toMatchObject({ code: 'idempotency.request-in-progress' });
      }
      expect(retriesMs).toBeLessThan(3_000);
      expect(probes.map((probe) => probe.status)).toEqual([200, 200]);
      for (const probe of probes) {
        expect(probe.durationMs).toBeLessThan(1_000);
      }
      expect(replayed.status).toBe(200);
      expect(replayed.body).toEqual(outcome);
    });

    it('keeps a fingerprint of the batch, never its addresses, beside the body to replay', async () => {
      const rows = await stack.system<{ columns: string[] }>(
        `select array_agg(column_name::text order by ordinal_position) as columns
         from information_schema.columns where table_name = 'invitation_batch_replays'`,
      );
      const [stored] = await stack.system<{ request_digest: string; outcome: unknown }>(
        `select request_digest, outcome from invitation_batch_replays
         where organization_id = $1 and actor_user_id = $2 and key_digest = $3`,
        [atelierNordId, ines.id, digestOf(key)],
      );

      expect(rows[0]?.columns).toEqual([
        'organization_id',
        'actor_user_id',
        'key_digest',
        'request_digest',
        'state',
        'lease_id',
        'outcome',
        'expires_at',
        'created_at',
      ]);
      expect(stored?.request_digest).toBe(
        digestOf(canonicalOf(['paul.lefevre@ateliernord.fr', 'sarah.morel@ateliernord.fr'])),
      );
      expect(stored?.outcome).toEqual(first.invitations);
    });

    it('applies two concurrent requests with the same key once', async () => {
      const racing = 'members-page-batch-race';
      const before: Record<string, number> = await effects(atelierNordId);

      const responses: Response[] = await Promise.all(
        Array.from({ length: 4 }, () =>
          invite(ines, atelierNordId, racing, ['quentin@ateliernord.fr', 'rose@ateliernord.fr']),
        ),
      );

      const succeeded: Response[] = responses.filter((response) => response.status === 200);
      expect(succeeded.length).toBeGreaterThanOrEqual(1);
      for (const response of responses) {
        expect([200, 409]).toContain(response.status);
        if (response.status === 409) {
          expect(response.body).toMatchObject({ code: 'idempotency.request-in-progress' });
        } else {
          expect(response.body).toEqual(succeeded[0]?.body);
        }
      }
      expect(await effects(atelierNordId)).toEqual({
        invitations: (before.invitations ?? 0) + 2,
        emails: (before.emails ?? 0) + 2,
        events: (before.events ?? 0) + 2,
        replays: (before.replays ?? 0) + 1,
      });
    });

    it('checks the authorization again before a replay, and answers as a fresh request would', async () => {
      await setRole(ines, 'member');
      try {
        const demoted: Response = await invite(ines, atelierNordId, key, [
          'paul.lefevre@ateliernord.fr',
          'sarah.morel@ateliernord.fr',
        ]);
        expect(demoted.status).toBe(403);
        expect(demoted.body).toMatchObject({ code: 'organization.role-forbidden' });
        const otherBody: Response = await invite(ines, atelierNordId, key, [
          'sarah.morel@ateliernord.fr',
        ]);
        expect(otherBody.status).toBe(403);
        expect(otherBody.body).toMatchObject({ code: 'organization.role-forbidden' });
      } finally {
        await setRole(ines, 'admin');
      }

      const outsider: Response = await invite(marc, atelierNordId, key, [
        'paul.lefevre@ateliernord.fr',
        'sarah.morel@ateliernord.fr',
      ]);
      expect(outsider.status).toBe(404);
      expect(outsider.body).toMatchObject({ code: 'organization.not-found' });

      const restored: Response = await invite(ines, atelierNordId, key, [
        'paul.lefevre@ateliernord.fr',
        'sarah.morel@ateliernord.fr',
      ]);
      expect(restored.status).toBe(200);
      expect(restored.body).toEqual(first);
    });

    it('runs the same key afresh for another user or in another organization', async () => {
      const emails: readonly string[] = [
        'paul.lefevre@ateliernord.fr',
        'sarah.morel@ateliernord.fr',
      ];

      const otherUser: Response = await invite(camille, atelierNordId, key, emails);
      const otherOrganization: Response = await invite(ines, lumenId, key, emails);

      expect(otherUser.status).toBe(200);
      expect(otherUser.body).toEqual({
        invitations: first.invitations.map((outcome) => ({
          ...outcome,
          outcome: 'already-invited',
        })),
      });
      expect(otherOrganization.status).toBe(200);
      const lumen: InvitationBatchResult = otherOrganization.body as InvitationBatchResult;
      expect(lumen.invitations.map((outcome) => outcome.outcome)).toEqual(['invited', 'invited']);
      expect(lumen.invitations.map((outcome) => outcome.invitationId)).not.toEqual(
        first.invitations.map((outcome) => outcome.invitationId),
      );
      expect(await effects(lumenId)).toMatchObject({ invitations: 2, events: 2, replays: 1 });
    });

    it('stores no 429, so the same key runs once the allowance grows again', async () => {
      const limited = 'lumen-batch-after-limit';
      const [anchor] = await stack.system<{ id: string }>(
        `select id from invitations where organization_id = $1 limit 1`,
        [lumenId],
      );
      await stack.system(
        `insert into invitation_emails (organization_id, invitation_id, sent_at)
         select $1, $2, now() from generate_series(1, 98)`,
        [lumenId, anchor?.id],
      );
      const before: Record<string, number> = await effects(lumenId);

      const refused: Response = await invite(ines, lumenId, limited, ['tom@lumen.coop']);

      expect(refused.status).toBe(429);
      expect(refused.body).toMatchObject({ code: 'invitation.daily-limit-reached' });
      expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(await effects(lumenId)).toEqual(before);

      await stack.system(
        `update invitation_emails set sent_at = now() - interval '25 hours' where organization_id = $1`,
        [lumenId],
      );
      const later: Response = await invite(ines, lumenId, limited, ['tom@lumen.coop']);
      expect(later.status).toBe(200);
      expect((later.body as InvitationBatchResult).invitations[0]?.outcome).toBe('invited');
    });

    it('commits nothing when the transaction fails after the invitations, and lets the key run again', async () => {
      const failing = 'members-page-batch-failure';
      const emails: readonly string[] = ['ugo@ateliernord.fr', 'vera@ateliernord.fr'];
      await stack.migrator.query(
        `create function fail_invitation_batch_replay() returns trigger language plpgsql as
         $$ begin raise exception 'simulated failure after the invitations'; end $$`,
      );
      await stack.migrator.query(
        `create trigger fail_invitation_batch_replay before update on invitation_batch_replays
         for each row when (new.state = 'committed') execute function fail_invitation_batch_replay()`,
      );
      const before: Record<string, number> = await effects(atelierNordId);
      const sent: number = await senderEmails(ines);
      try {
        const failed: Response = await invite(ines, atelierNordId, failing, emails);

        expect(failed.status).toBe(500);
        expect(await effects(atelierNordId)).toEqual(before);
        expect(await senderEmails(ines)).toBe(sent);
        expect(
          await count(
            `select count(*)::int as count from invitations
             where organization_id = $1 and email in ('ugo@ateliernord.fr', 'vera@ateliernord.fr')`,
            atelierNordId,
          ),
        ).toBe(0);
      } finally {
        await stack.migrator.query(
          'drop trigger fail_invitation_batch_replay on invitation_batch_replays',
        );
        await stack.migrator.query('drop function fail_invitation_batch_replay()');
      }

      const retried: Response = await invite(ines, atelierNordId, failing, emails);
      expect(retried.status).toBe(200);
      expect(
        (retried.body as InvitationBatchResult).invitations.map((outcome) => outcome.outcome),
      ).toEqual(['invited', 'invited']);
      expect(await effects(atelierNordId)).toEqual({
        invitations: (before.invitations ?? 0) + 2,
        emails: (before.emails ?? 0) + 2,
        events: (before.events ?? 0) + 2,
        replays: (before.replays ?? 0) + 1,
      });
    });

    it('runs a batch without a key as before, and refuses a malformed key', async () => {
      const unkeyed: Response = await call('post', INVITATIONS, ines, atelierNordId, {
        body: { emails: ['paul.lefevre@ateliernord.fr'] },
      });
      expect(unkeyed.status).toBe(200);
      expect((unkeyed.body as InvitationBatchResult).invitations[0]?.outcome).toBe(
        'already-invited',
      );

      const malformed: Response = await invite(ines, atelierNordId, 'k'.repeat(256), [
        'paul.lefevre@ateliernord.fr',
      ]);
      expect(malformed.status).toBe(400);
      expect(malformed.body).toMatchObject({ code: 'request.invalid' });
    });
  });

  describe('keyed route POST /internal/v1/invitation-batches', () => {
    const BATCHES = '/internal/v1/invitation-batches';

    /**
     * Invites addresses through the keyed route as `member`.
     *
     * @param key - The `Idempotency-Key`, or `undefined` to send none.
     * @param emails - The addresses.
     * @returns The response.
     */
    function inviteKeyed(key: string | undefined, emails: readonly string[]): Promise<Response> {
      return call('post', BATCHES, ines, atelierNordId, {
        body: { emails, role: 'member' },
        ...(key === undefined ? {} : { key }),
      });
    }

    it('requires the Idempotency-Key, and writes nothing without it', async () => {
      const before: Record<string, number> = await effects(atelierNordId);

      const missing: Response = await inviteKeyed(undefined, ['zoe@ateliernord.fr']);
      const empty: Response = await call('post', BATCHES, ines, atelierNordId, {
        body: { emails: ['zoe@ateliernord.fr'], role: 'member' },
        key: '',
      });

      expect(missing.status).toBe(400);
      expect(missing.body).toMatchObject({
        code: 'request.invalid',
        details: { issues: [{ in: 'header', path: 'Idempotency-Key' }] },
      });
      expect(empty.status).toBe(400);
      expect(await effects(atelierNordId)).toEqual(before);
    });

    it('replays on the keyed route a batch keyed on the former route, and the reverse', async () => {
      const before: Record<string, number> = await effects(atelierNordId);
      const formerKey = 'members-page-batch-former';
      const original: Response = await invite(ines, atelierNordId, formerKey, [
        'xavi@ateliernord.fr',
        'yara@ateliernord.fr',
      ]);
      const fromFormer: Response = await inviteKeyed(formerKey, [
        'Xavi@AtelierNord.fr',
        'yara@ateliernord.fr',
      ]);
      const reusedOnKeyed: Response = await inviteKeyed(formerKey, ['yara@ateliernord.fr']);

      const keyedKey = 'members-page-batch-keyed';
      const created: Response = await inviteKeyed(keyedKey, ['yves@ateliernord.fr']);
      const fromKeyed: Response = await invite(ines, atelierNordId, keyedKey, [
        'Yves@AtelierNord.fr',
      ]);
      const reusedOnFormer: Response = await invite(ines, atelierNordId, keyedKey, [
        'zack@ateliernord.fr',
      ]);

      expect(original.status).toBe(200);
      expect(
        (original.body as InvitationBatchResult).invitations.map((outcome) => outcome.outcome),
      ).toEqual(['invited', 'invited']);
      expect(fromFormer.status).toBe(200);
      expect(fromFormer.body).toEqual(original.body);
      expect(InviteMembersInternalResponse.parse(fromFormer.body)).toEqual(fromFormer.body);
      expect(reusedOnKeyed.status).toBe(422);
      expect(reusedOnKeyed.body).toMatchObject({ code: 'idempotency.key-reused' });
      expect(created.status).toBe(200);
      expect(fromKeyed.status).toBe(200);
      expect(fromKeyed.body).toEqual(created.body);
      expect(reusedOnFormer.status).toBe(422);
      expect(await effects(atelierNordId)).toEqual({
        invitations: (before.invitations ?? 0) + 3,
        emails: (before.emails ?? 0) + 3,
        events: (before.events ?? 0) + 3,
        replays: (before.replays ?? 0) + 2,
      });
    });

    it('replays from a snapshot, never waiting on a membership row a stalled change holds', async () => {
      const committed = 'members-page-batch-stalled-role';
      const emails: readonly string[] = ['zelie@ateliernord.fr'];
      const original: Response = await inviteKeyed(committed, emails);
      expect(original.status).toBe(200);
      const stalled: pg.PoolClient = await stack.migrator.connect();
      let replays: Response[];
      let probe: { readonly status: number; readonly durationMs: number };
      let replaysMs: number;
      try {
        await stalled.query('begin');
        await stalled.query(`select set_config('app.system_access', 'on', true)`);
        // A role change or a removal in progress: the membership row is locked, not committed.
        await stalled.query(
          `update members set version = version
           where organization_id = $1 and user_id = $2 and removed_at is null`,
          [atelierNordId, ines.id],
        );
        const started: number = Date.now();
        const pending: Promise<Response>[] = Array.from({ length: 12 }, () =>
          inviteKeyed(committed, emails),
        );
        const probeStarted: number = Date.now();
        const ready: Response = await request(app.getHttpServer()).get('/health/ready');
        probe = { status: ready.status, durationMs: Date.now() - probeStarted };
        replays = await Promise.all(pending);
        replaysMs = Date.now() - started;
      } finally {
        await stalled.query('rollback');
        stalled.release();
      }

      expect(replays.map((response) => response.status)).toEqual(Array(12).fill(200));
      for (const response of replays) {
        expect(response.body).toEqual(original.body);
      }
      expect(replaysMs).toBeLessThan(3_000);
      expect(probe.status).toBe(200);
      expect(probe.durationMs).toBeLessThan(1_000);
    });

    it('applies concurrent equivalent requests split across both routes once', async () => {
      const split = 'members-page-batch-split';
      const emails: readonly string[] = ['abel@ateliernord.fr', 'bea@ateliernord.fr'];
      const before: Record<string, number> = await effects(atelierNordId);

      const responses: Response[] = await Promise.all([
        inviteKeyed(split, emails),
        invite(ines, atelierNordId, split, emails),
        inviteKeyed(split, emails),
        invite(ines, atelierNordId, split, emails),
      ]);

      const succeeded: Response[] = responses.filter((response) => response.status === 200);
      expect(succeeded.length).toBeGreaterThanOrEqual(1);
      for (const response of responses) {
        expect([200, 409]).toContain(response.status);
        if (response.status === 200) {
          expect(response.body).toEqual(succeeded[0]?.body);
        }
      }
      expect(await effects(atelierNordId)).toEqual({
        invitations: (before.invitations ?? 0) + 2,
        emails: (before.emails ?? 0) + 2,
        events: (before.events ?? 0) + 2,
        replays: (before.replays ?? 0) + 1,
      });
    });
  });

  describe('purge of the expired replay records', () => {
    const sweeper: string = newId();

    /**
     * Inserts expired replay records of an organization for an actor of no batch.
     *
     * @param organizationId - The organization.
     * @param count - How many.
     * @param prefix - What tells their keys from the others.
     */
    async function expired(organizationId: string, count: number, prefix: string): Promise<void> {
      await stack.system(
        `insert into invitation_batch_replays
           (organization_id, actor_user_id, key_digest, request_digest, state, outcome, expires_at)
         select $1, $2, encode(sha256(convert_to($3 || g, 'UTF8')), 'hex'), repeat('a', 64), 'committed',
                '[]'::jsonb, now() - make_interval(hours => 1, mins => g)
         from generate_series(1, $4::int) as g`,
        [organizationId, sweeper, prefix, count],
      );
    }

    /**
     * Counts the replay records of the actor of no batch.
     *
     * @param organizationId - The organization.
     * @returns The count.
     */
    function swept(organizationId: string): Promise<number> {
      return count(
        `select count(*)::int as count from invitation_batch_replays
         where organization_id = $1 and actor_user_id = '${sweeper}'`,
        organizationId,
      );
    }

    it('deletes a bounded number of expired records of the organization at each keyed batch', async () => {
      await expired(atelierNordId, 15, 'inline-');

      const batch: Response = await invite(ines, atelierNordId, 'members-page-batch-purge', [
        'theo@ateliernord.fr',
      ]);

      expect(batch.status).toBe(200);
      expect(await swept(atelierNordId)).toBe(5);
    });

    it('deletes expired records of every organization in bounded batches, independently of their traffic', async () => {
      await expired(lumenId, 7, 'job-');
      const live: number = await count(
        `select count(*)::int as count from invitation_batch_replays
         where organization_id = $1 and expires_at > now()`,
        atelierNordId,
      );

      const deleted: number | null = await purgeStore().purge(3, {
        deadline: performance.now() + 5_000,
        signal: new AbortController().signal,
      });
      expect(deleted).toBe(3);
      expect((await swept(atelierNordId)) + (await swept(lumenId))).toBe(9);

      await app
        .get(PurgeInvitationBatchReplaysHandler)
        .handle({ organizationId: null, signal: new AbortController().signal });
      expect(await swept(atelierNordId)).toBe(0);
      expect(await swept(lumenId)).toBe(0);
      expect(
        await count(
          `select count(*)::int as count from invitation_batch_replays
           where organization_id = $1 and expires_at > now()`,
          atelierNordId,
        ),
      ).toBe(live);
    });

    it('drains a burst of more than 500 expired records across organizations in one tick', async () => {
      await expired(atelierNordId, 700, 'burst-a-');
      await expired(lumenId, 650, 'burst-l-');
      const live: number = await count(
        `select count(*)::int as count from invitation_batch_replays
         where organization_id = $1 and expires_at > now()`,
        atelierNordId,
      );

      await app
        .get(PurgeInvitationBatchReplaysHandler)
        .handle({ organizationId: null, signal: new AbortController().signal });

      expect(await swept(atelierNordId)).toBe(0);
      expect(await swept(lumenId)).toBe(0);
      expect(live).toBeGreaterThan(0);
      expect(
        await count(
          `select count(*)::int as count from invitation_batch_replays
           where organization_id = $1 and expires_at > now()`,
          atelierNordId,
        ),
      ).toBe(live);
    });

    it('never deletes more rows than the limit of a purge, however many have expired', async () => {
      await expired(atelierNordId, 40, 'cap-a-');
      await expired(lumenId, 1_200, 'cap-l-');
      const system: SystemTransactionRunner = app.get(SystemTransactionRunner);

      const inline: number = await system.run(
        async ({ db }) => (await db.execute(inlinePurgeOf(atelierNordId))).rowCount ?? 0,
      );
      expect(inline).toBe(10);
      expect(await swept(atelierNordId)).toBe(30);

      const purge = purgeStore();
      const batches: (number | null)[] = [];
      for (let round = 0; round < 3; round += 1) {
        batches.push(
          await purge.purge(500, {
            deadline: performance.now() + 5_000,
            signal: new AbortController().signal,
          }),
        );
      }

      expect(batches).toEqual([500, 500, 230]);
      expect((await swept(atelierNordId)) + (await swept(lumenId))).toBe(0);
    });

    /**
     * A TCP proxy to PostgreSQL that can stop forwarding in both directions while keeping its
     * sockets open toward the client, as a network path that stalls without closing: once stalled,
     * it ignores the client's half-close and the server's end of the session.
     *
     * - `now` stalls at once;
     * - `after-error` forwards the server's messages one by one and stalls right after the first
     *   `ErrorResponse`, withholding the `ReadyForQuery` that follows it: `errorWithheld` resolves
     *   once the error went through and the bytes after it were dropped;
     * - `off` forwards everything, on new connections too.
     *
     * @param host - The host of PostgreSQL.
     * @param port - The port of PostgreSQL.
     * @returns The port of the proxy, the switch of the stall, the withheld answer and its closing.
     */
    async function stallingProxy(
      host: string,
      port: number,
    ): Promise<{
      readonly port: number;
      readonly stall: (mode: 'now' | 'after-error' | 'off') => void;
      readonly errorWithheld: Promise<void>;
      readonly close: () => Promise<void>;
    }> {
      const state: { stalled: boolean; afterError: boolean; errorForwarded: boolean } = {
        stalled: false,
        afterError: false,
        errorForwarded: false,
      };
      const withheld: { resolve: () => void } = { resolve: (): void => undefined };
      const errorWithheld = new Promise<void>((resolve) => {
        withheld.resolve = resolve;
      });
      const sockets = new Set<net.Socket>();
      const server: net.Server = net.createServer({ allowHalfOpen: true }, (client: net.Socket) => {
        const upstream: net.Socket = net.connect(port, host);
        sockets.add(client);
        sockets.add(upstream);
        let unread: Buffer = Buffer.alloc(0);
        client.on('data', (chunk: Buffer) => {
          if (!state.stalled) upstream.write(chunk);
        });
        upstream.on('data', (chunk: Buffer) => {
          if (state.stalled) {
            if (state.errorForwarded) withheld.resolve();
            return;
          }
          if (!state.afterError) {
            client.write(chunk);
            return;
          }
          // A backend message is its type byte, then its length, which counts itself.
          unread = Buffer.concat([unread, chunk]);
          while (unread.length >= 5 && unread.length >= 1 + unread.readUInt32BE(1)) {
            const end: number = 1 + unread.readUInt32BE(1);
            const message: Buffer = unread.subarray(0, end);
            unread = unread.subarray(end);
            client.write(message);
            if (message[0] === 0x45) {
              state.stalled = true;
              state.errorForwarded = true;
              // The `ReadyForQuery` that follows, if it came in the same chunk, is dropped here.
              if (unread.length > 0) withheld.resolve();
              return;
            }
          }
        });
        // The client's close ends both sides; the server's only while the path is not stalled.
        const closeBoth = (): void => {
          client.destroy();
          upstream.destroy();
        };
        client.on('close', closeBoth);
        client.on('error', closeBoth);
        client.on('end', () => {
          if (!state.stalled) closeBoth();
        });
        for (const event of ['close', 'error'] as const) {
          upstream.on(event, () => {
            if (state.stalled) {
              upstream.destroy();
            } else {
              closeBoth();
            }
          });
        }
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      return {
        port: (server.address() as net.AddressInfo).port,
        stall: (mode: 'now' | 'after-error' | 'off'): void => {
          state.stalled = mode === 'now';
          state.afterError = mode === 'after-error';
        },
        errorWithheld,
        close: (): Promise<void> => {
          for (const socket of sockets) socket.destroy();
          return new Promise<void>((resolve) => {
            server.close(() => {
              resolve();
            });
          });
        },
      };
    }

    /**
     * A pool of the application role whose connections go through a stalling proxy.
     *
     * @returns The proxy and the pool, to close in that order.
     */
    async function proxiedPool(): Promise<{
      readonly proxy: Awaited<ReturnType<typeof stallingProxy>>;
      readonly pool: pg.Pool;
    }> {
      const target = new URL(app.get<pg.Pool>(DATABASE_POOL).options.connectionString ?? '');
      const proxy = await stallingProxy(target.hostname, Number(target.port));
      target.host = `127.0.0.1:${String(proxy.port)}`;
      // A bounded connection timeout, as the pool of the kit has (5 s there).
      const pool = new pg.Pool({
        connectionString: target.toString(),
        max: 1,
        connectionTimeoutMillis: 1_000,
      });
      pool.on('error', () => undefined);
      return { proxy, pool };
    }

    /**
     * A purge tick of the job, on a store of its own, as the job runtime runs it: a rejection
     * fails the job, which its queue retries.
     *
     * @param store - The store of the expired records.
     * @param signal - The abort signal of the job.
     */
    async function tick(
      store: ExpiredInvitationBatchReplays,
      signal: AbortSignal = new AbortController().signal,
    ): Promise<void> {
      await new PurgeInvitationBatchReplaysHandler(
        app.get(JobWorkerRegistry),
        app.get(JobScheduler),
        store,
        PURGE_INVITATION_BATCH_REPLAYS_QUEUE,
      ).handle({ organizationId: null, signal });
    }

    /**
     * Discardable system transactions that tell when one of them starts its rollback.
     */
    class RollbackWatch extends DiscardableSystemTransactions {
      // #region Properties
      /** Resolves once a transaction starts its rollback. */
      public readonly rolledBack: Promise<void>;

      /** Resolves `rolledBack`. */
      private readonly rollingBack: () => void;
      // #endregion

      // #region Constructor
      /**
       * Binds the transactions to their pool.
       *
       * @param pool - The pool.
       */
      public constructor(pool: pg.Pool) {
        super(pool);
        const watch: { resolve: () => void } = { resolve: (): void => undefined };
        this.rolledBack = new Promise<void>((resolve) => {
          watch.resolve = resolve;
        });
        this.rollingBack = watch.resolve;
      }
      // #endregion

      // #region Methods
      /**
       * Runs a transaction as its parent does, watching its phases.
       *
       * @param work - The statements.
       * @param options - The options of the transaction.
       * @param discard - Aborts to destroy the connection.
       * @param onPhase - Learns each phase.
       * @returns What `work` resolved with.
       */
      public override run<TResult>(
        work: (scope: { readonly db: TransactionDatabase }) => Promise<TResult>,
        options: TransactionOptions,
        discard: AbortSignal,
        onPhase: (phase: 'setup' | 'work' | 'commit' | 'rollback') => void = (): void => undefined,
      ): Promise<TResult> {
        return super.run(work, options, discard, (phase) => {
          onPhase(phase);
          if (phase === 'rollback') this.rollingBack();
        });
      }
      // #endregion
    }

    it('fails a tick whose connection is stuck at the socket level, discarding it, and the retry deletes', async () => {
      await expired(lumenId, 4, 'stuck-socket-');
      const { proxy, pool } = await proxiedPool();
      try {
        // The purge reuses this idle connection, whose path then stalls: its statements are sent
        // and never answered, and the socket stays open.
        await pool.query('select 1');
        const store: ExpiredInvitationBatchReplays = purgeStore(pool);
        proxy.stall('now');

        // The tick fails, so the job runtime fails the job and its queue retries it.
        await expect(tick(store)).rejects.toMatchObject({
          name: 'InvitationBatchReplayPurgeCutShortError',
          phase: 'setup',
          trigger: 'deadline',
        });
        // Without the discard, nothing would ever end that call: no answer comes back. The read
        // of the backlog after it opens a new connection through the same stalled path, which the
        // connection timeout of the pool ends.
        await vi.waitFor(
          () => {
            expect(store.stalled).toBe(false);
          },
          { timeout: 3_000, interval: 10 },
        );
        expect(pool.totalCount).toBe(0);
        expect(await swept(lumenId)).toBe(4);

        proxy.stall('off');
        await tick(store);
        expect(await swept(lumenId)).toBe(0);
      } finally {
        // The proxy closes first: a connection it still holds open would otherwise hang the end
        // of the pool instead of failing an assertion.
        await proxy.close();
        await pool.end();
      }
    });

    it('fails a tick whose rollback waits behind an error never followed by ReadyForQuery, and the retry deletes', async () => {
      await expired(lumenId, 4, 'stuck-rollback-');
      const { proxy, pool } = await proxiedPool();
      try {
        const transactions = new RollbackWatch(pool);
        const store = new ExpiredInvitationBatchReplays(transactions, cutShortOf);
        try {
          // The delete of the purge fails at once with an `ErrorResponse`.
          await stack.migrator.query(
            `create function refuse_invitation_batch_replay_delete() returns trigger
             language plpgsql as $$ begin raise exception 'refused by the test'; end $$`,
          );
          await stack.migrator.query(
            `create trigger refuse_invitation_batch_replay_delete
             before delete on invitation_batch_replays
             for each row execute function refuse_invitation_batch_replay_delete()`,
          );
          await pool.query('select 1');
          proxy.stall('after-error');
          const job = new AbortController();
          const outcome = { settled: false };
          const running: Promise<void> = tick(store, job.signal).finally(() => {
            outcome.settled = true;
          });
          // pg got the error, has no active query and queued the rollback, whose
          // `ReadyForQuery` the proxy withholds: only then is the job cancelled.
          await Promise.all([proxy.errorWithheld, transactions.rolledBack]);
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
          expect(outcome.settled).toBe(false);
          job.abort();

          await expect(running).rejects.toMatchObject({
            name: 'InvitationBatchReplayPurgeCutShortError',
            phase: 'rollback',
            trigger: 'abort',
          });
          // The transaction settles: its connection was closed although pg had no active query.
          await vi.waitFor(
            () => {
              expect(store.stalled).toBe(false);
            },
            { timeout: 2_000, interval: 10 },
          );
          expect(pool.totalCount).toBe(0);
        } finally {
          await stack.migrator.query(
            'drop trigger if exists refuse_invitation_batch_replay_delete on invitation_batch_replays',
          );
          await stack.migrator.query(
            'drop function if exists refuse_invitation_batch_replay_delete()',
          );
        }

        // The retry deletes on a fresh connection, the stuck one being gone from the pool.
        proxy.stall('off');
        await tick(store);
        expect(pool.totalCount).toBe(1);
        expect(await swept(lumenId)).toBe(0);
      } finally {
        await proxy.close();
        await pool.end();
      }
    });

    it('fails the job of a tick whose delete waits on a held lock past its deadline, and its queue retries it', async () => {
      await expired(lumenId, 4, 'stuck-lock-');
      const producer = await NestTest.createTestingModule({
        imports: [
          JobsRuntimeModule.forRoot({
            connection: {
              connectionString: app.get<pg.Pool>(DATABASE_POOL).options.connectionString ?? '',
            },
            queues: jobQueues,
            capabilities: ['producer'],
            poolSize: 1,
          }),
        ],
      }).compile();
      await producer.init();
      const holder: pg.PoolClient = await stack.migrator.connect();
      try {
        await holder.query('begin');
        await holder.query('lock table invitation_batch_replays in access exclusive mode');
        // The worker of the application runs the job on its own store and pool.
        const { jobId } = await app
          .get(SystemTransactionRunner)
          .run(({ client }) =>
            producer
              .get(JobProducer)
              .enqueue(
                { client, organizationId: null },
                PURGE_INVITATION_BATCH_REPLAYS_QUEUE,
                null,
              ),
          );

        // The attempt failed and the job waits for its retry, delayed by the backoff of the queue
        // (pg-boss counts a retry once it starts).
        await vi.waitFor(
          async () => {
            const [job] = (
              await stack.migrator.query<{
                state: string;
                retry_count: number;
                delayed: boolean;
              }>(
                `select state, retry_count, start_after > now() as delayed
                 from pgboss.job where id = $1`,
                [jobId],
              )
            ).rows;
            expect(job).toEqual({ state: 'retry', retry_count: 0, delayed: true });
          },
          { timeout: 30_000, interval: 200 },
        );
      } finally {
        await holder.query('rollback');
        holder.release();
        await producer.close();
      }
      expect(await swept(lumenId)).toBe(4);

      await app
        .get(PurgeInvitationBatchReplaysHandler)
        .handle({ organizationId: null, signal: new AbortController().signal });
      expect(await swept(lumenId)).toBe(0);
    });

    it('finds the expired records of both purges by an index range on their expiry', async () => {
      /**
       * The index scans of the plan of a statement, sequential scans disabled.
       *
       * @param statement - The statement.
       * @returns Each index scan with its index and condition.
       */
      async function indexScansOf(
        statement: SQL,
      ): Promise<{ readonly index: string; readonly condition: string }[]> {
        const plan: unknown = await app.get(SystemTransactionRunner).run(
          async ({ db }) => {
            await db.execute(sql`set local enable_seqscan = off`);
            const result = await db.execute<{ 'QUERY PLAN': unknown }>(
              sql`explain (format json) ${statement}`,
            );
            return result.rows[0]?.['QUERY PLAN'];
          },
          { readOnly: true },
        );
        const scans: { readonly index: string; readonly condition: string }[] = [];
        const visit = (node: unknown): void => {
          if (Array.isArray(node)) {
            node.forEach(visit);
            return;
          }
          if (typeof node !== 'object' || node === null) return;
          const fields = node as Record<string, unknown>;
          if (typeof fields['Index Name'] === 'string') {
            scans.push({
              index: fields['Index Name'],
              condition: typeof fields['Index Cond'] === 'string' ? fields['Index Cond'] : '',
            });
          }
          Object.values(fields).forEach(visit);
        };
        visit(plan);
        return scans;
      }

      expect(await indexScansOf(expiredPurgeOf(500))).toContainEqual({
        index: 'invitation_batch_replays_expiry_index',
        condition: '(expires_at <= statement_timestamp())',
      });
      expect(await indexScansOf(inlinePurgeOf(atelierNordId))).toContainEqual({
        index: 'invitation_batch_replays_organization_expiry_index',
        condition: expect.stringMatching(
          /organization_id = .*expires_at <= statement_timestamp\(\)/u,
        ) as string,
      });
    });
  });

  describe('rollback cleanup of MODULE.md', () => {
    it('removes the purge schedule and the expired records only, as the migrator', async () => {
      // The schedule as a replica registers it, with a yearly expression so it never fires here.
      await app.get(JobScheduler).schedule(PURGE_INVITATION_BATCH_REPLAYS_QUEUE, '0 0 1 1 *', {
        key: 'minutely',
        timeZone: 'UTC',
      });
      await stack.system(
        `insert into invitation_batch_replays
           (organization_id, actor_user_id, key_digest, request_digest, state, outcome, expires_at)
         values ($1, $2, repeat('b', 64), repeat('a', 64), 'committed', '[]'::jsonb,
                 now() - interval '1 minute')`,
        [lumenId, newId()],
      );
      const live: number = await count(
        `select count(*)::int as count from invitation_batch_replays
         where organization_id = $1 and expires_at > now()`,
        lumenId,
      );

      await stack.migrator.query(
        `DELETE FROM pgboss.schedule
         WHERE name = 'organization.purge-invitation-batch-replays' AND COALESCE(key, '') = 'minutely'`,
      );
      const client: pg.PoolClient = await stack.migrator.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.system_access', 'on', true)`);
        await client.query(
          'DELETE FROM invitation_batch_replays WHERE expires_at < clock_timestamp()',
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const schedules = await stack.migrator.query<{ name: string }>(
        `select name from pgboss.schedule where name = $1`,
        [PURGE_INVITATION_BATCH_REPLAYS_QUEUE],
      );
      expect(schedules.rows).toEqual([]);
      expect(
        await count(
          `select count(*)::int as count from invitation_batch_replays
           where organization_id = $1 and expires_at <= now()`,
          lumenId,
        ),
      ).toBe(0);
      expect(
        await count(
          `select count(*)::int as count from invitation_batch_replays
           where organization_id = $1 and expires_at > now()`,
          lumenId,
        ),
      ).toBe(live);
      expect(live).toBeGreaterThan(0);
    });
  });

  describe('getInvitation', () => {
    /**
     * Invites one address to Atelier Nord as Camille.
     *
     * @param email - The address.
     * @returns The id of the invitation.
     */
    async function invited(email: string): Promise<string> {
      const response: Response = await call('post', INVITATIONS, camille, atelierNordId, {
        body: { emails: [email], role: 'member' },
      });
      expect(response.status).toBe(200);
      return (response.body as InvitationBatchResult).invitations[0]?.invitationId ?? '';
    }

    /**
     * Reads an invitation as Camille, checked against the contract.
     *
     * @param invitationId - The invitation.
     * @returns The body.
     */
    async function read(invitationId: string): Promise<InvitationState> {
      const response: Response = await call(
        'get',
        `${INVITATIONS}/${invitationId}`,
        camille,
        atelierNordId,
      );
      expect(response.status).toBe(200);
      expect(GetInvitationInternalResponse.parse(response.body)).toEqual(response.body);
      return response.body as InvitationState;
    }

    it('answers a pending invitation, then the same one expired', async () => {
      const invitationId: string = await invited('wendy@ateliernord.fr');

      expect(await read(invitationId)).toMatchObject({
        id: invitationId,
        email: 'wendy@ateliernord.fr',
        role: 'member',
        invitedBy: { userId: camille.id, name: 'Camille Martin' },
        status: 'pending',
        answeredAt: null,
        revokedAt: null,
        version: 1,
      });

      await stack.system(
        `update invitations set sent_at = now() - interval '8 days',
         expires_at = now() - interval '1 day' where id = $1`,
        [invitationId],
      );
      expect(await read(invitationId)).toMatchObject({
        status: 'expired',
        answeredAt: null,
        revokedAt: null,
      });
    });

    it('answers without ETag and never 304, even to a copy tagged by the version', async () => {
      const invitationId: string = await invited('xena@ateliernord.fr');
      const path = `${INVITATIONS}/${invitationId}`;
      const pending: Response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', await stack.bearer(camille.id, atelierNordId));
      const tag = '"1"';
      await stack.system(
        `update invitations set sent_at = now() - interval '8 days',
         expires_at = now() - interval '1 day' where id = $1`,
        [invitationId],
      );

      const revalidated: Response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', await stack.bearer(camille.id, atelierNordId))
        .set('If-None-Match', tag)
        .set('If-Modified-Since', new Date().toUTCString());

      expect(pending.status).toBe(200);
      expect(pending.headers['cache-control']).toBe('private, no-store');
      expect(pending.headers.etag).toBeUndefined();
      expect(pending.headers['content-type']).toMatch(/^application\/json/u);
      expect(GetInvitationInternalResponse.parse(pending.body)).toEqual(pending.body);
      expect(revalidated.status).toBe(200);
      expect(revalidated.headers['cache-control']).toBe('private, no-store');
      expect(revalidated.headers.etag).toBeUndefined();
      expect(revalidated.body).toMatchObject({ id: invitationId, status: 'expired', version: 1 });
    });

    it('reads an invitation accepted just before its expiry as accepted, never expired', async () => {
      const invitationId: string = await invited('ulla@ateliernord.fr');
      const ulla: Account = { id: newId(), name: 'Ulla Berg', email: 'ulla@ateliernord.fr' };
      await stack.system(
        `insert into directory_users (user_id, name, email, email_verified, email_version)
         values ($1, $2, $3, true, 1)`,
        [ulla.id, ulla.name, ulla.email],
      );
      stack.verifiedEmails.set(ulla.id, 1, ulla.email);
      await stack.system(
        `update invitations set sent_at = now() - interval '7 days',
         expires_at = clock_timestamp() + interval '1500 milliseconds' where id = $1`,
        [invitationId],
      );

      const accepted: Response = await call(
        'post',
        `/internal/v1/users/${ulla.id}/invitations/${invitationId}/accept`,
        ulla,
        null,
        { body: {} },
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
      const state: InvitationState = await read(invitationId);

      expect(accepted.status).toBe(200);
      expect(state).toMatchObject({ status: 'accepted', revokedAt: null });
      expect(state.answeredAt).toEqual(expect.any(String));
      expect(new Date(state.answeredAt ?? '').getTime()).toBeLessThan(
        new Date(state.expiresAt).getTime(),
      );
    });

    it('tells an accepted, a refused and a revoked invitation apart', async () => {
      const acceptedId: string = await invited(marc.email);
      const refusedId: string = await invited(lucie.email);
      const revokedId: string = await invited('xavier@ateliernord.fr');

      const accepted: Response = await call(
        'post',
        `/internal/v1/users/${marc.id}/invitations/${acceptedId}/accept`,
        marc,
        null,
        { body: {} },
      );
      const refused: Response = await call(
        'post',
        `/internal/v1/users/${lucie.id}/invitations/${refusedId}/refuse`,
        lucie,
        null,
        { body: {} },
      );
      const revoked: Response = await call(
        'delete',
        `${INVITATIONS}/${revokedId}`,
        camille,
        atelierNordId,
      );
      expect([accepted.status, refused.status, revoked.status]).toEqual([200, 204, 204]);

      const acceptedState: InvitationState = await read(acceptedId);
      const refusedState: InvitationState = await read(refusedId);
      const revokedState: InvitationState = await read(revokedId);

      expect(acceptedState).toMatchObject({ status: 'accepted', revokedAt: null, version: 2 });
      expect(acceptedState.answeredAt).toEqual(expect.any(String));
      expect(refusedState).toMatchObject({ status: 'refused', revokedAt: null, version: 2 });
      expect(refusedState.answeredAt).toEqual(expect.any(String));
      expect(revokedState).toMatchObject({ status: 'revoked', answeredAt: null, version: 2 });
      expect(revokedState.revokedAt).toEqual(expect.any(String));
    });

    it('answers 404 for an invitation of another organization, and refuses other members', async () => {
      const invitationId: string = await invited('yann@ateliernord.fr');

      const elsewhere: Response = await call(
        'get',
        `${INVITATIONS}/${invitationId}`,
        ines,
        lumenId,
      );
      const unknown: Response = await call(
        'get',
        `${INVITATIONS}/${newId()}`,
        camille,
        atelierNordId,
      );
      const member: Response = await call(
        'get',
        `${INVITATIONS}/${invitationId}`,
        hugo,
        atelierNordId,
      );
      const outsider: Response = await call(
        'get',
        `${INVITATIONS}/${invitationId}`,
        lucie,
        atelierNordId,
      );
      const malformed: Response = await call(
        'get',
        `${INVITATIONS}/not-a-uuid`,
        camille,
        atelierNordId,
      );

      expect(elsewhere.status).toBe(404);
      expect(elsewhere.body).toMatchObject({ code: 'invitation.not-found' });
      expect(unknown.status).toBe(404);
      expect(unknown.body).toMatchObject({ code: 'invitation.not-found' });
      expect(member.status).toBe(403);
      expect(member.body).toMatchObject({ code: 'organization.role-forbidden' });
      expect(outsider.status).toBe(404);
      expect(outsider.body).toMatchObject({ code: 'organization.not-found' });
      expect(malformed.status).toBe(400);
      // The policy runs before the guards and the validation: refusals are never cacheable either.
      for (const refused of [elsewhere, unknown, member, outsider, malformed]) {
        expect(refused.headers['cache-control']).toBe('private, no-store');
      }
    });
  });

  it('answers only the client errors each operation declares in the contract', () => {
    const declared: DeclaredErrors = DeclaredErrors.load();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.filter((error) => !declared.declares(error))).toEqual([]);
  });
});
