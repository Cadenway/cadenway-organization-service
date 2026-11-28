import { createHash } from 'node:crypto';

import { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { JobScheduler } from '@cadenway/nest-jobs/runtime';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type pg from 'pg';
import request from 'supertest';
import type { Response, Test } from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PURGE_INVITATION_BATCH_REPLAYS_QUEUE } from '../src/config/job-queues.js';
import { distinctAddresses } from '../src/modules/organizations/domain/policies/invitations/invitation-batch.policy.js';
import { InvitationBatchRequest } from '../src/modules/organizations/domain/value-objects/invitations/invitation-batch-request.value-object.js';
import {
  keyedBatchUsageOf,
  reclaimedReservationsOf,
} from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/invitations/drizzle-invitation-batch-replay.repository.js';
import { DeclaredErrors } from './support/declared-errors.js';
import type { SeenError } from './support/declared-errors.js';
import { newId, ServiceStack } from './support/service-stack.js';

// A replay record budget of 3 keyed batches per organization instead of 1,000, injected through the
// constant the composition passes to `InviteMembers`, so the budget is reached without 1,000 rows.
vi.mock(
  '../src/modules/organizations/domain/policies/invitations/keyed-invitation-batch-budget.policy.js',
  async (importOriginal: () => Promise<Record<string, unknown>>) => ({
    ...(await importOriginal()),
    KEYED_INVITATION_BATCH_BUDGET: 3,
  }),
);

// The replay record budget of keyed invitation batches (`429 invitation.keyed-batch-limit-reached`,
// `openapi/internal/organization-service.yaml` of `@cadenway/contracts` 0.47.0), on real PostgreSQL
// and NATS, with the people of the mockup: Inès Robert owns each organization of a test, Hugo Dubois
// is a member of it, so a batch of his address sends no email and uses no daily allowance.

/** The budget the tests inject. */
const BUDGET = 3;

