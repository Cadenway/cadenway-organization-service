import { createHash } from 'node:crypto';

import {
  GetInvitationInternalResponse,
  InviteMembersInternalResponse,
} from '@cadenway/contracts/validators/internal/organization-service';
import type {
  InvitationBatchResult,
  InvitationState,
} from '@cadenway/contracts/types/internal/organization-service';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import request from 'supertest';
import type { Response, Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
   * The advisory lock name the service takes for a scoped key.
   *
   * @param organizationId - The organization.
   * @param account - The actor.
   * @param key - The key.
   * @returns The lock name.
   */
  function lockName(organizationId: string, account: Account, key: string): string {
    const digest: string = createHash('sha256').update(key, 'utf8').digest('hex');
    return `invitation-batch:${organizationId}:${account.id}:${digest}`;
  }

  beforeAll(async () => {
    stack = await ServiceStack.start('invitation-idempotency');
    app = await stack.startApplication();
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
    let first: InvitationBatchResult;

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
            [lockName(atelierNordId, ines, busy)],
          )
        ).rows;

        const running: Response = await invite(ines, atelierNordId, busy, ['nina@ateliernord.fr']);
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
