import { createHash } from 'node:crypto';

import {
  GetInvitationInternalResponse,
  InviteMembersInternalResponse,
} from '@cadenway/contracts/validators/internal/organization-service';
import type {
  InvitationBatchResult,
  InvitationState,
} from '@cadenway/contracts/types/internal/organization-service';
import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { JobScheduler } from '@cadenway/nest-jobs/runtime';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import request from 'supertest';
import type { Response, Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PURGE_INVITATION_BATCH_REPLAYS_QUEUE } from '../src/config/job-queues.js';
import { distinctAddresses } from '../src/modules/organizations/domain/policies/invitations/invitation-batch.policy.js';
import { InvitationBatchRequest } from '../src/modules/organizations/domain/value-objects/invitations/invitation-batch-request.value-object.js';
import { inlinePurgeOf } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/invitations/drizzle-invitation-batch-replay.repository.js';
import {
  ExpiredInvitationBatchReplays,
  expiredPurgeOf,
} from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/invitations/expired-invitation-batch-replays.repository.js';
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
   * The advisory lock name the service takes for a scoped key and a `member` batch.
   *
   * @param organizationId - The organization.
   * @param account - The actor.
   * @param key - The key.
   * @param emails - The addresses of the batch.
   * @returns The lock name.
   */
  function lockName(
    organizationId: string,
    account: Account,
    key: string,
    emails: readonly string[],
  ): string {
    return `invitation-batch:${organizationId}:${account.id}:${digestOf(key)}:${digestOf(canonicalOf(emails))}`;
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

    it('answers request-in-progress while another transaction holds the key, and frees it when that one dies', async () => {
      const holder: pg.PoolClient = await stack.migrator.connect();
      holder.on('error', () => undefined);
      const busy = 'members-page-batch-busy';
      try {
        await holder.query('begin');
        const [backend] = (
          await holder.query<{ pid: number }>(
            'select pg_backend_pid() as pid, pg_advisory_xact_lock(hashtextextended($1, 0))',
            [lockName(atelierNordId, ines, busy, ['nina@ateliernord.fr'])],
          )
        ).rows;

        const running: Response = await invite(ines, atelierNordId, busy, ['Nina@AtelierNord.fr']);
        expect(running.status).toBe(409);
        expect(running.body).toMatchObject({ code: 'idempotency.request-in-progress' });
        expect(await effects(atelierNordId)).toMatchObject({ invitations: 2, replays: 1 });

        // The transaction is never committed nor rolled back: its backend ends, as the
        // connection of a crashed process would, and PostgreSQL releases its locks.
        await stack.migrator.query('select pg_terminate_backend($1, 5000)', [backend?.pid]);
      } finally {
        holder.release(true);
      }

      const freed: Response = await invite(ines, atelierNordId, busy, ['nina@ateliernord.fr']);
      expect(freed.status).toBe(200);
      expect((freed.body as InvitationBatchResult).invitations[0]?.outcome).toBe('invited');
    });

    it('lets another batch under a key run while an equivalent one is in flight, then refuses the latter', async () => {
      const holder: pg.PoolClient = await stack.migrator.connect();
      const shared = 'members-page-batch-shared';
      try {
        await holder.query('begin');
        await holder.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          lockName(atelierNordId, ines, shared, ['pia@ateliernord.fr']),
        ]);

        const other: Response = await invite(ines, atelierNordId, shared, ['olga@ateliernord.fr']);
        expect(other.status).toBe(200);
        expect((other.body as InvitationBatchResult).invitations[0]?.outcome).toBe('invited');
        await holder.query('rollback');
      } finally {
        holder.release();
      }

      const late: Response = await invite(ines, atelierNordId, shared, ['pia@ateliernord.fr']);
      expect(late.status).toBe(422);
      expect(late.body).toMatchObject({ code: 'idempotency.key-reused' });
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

      const [left, right] = await Promise.all([
        invite(ines, atelierNordId, contested, ['leo@ateliernord.fr']),
        invite(ines, atelierNordId, contested, ['mia@ateliernord.fr']),
      ]);

      const statuses: number[] = [left.status, right.status].sort();
      expect(statuses).toEqual([200, 422]);
      const refused: Response = left.status === 422 ? left : right;
      expect(refused.body).toMatchObject({ code: 'idempotency.key-reused' });
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
      const pending: Promise<Response>[] = [
        invite(ines, lyonId, key, ['noe@ateliernord.fr']),
        invite(ines, lyonId, key, ['oscar@ateliernord.fr']),
      ];
      try {
        await lock.waiting(2);
      } finally {
        await lock.release();
      }
      const responses: Response[] = await Promise.all(pending);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 422]);
      expect(responses.find((response) => response.status === 422)?.body).toMatchObject({
        code: 'idempotency.key-reused',
      });
      expect(await effects(lyonId)).toMatchObject({ invitations: 2, emails: 100, replays: 1 });
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
      // The original batch, in flight: its claim is held and its record written, not committed.
      const original: pg.PoolClient = await stack.migrator.connect();
      let retries: Response[];
      let probes: { readonly status: number; readonly durationMs: number }[];
      let retriesMs: number;
      try {
        await original.query('begin');
        await original.query(`select set_config('app.system_access', 'on', true)`);
        await original.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          lockName(atelierNordId, ines, racing, emails),
        ]);
        await original.query(
          `insert into invitation_batch_replays
             (organization_id, actor_user_id, key_digest, request_digest, outcome, expires_at)
           values ($1, $2, $3, $4, $5, clock_timestamp() + interval '24 hours')`,
          [
            atelierNordId,
            ines.id,
            digestOf(racing),
            digestOf(canonicalOf(emails)),
            JSON.stringify(outcome.invitations),
          ],
        );
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
        retries = await Promise.all(pendingRetries);
        retriesMs = Date.now() - started;
        probes = await Promise.all(pendingProbes);
      } finally {
        await original.query('commit');
        original.release();
      }
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
        `create trigger fail_invitation_batch_replay before insert on invitation_batch_replays
         for each row execute function fail_invitation_batch_replay()`,
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
      const formerKey = 'members-page-batch-1';
      const fromFormer: Response = await inviteKeyed(formerKey, [
        'paul.lefevre@ateliernord.fr',
        'sarah.morel@ateliernord.fr',
      ]);
      const reusedOnKeyed: Response = await inviteKeyed(formerKey, ['sarah.morel@ateliernord.fr']);

      const keyedKey = 'members-page-batch-keyed';
      const created: Response = await inviteKeyed(keyedKey, ['yves@ateliernord.fr']);
      const fromKeyed: Response = await invite(ines, atelierNordId, keyedKey, [
        'Yves@AtelierNord.fr',
      ]);
      const reusedOnFormer: Response = await invite(ines, atelierNordId, keyedKey, [
        'zack@ateliernord.fr',
      ]);

      expect(fromFormer.status).toBe(200);
      expect(fromFormer.body).toEqual(first);
      expect(InviteMembersInternalResponse.parse(fromFormer.body)).toEqual(fromFormer.body);
      expect(reusedOnKeyed.status).toBe(422);
      expect(reusedOnKeyed.body).toMatchObject({ code: 'idempotency.key-reused' });
      expect(created.status).toBe(200);
      expect(fromKeyed.status).toBe(200);
      expect(fromKeyed.body).toEqual(created.body);
      expect(reusedOnFormer.status).toBe(422);
      expect(await effects(atelierNordId)).toEqual({
        invitations: (before.invitations ?? 0) + 1,
        emails: (before.emails ?? 0) + 1,
        events: (before.events ?? 0) + 1,
        replays: (before.replays ?? 0) + 1,
      });
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
           (organization_id, actor_user_id, key_digest, request_digest, outcome, expires_at)
         select $1, $2, encode(sha256(convert_to($3 || g, 'UTF8')), 'hex'), repeat('a', 64),
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

      const deleted: number | null = await new ExpiredInvitationBatchReplays(
        app.get(SystemTransactionRunner),
      ).purge(3, { deadline: Date.now() + 5_000, signal: new AbortController().signal });
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

      const purge = new ExpiredInvitationBatchReplays(system);
      const batches: (number | null)[] = [];
      for (let round = 0; round < 3; round += 1) {
        batches.push(
          await purge.purge(500, {
            deadline: Date.now() + 5_000,
            signal: new AbortController().signal,
          }),
        );
      }

      expect(batches).toEqual([500, 500, 230]);
      expect((await swept(atelierNordId)) + (await swept(lumenId))).toBe(0);
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
           (organization_id, actor_user_id, key_digest, request_digest, outcome, expires_at)
         values ($1, $2, repeat('b', 64), repeat('a', 64), '[]'::jsonb, now() - interval '1 minute')`,
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
    });
  });

  it('answers only the client errors each operation declares in the contract', () => {
    const declared: DeclaredErrors = DeclaredErrors.load();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.filter((error) => !declared.declares(error))).toEqual([]);
  });
});