/** An account of identity-service. */
interface Account {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

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

const KEYED = '/internal/v1/invitation-batches';
const INVITATIONS = '/internal/v1/invitations';

describe('replay record budget of keyed invitation batches', () => {
  let stack: ServiceStack;
  let app: NestExpressApplication;
  let organizations = 0;

  /** Every client error a route answered, checked against the contract at the end. */
  const errors: SeenError[] = [];

  /**
   * Sends a batch of Inès as the gateway would.
   *
   * @param organizationId - The organization of the token.
   * @param options - The route, the key and the addresses.
   * @returns The response.
   */
  async function invite(
    organizationId: string,
    options: {
      readonly key?: string;
      readonly path?: string;
      readonly emails?: readonly string[];
    } = {},
  ): Promise<Response> {
    const path: string = options.path ?? (options.key === undefined ? INVITATIONS : KEYED);
    let pending: Test = request(app.getHttpServer())
      .post(path)
      .set('Authorization', await stack.bearer(ines.id, organizationId));
    if (options.key !== undefined) {
      pending = pending.set('Idempotency-Key', options.key);
    }
    const response: Response = await pending.send({
      emails: options.emails ?? [hugo.email],
      role: 'member',
    });
    const code: unknown = (response.body as { code?: unknown } | undefined)?.code;
    if (response.status >= 400 && response.status < 500 && typeof code === 'string') {
      errors.push({ method: 'post', path, status: response.status, code });
    }
    return response;
  }

  /**
   * Creates an organization of its own for a test: Inès owns it, Hugo is a member.
   *
   * @returns Its id.
   */
  async function organization(): Promise<string> {
    organizations += 1;
    const id: string = newId();
    await stack.system(
      `insert into organizations
       (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, $2, $3, $4, 'fr', '6-20', 'other', $5)`,
      [
        id,
        `Atelier Nord ${String(organizations)}`,
        `atelier nord ${String(organizations)}`,
        `atelier-nord-${String(organizations)}`,
        ines.id,
      ],
    );
    await stack.system(
      `insert into members (organization_id, user_id, role, joined_at)
       values ($1, $2, 'owner', now()), ($1, $3, 'member', now())`,
      [id, ines.id, hugo.id],
    );
    return id;
  }

  /**
   * The SHA-256 digest, in hexadecimal, a key is stored under.
   *
   * @param value - The key.
   * @returns The digest.
   */
  function digestOf(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  /**
   * Writes keyed batches of Inès directly, as a running batch (or a release that predates the
   * budget) leaves them: reservations under a lease, or records stored some time ago.
   *
   * @param organizationId - The organization.
   * @param state - `reserved` or `committed`.
   * @param secondsLeft - For each row, the seconds until its lease or its 24 hours end.
   */
  async function held(
    organizationId: string,
    state: 'reserved' | 'committed',
    secondsLeft: readonly number[],
  ): Promise<void> {
    for (const seconds of secondsLeft) {
      await stack.system(
        `insert into invitation_batch_replays
           (organization_id, actor_user_id, key_digest, request_digest, state, lease_id, outcome,
            expires_at)
         values ($1, $2, $3, $4, $5, case when $5 = 'reserved' then uuidv7() end,
                 case when $5 = 'committed' then '[]'::jsonb end,
                 clock_timestamp() + make_interval(secs => $6))`,
        [organizationId, ines.id, digestOf(newId()), digestOf(newId()), state, seconds],
      );
    }
  }

  /**
   * The rows a batch could write in an organization, to compare before and after a request.
   *
   * @param organizationId - The organization.
   * @returns The counts.
   */
  async function effects(organizationId: string): Promise<Record<string, number>> {
    const [row] = await stack.system<Record<string, number>>(
      `select
         (select count(*)::int from invitations where organization_id = $1) as invitations,
         (select count(*)::int from invitation_emails where organization_id = $1) as emails,
         (select count(*)::int from outbox_events
          where organization_id = $1 and event_name = 'invitation.issued.v1') as events,
         (select count(*)::int from invitation_batch_replays where organization_id = $1)
           as replays`,
      [organizationId],
    );
    return row ?? {};
  }

  /**
   * The expiry of the `rank`-th oldest stored outcome of an organization, in whole milliseconds
   * rounded up, as `details.nextAvailableAt` reports it.
   *
   * @param organizationId - The organization.
   * @param rank - One-based rank, oldest first.
   * @returns The ISO 8601 instant.
   */
  async function storedExpiry(organizationId: string, rank: number): Promise<string> {
    const [row] = await stack.system<{ epoch: number }>(
      `select ceil(extract(epoch from expires_at) * 1000)::float8 as epoch
       from invitation_batch_replays
       where organization_id = $1 and state = 'committed'
       order by expires_at offset $2 limit 1`,
      [organizationId, rank - 1],
    );
    return new Date(row?.epoch ?? 0).toISOString();
  }

  /**
   * Checks a refusal of the budget: the problem of the contract and a `Retry-After` of the seconds
   * until `details.nextAvailableAt`, rounded up and 1 at least.
   *
   * @param response - The response.
   * @returns `details.nextAvailableAt`.
   */
  function limited(response: Response): Date {
    expect(response.status).toBe(429);
    expect(response.body).toMatchObject({
      title: 'Too Many Requests',
      status: 429,
      code: 'invitation.keyed-batch-limit-reached',
    });
    const details = (response.body as { details?: Record<string, unknown> }).details ?? {};
    expect(Object.keys(details)).toEqual(['nextAvailableAt']);
    const next: Date = new Date(String(details.nextAvailableAt));
    const expected: number = Math.max(1, Math.ceil((next.getTime() - Date.now()) / 1000));
    const retryAfter = Number(response.headers['retry-after']);
    // The header was computed a moment before `expected`, so it may be a little larger.
    expect(retryAfter).toBeGreaterThanOrEqual(expected);
    expect(retryAfter).toBeLessThanOrEqual(expected + 2);
    return next;
  }

  /**
   * Leaves a batch of Inès (her address-of-a-member batch) running past its lease: its reservation
   * was committed with a lease that ran out, and its transaction renewed it, which nobody else sees,
   * and still holds the row, as `renew` does from the first statement of a batch.
   *
   * @param organizationId - The organization.
   * @param key - The key of the batch.
   * @returns The connection of the batch, in its open transaction: commit or roll it back.
   */
  async function runningPastItsLease(organizationId: string, key: string): Promise<pg.PoolClient> {
    const canonical: string = InvitationBatchRequest.of(
      distinctAddresses([hugo.email]),
      'member',
    ).canonical;
    await stack.system(
      `insert into invitation_batch_replays
         (organization_id, actor_user_id, key_digest, request_digest, state, lease_id, expires_at)
       values ($1, $2, $3, $4, 'reserved', uuidv7(), clock_timestamp() - interval '1 second')`,
      [organizationId, ines.id, digestOf(key), digestOf(canonical)],
    );
    const holder: pg.PoolClient = await stack.migrator.connect();
    await holder.query('begin');
    await holder.query(`select set_config('app.system_access', 'on', true)`);
    await holder.query(
      `update invitation_batch_replays set expires_at = clock_timestamp() + interval '30 seconds'
       where organization_id = $1 and key_digest = $2 and state = 'reserved'`,
      [organizationId, digestOf(key)],
    );
    return holder;
  }

  /**
   * The index scans of the plan of a statement, sequential scans disabled.
   *
   * @param statement - The statement.
   * @returns Each index scan with its index, condition and direction.
   */
  async function indexScansOf(
    statement: SQL,
  ): Promise<{ readonly index: string; readonly condition: string; readonly direction: string }[]> {
    const plan: unknown = await app.get(SystemTransactionRunner).run(async ({ db }) => {
      await db.execute(sql`set local enable_seqscan = off`);
      const result = await db.execute<{ 'QUERY PLAN': unknown }>(
        sql`explain (format json) ${statement}`,
      );
      return result.rows[0]?.['QUERY PLAN'];
    });
    const scans: {
      readonly index: string;
      readonly condition: string;
      readonly direction: string;
    }[] = [];
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
          direction: typeof fields['Scan Direction'] === 'string' ? fields['Scan Direction'] : '',
        });
      }
      Object.values(fields).forEach(visit);
    };
    visit(plan);
    return scans;
  }

  beforeAll(async () => {
    stack = await ServiceStack.start('keyed-batch-budget');
    app = await stack.startApplication();
    // The purge runs on no schedule here: the tests read the rows they wrote.
    await app
      .get(JobScheduler)
      .unschedule(PURGE_INVITATION_BATCH_REPLAYS_QUEUE, { key: 'minutely' });
    await stack.system(
      `insert into directory_users (user_id, name, email, email_verified, email_version)
       values ($1, 'Inès Robert', $2, true, 1), ($3, 'Hugo Dubois', $4, true, 1)`,
      [ines.id, ines.email, hugo.id, hugo.email],
    );
    for (const account of [ines, hugo]) {
      stack.verifiedEmails.set(account.id, 1, account.email);
    }
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('refuses a new key once both routes stored the budget of batches that send no email', async () => {
    const organizationId: string = await organization();
    for (const [index, path] of [KEYED, INVITATIONS, KEYED].entries()) {
      const stored: Response = await invite(organizationId, {
        key: `members-page-${String(index)}`,
        path,
      });
      expect(stored.status).toBe(200);
      expect(stored.body).toMatchObject({ invitations: [{ outcome: 'already-member' }] });
    }
    const before: Record<string, number> = await effects(organizationId);
    expect(before).toMatchObject({ invitations: 0, emails: 0, events: 0, replays: BUDGET });

    for (const path of [KEYED, INVITATIONS]) {
      const refused: Response = await invite(organizationId, {
        key: 'members-page-new',
        path,
        emails: ['lucie.bernard@exemple.fr'],
      });
      // Three stored for three places: the oldest one's expiry frees a place.
      expect(limited(refused).toISOString()).toBe(await storedExpiry(organizationId, 1));
    }
    expect(await effects(organizationId)).toEqual(before);
    const reserved = await stack.system(
      `select 1 from invitation_batch_replays where organization_id = $1 and key_digest = $2`,
      [organizationId, digestOf('members-page-new')],
    );
    expect(reserved).toEqual([]);
  });

  it('still replays, answers 422 and 409, and runs unkeyed batches when the budget is used up', async () => {
    const organizationId: string = await organization();
    const first: Response = await invite(organizationId, { key: 'members-page-replayed' });
    expect(first.status).toBe(200);
    await held(organizationId, 'committed', [3_600]);
    // A batch still running under its lease, as a request in flight leaves it.
    await stack.system(
      `insert into invitation_batch_replays
         (organization_id, actor_user_id, key_digest, request_digest, state, lease_id, expires_at)
       select $1, $2, $3, request_digest, 'reserved', uuidv7(), clock_timestamp() + interval '30 seconds'
       from invitation_batch_replays where organization_id = $1 and key_digest = $4`,
      [
        organizationId,
        ines.id,
        digestOf('members-page-running'),
        digestOf('members-page-replayed'),
      ],
    );
    limited(await invite(organizationId, { key: 'members-page-new' }));

    const replayed: Response = await invite(organizationId, {
      key: 'members-page-replayed',
      path: INVITATIONS,
    });
    const reused: Response = await invite(organizationId, {
      key: 'members-page-replayed',
      emails: ['lucie.bernard@exemple.fr'],
    });
    const running: Response = await invite(organizationId, { key: 'members-page-running' });
    const unkeyed: Response = await invite(organizationId, {
      emails: ['lucie.bernard@exemple.fr'],
    });

    expect(replayed.status).toBe(200);
    expect(replayed.body).toEqual(first.body);
    expect(reused.status).toBe(422);
    expect(reused.body).toMatchObject({ code: 'idempotency.key-reused' });
    expect(running.status).toBe(409);
    expect(running.body).toMatchObject({ code: 'idempotency.request-in-progress' });
    expect(unkeyed.status).toBe(200);
    expect(unkeyed.body).toMatchObject({ invitations: [{ outcome: 'invited' }] });
    expect(await effects(organizationId)).toMatchObject({ invitations: 1, replays: BUDGET });
  });

  it('admits exactly one of concurrent new keys at one place from the budget', async () => {
    const organizationId: string = await organization();
    await held(organizationId, 'committed', [600, 1_200]);

    const responses: Response[] = await Promise.all(
      Array.from({ length: 6 }, (_: unknown, index: number) =>
        invite(organizationId, { key: `members-page-concurrent-${String(index)}` }),
      ),
    );

    const statuses: number[] = responses.map((response: Response) => response.status).sort();
    expect(statuses).toEqual([200, 429, 429, 429, 429, 429]);
    for (const response of responses.filter((answer: Response) => answer.status === 429)) {
      // Three stored for three places: the oldest one frees a place.
      expect(limited(response).toISOString()).toBe(await storedExpiry(organizationId, 1));
    }
    expect(await effects(organizationId)).toMatchObject({ replays: BUDGET });
  });

  it('answers a lease away while running batches alone fill the budget, and frees an expired lease', async () => {
    const organizationId: string = await organization();
    await held(organizationId, 'reserved', [30, 30, 30]);
    await held(organizationId, 'committed', [60]);

    const refused: Response = await invite(organizationId, { key: 'members-page-new' });
    const next: Date = limited(refused);
    // 30 seconds from the read, on the clock of the database.
    expect(next.getTime() - Date.now()).toBeGreaterThan(25_000);
    expect(next.getTime() - Date.now()).toBeLessThanOrEqual(30_000);

    // A running batch that crashed: its lease runs out, so it no longer counts.
    await stack.system(
      `update invitation_batch_replays set expires_at = clock_timestamp() - interval '1 second'
       where ctid = (select ctid from invitation_batch_replays
                     where organization_id = $1 and state = 'reserved' limit 1)`,
      [organizationId],
    );
    const stillFull: Response = await invite(organizationId, { key: 'members-page-new' });
    // Two running and one stored fill the three places: the stored one frees one.
    expect(limited(stillFull).toISOString()).toBe(await storedExpiry(organizationId, 1));
    await stack.system(
      `update invitation_batch_replays set expires_at = clock_timestamp() - interval '1 second'
       where ctid = (select ctid from invitation_batch_replays
                     where organization_id = $1 and state = 'reserved'
                       and expires_at > clock_timestamp() limit 1)`,
      [organizationId],
    );

    const admitted: Response = await invite(organizationId, { key: 'members-page-new' });
    expect(admitted.status).toBe(200);
  });

  it('answers the (count - budget + 1)-th oldest expiry when a former release left more than the budget', async () => {
    const organizationId: string = await organization();
    await held(organizationId, 'committed', [500, 100, 400, 200, 300]);
    await held(organizationId, 'reserved', [30]);

    const refused: Response = await invite(organizationId, { key: 'members-page-new' });

    // Six counted for three places: four must expire, the fourth oldest frees a place.
    expect(limited(refused).toISOString()).toBe(await storedExpiry(organizationId, 4));
  });

  it('keeps counting a batch running past its lease until it commits its record', async () => {
    const organizationId: string = await organization();
    await held(organizationId, 'committed', [600, 1_200]);
    const holder: pg.PoolClient = await runningPastItsLease(organizationId, 'members-page-running');
    try {
      const refused: Response = await invite(organizationId, { key: 'members-page-new' });
      // One running and two stored fill the three places: the older stored one frees one.
      expect(limited(refused).toISOString()).toBe(await storedExpiry(organizationId, 1));

      // Its own key, the same batch or another, answers the retryable 409, never the 429.
      const same: Response = await invite(organizationId, { key: 'members-page-running' });
      const other: Response = await invite(organizationId, {
        key: 'members-page-running',
        emails: ['lucie.bernard@exemple.fr'],
      });
      for (const response of [same, other]) {
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: 'idempotency.request-in-progress' });
      }

      // The batch stores its record and commits: it now counts as that record.
      await holder.query(
        `update invitation_batch_replays
         set state = 'committed', lease_id = null, outcome = '[]'::jsonb,
             expires_at = clock_timestamp() + interval '24 hours'
         where organization_id = $1 and key_digest = $2`,
        [organizationId, digestOf('members-page-running')],
      );
      await holder.query('commit');
    } finally {
      holder.release();
    }
    const stillFull: Response = await invite(organizationId, { key: 'members-page-new' });
    expect(limited(stillFull).toISOString()).toBe(await storedExpiry(organizationId, 1));
    expect(await effects(organizationId)).toMatchObject({ replays: BUDGET });
  });

  it('frees the place of a batch running past its lease once it ends without its record', async () => {
    const organizationId: string = await organization();
    await held(organizationId, 'committed', [600, 1_200]);
    const holder: pg.PoolClient = await runningPastItsLease(organizationId, 'members-page-running');
    try {
      limited(await invite(organizationId, { key: 'members-page-new' }));
      await holder.query('rollback');
    } finally {
      holder.release();
    }

    const admitted: Response = await invite(organizationId, { key: 'members-page-new' });

    expect(admitted.status).toBe(200);
    // The reservation that ended is deleted with the admission, the new one took its place.
    const reservations = await stack.system<{ key_digest: string }>(
      `select key_digest from invitation_batch_replays where organization_id = $1
       and key_digest in ($2, $3)`,
      [organizationId, digestOf('members-page-running'), digestOf('members-page-new')],
    );
    expect(reservations).toEqual([{ key_digest: digestOf('members-page-new') }]);
    expect(await effects(organizationId)).toMatchObject({ replays: BUDGET });
  });

  it('counts the reservations by their own index, whatever records expire meanwhile', async () => {
    const organizationId: string = await organization();
    // A burst of records expiring within the lease window, older records and two reservations,
    // among the records of other organizations, as in a shared table.
    const others: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      others.push(await organization());
    }
    for (const [index, owner] of [organizationId, ...others].entries()) {
      await stack.system(
        `insert into invitation_batch_replays
           (organization_id, actor_user_id, key_digest, request_digest, state, outcome, expires_at)
         select $1, $2, encode(sha256(convert_to($3 || '-key-' || n, 'UTF8')), 'hex'),
                encode(sha256(convert_to($3 || '-batch-' || n, 'UTF8')), 'hex'), 'committed',
                '[]'::jsonb,
                clock_timestamp() + make_interval(secs => case when n <= 400 then 20 else 40000 end)
         from generate_series(1, 800) as n`,
        [owner, ines.id, String(index)],
      );
    }
    await held(organizationId, 'reserved', [30, -5]);
    await stack.system('analyze invitation_batch_replays');

    const reclaim = await indexScansOf(reclaimedReservationsOf(organizationId, BUDGET));
    const usage = await indexScansOf(keyedBatchUsageOf(organizationId, BUDGET));

    expect(reclaim).toContainEqual(
      expect.objectContaining({
        index: 'invitation_batch_replays_reservation_index',
        condition: expect.stringMatching(
          /organization_id = .*expires_at <= statement_timestamp\(\)/u,
        ) as string,
      }),
    );
    expect(usage).toContainEqual(
      expect.objectContaining({
        index: 'invitation_batch_replays_reservation_index',
        condition: expect.stringMatching(/organization_id = /u) as string,
      }),
    );
    expect(usage).toContainEqual(
      expect.objectContaining({
        index: 'invitation_batch_replays_organization_expiry_index',
        condition: expect.stringMatching(
          /organization_id = .*expires_at > statement_timestamp\(\)/u,
        ) as string,
        direction: 'Backward',
      }),
    );
    // No part reads the records of the organization forward through the lease window.
    expect(
      usage.filter(
        (scan) =>
          scan.index === 'invitation_batch_replays_organization_expiry_index' &&
          scan.direction !== 'Backward',
      ),
    ).toEqual([]);
  });

  it('answers only error codes the contract declares', () => {
    const declared: DeclaredErrors = DeclaredErrors.load();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.filter((error) => !declared.declares(error))).toEqual([]);
  });
});
