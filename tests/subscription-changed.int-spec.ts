import {
  SUBSCRIPTION_CHANGED_V1,
  subscriptionChangedV1Schema,
} from '@cadenway/contracts/events/billing-service';
import type { SubscriptionChangedV1 } from '@cadenway/contracts/events/billing-service';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { newId, ServiceStack } from './support/service-stack.js';

const durable = 'organization-service__project-seat-entitlement';

function snapshot(
  organizationId: string,
  version: number,
  seatLimit: number,
  plan = 'team',
  storageByteLimit = 100_000_000_000,
): SubscriptionChangedV1 {
  return subscriptionChangedV1Schema.parse({
    id: newId(),
    occurredAt: new Date().toISOString(),
    organizationId,
    actor: { type: 'system', id: 'billing-service' },
    version,
    plan,
    seatLimit,
    storageByteLimit,
  });
}

describe('Billing seat entitlement subscription', () => {
  const atelier = newId();
  const lumen = newId();
  const retained = snapshot(atelier, 2, 18);
  let stack: ServiceStack;
  let app: NestExpressApplication;

  async function addOrganization(id: string, name: string, slug: string): Promise<void> {
    await stack.system(
      `insert into organizations
        (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, $2, lower($2), $3, 'fr', '1-5', 'other', $4)`,
      [id, name, slug, newId()],
    );
  }

  function projections(): Promise<
    { organization_id: string; version: number; seat_limit: number }[]
  > {
    return stack.system(
      `select organization_id, version::int, seat_limit::int
         from organization_seat_entitlements order by organization_id`,
    );
  }

  function processed(eventId: string): Promise<{ event_id: string }[]> {
    return stack.system(
      `select event_id from processed_events where consumer = $1 and event_id = $2`,
      [durable, eventId],
    );
  }

  async function drained(deliveries: number): Promise<void> {
    await vi.waitFor(
      () => {
        const state = stack.consumer(durable);
        expect(state.delivered.consumer_seq).toBeGreaterThanOrEqual(deliveries);
        expect(state.num_pending).toBe(0);
        expect(state.num_ack_pending).toBe(0);
      },
      { timeout: 20_000, interval: 500 },
    );
  }

  beforeAll(async () => {
    stack = await ServiceStack.start('seat-entitlement-events');
    await addOrganization(atelier, 'Atelier Nord', 'atelier-nord');
    await addOrganization(lumen, 'Coopérative Lumen', 'cooperative-lumen');
    stack.publish(SUBSCRIPTION_CHANGED_V1, retained);
    vi.stubEnv('ORGANIZATION_SEAT_ENTITLEMENT_EVENTS_ENABLED', 'true');
    vi.stubEnv('ORGANIZATION_SEAT_QUOTA_ENABLED', 'true');
    app = await stack.startApplication();
    await drained(1);
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('projects a retained delivery in its own tenant and atomically records the event ID', async () => {
    expect(stack.consumer(durable).config).toMatchObject({
      filter_subject: 'evt.subscription.changed.v1',
      deliver_policy: 'all',
      max_deliver: 32,
    });
    expect(await projections()).toEqual([{ organization_id: atelier, version: 2, seat_limit: 18 }]);
    expect(await processed(retained.id)).toEqual([{ event_id: retained.id }]);
  });

  it('isolates version fences by tenant and ignores duplicates, stale versions and decreases', async () => {
    const before = stack.consumer(durable).delivered.consumer_seq;
    const otherTenant = snapshot(lumen, 1, 12);
    stack.publish(SUBSCRIPTION_CHANGED_V1, retained, newId());
    stack.publish(SUBSCRIPTION_CHANGED_V1, snapshot(atelier, 1, 30));
    stack.publish(SUBSCRIPTION_CHANGED_V1, snapshot(atelier, 2, 30));
    stack.publish(SUBSCRIPTION_CHANGED_V1, snapshot(atelier, 3, 16));
    stack.publish(SUBSCRIPTION_CHANGED_V1, otherTenant);

    await drained(before + 5);

    const projected = await projections();
    expect(projected).toHaveLength(2);
    expect(projected).toEqual(
      expect.arrayContaining([
        { organization_id: atelier, version: 2, seat_limit: 18 },
        { organization_id: lumen, version: 1, seat_limit: 12 },
      ]),
    );
    expect(await processed(retained.id)).toEqual([{ event_id: retained.id }]);
    expect(await processed(otherTenant.id)).toEqual([{ event_id: otherTenant.id }]);
  });

  it('rejects noncanonical actor claims before recording a processed event', async () => {
    const before = stack.consumer(durable).delivered.consumer_seq;
    const wrongIssuer = {
      ...snapshot(atelier, 4, 50),
      actor: { type: 'system', id: 'storage-service' },
    };
    const wrongActor = {
      ...snapshot(atelier, 5, 60),
      actor: { type: 'user', id: 'billing-service' },
    };
    stack.publish(SUBSCRIPTION_CHANGED_V1, wrongIssuer);
    stack.publish(SUBSCRIPTION_CHANGED_V1, wrongActor);

    await drained(before + 2);

    expect(await projections()).toContainEqual({
      organization_id: atelier,
      version: 2,
      seat_limit: 18,
    });
    expect(await processed(wrongIssuer.id)).toEqual([]);
    expect(await processed(wrongActor.id)).toEqual([]);
  });

  it('projects an extensible Billing plan identifier longer than 255 characters', async () => {
    const before = stack.consumer(durable).delivered.consumer_seq;
    const plan = `future-${'x'.repeat(256)}`;
    const event = snapshot(lumen, 2, 20, plan);
    stack.publish(SUBSCRIPTION_CHANGED_V1, event);

    await drained(before + 1);

    const rows = await stack.system<{ plan: string; version: number; seat_limit: number }>(
      `select plan, version::int, seat_limit::int
         from organization_seat_entitlements where organization_id = $1`,
      [lumen],
    );
    expect(rows).toEqual([{ plan, version: 2, seat_limit: 20 }]);
    expect(await processed(event.id)).toEqual([{ event_id: event.id }]);
  });

  it('returns to Free under the seat lock without removing existing members', async () => {
    const organizationId = newId();
    const ownerUserId = newId();
    const guestUserId = newId();
    const guestMemberId = newId();
    const memberUserIds = Array.from({ length: 5 }, () => newId());
    await stack.system(
      `insert into organizations
        (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Atelier Gratuit', 'atelier gratuit', 'atelier-gratuit', 'fr', '1-5', 'other', $2)`,
      [organizationId, ownerUserId],
    );
    await stack.system(
      `insert into directory_users (user_id, name, name_key, email)
       select id, 'Membre', 'membre', id::text || '@example.test'
       from unnest($1::uuid[]) as id`,
      [[ownerUserId, guestUserId, ...memberUserIds]],
    );
    await stack.system(
      `insert into members (id, organization_id, user_id, role, joined_at)
       values ($1, $2, $3, 'owner', now()), ($4, $2, $5, 'guest', now())`,
      [newId(), organizationId, ownerUserId, guestMemberId, guestUserId],
    );
    for (const memberUserId of memberUserIds) {
      await stack.system(
        `insert into members (id, organization_id, user_id, role, joined_at)
         values ($1, $2, $3, 'member', now())`,
        [newId(), organizationId, memberUserId],
      );
    }
    const team = snapshot(organizationId, 1, 18);
    const free = snapshot(organizationId, 2, 5, 'free', 2_000_000_000);
    let deliveries = stack.consumer(durable).delivered.consumer_seq;
    stack.publish(SUBSCRIPTION_CHANGED_V1, team);
    await drained(++deliveries);
    const wrongStorage = snapshot(organizationId, 2, 5, 'free');
    stack.publish(SUBSCRIPTION_CHANGED_V1, wrongStorage);
    await drained(++deliveries);
    expect(await projections()).toContainEqual({
      organization_id: organizationId,
      version: 1,
      seat_limit: 18,
    });

    // Hold the same advisory lock as seat admission while the real JetStream handler starts.
    const blocker = await stack.migrator.connect();
    try {
      await blocker.query('begin');
      await blocker.query(
        `select pg_advisory_xact_lock(hashtextextended('organization-seat-admission:' || $1::uuid::text, 0))`,
        [organizationId],
      );
      const blockerPid = await blocker.query<{ pid: number }>('select pg_backend_pid() as pid');
      const pid = blockerPid.rows[0]?.pid;
      if (pid === undefined) throw new Error('The seat lock holder has no PostgreSQL process ID.');
      stack.publish(SUBSCRIPTION_CHANGED_V1, free);
      await vi.waitFor(
        async () => {
          expect(stack.consumer(durable).num_ack_pending).toBe(1);
          const waiters = await stack.system<{ count: number }>(
            'select count(*)::int as count from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
            [pid],
          );
          expect(waiters[0]?.count).toBeGreaterThanOrEqual(1);
        },
        { timeout: 4_000, interval: 100 },
      );
      expect(await processed(free.id)).toEqual([]);
    } finally {
      await blocker.query('commit');
      blocker.release();
    }
    await drained(++deliveries);
    expect(await projections()).toContainEqual({
      organization_id: organizationId,
      version: 2,
      seat_limit: 5,
    });
    expect(await processed(free.id)).toEqual([{ event_id: free.id }]);

    const replay = snapshot(organizationId, 2, 5, 'free', 2_000_000_000);
    const stale = snapshot(organizationId, 1, 18);
    const conflicting = snapshot(organizationId, 2, 18);
    const noncanonical = snapshot(organizationId, 3, 4, 'free', 2_000_000_000);
    stack.publish(SUBSCRIPTION_CHANGED_V1, free, newId());
    stack.publish(SUBSCRIPTION_CHANGED_V1, replay);
    stack.publish(SUBSCRIPTION_CHANGED_V1, stale);
    stack.publish(SUBSCRIPTION_CHANGED_V1, conflicting);
    stack.publish(SUBSCRIPTION_CHANGED_V1, noncanonical);
    deliveries += 5;
    await drained(deliveries);
    expect(await projections()).toContainEqual({
      organization_id: organizationId,
      version: 2,
      seat_limit: 5,
    });
    expect(
      await stack.system<{ role: string; count: number }>(
        `select role, count(*)::int as count from members
       where organization_id = $1 and removed_at is null group by role order by role`,
        [organizationId],
      ),
    ).toEqual([
      { role: 'guest', count: 1 },
      { role: 'member', count: 5 },
      { role: 'owner', count: 1 },
    ]);
    const promotion = await request(app.getHttpServer())
      .patch(`/internal/v1/members/${guestMemberId}`)
      .set('Authorization', await stack.bearer(ownerUserId, organizationId))
      .set('If-Match', '"1"')
      .send({ role: 'member' });
    expect(promotion.status).toBe(409);
    expect(promotion.body).toMatchObject({ code: 'organization.seat-quota-exceeded' });
  });

  it('rolls back the event ID on an uncommitted projection and retries the same delivery', async () => {
    const before = stack.consumer(durable).delivered.consumer_seq;
    const organizationId = newId();
    const event = snapshot(organizationId, 1, 10);
    stack.publish(SUBSCRIPTION_CHANGED_V1, event);
    await vi.waitFor(
      () => {
        const state = stack.consumer(durable);
        expect(state.delivered.consumer_seq).toBeGreaterThanOrEqual(before + 2);
        expect(state.num_ack_pending).toBe(1);
      },
      { timeout: 20_000, interval: 250 },
    );
    expect(await processed(event.id)).toEqual([]);

    await addOrganization(organizationId, 'Studio Minuit', 'studio-minuit');
    await drained(before + 3);

    expect(await projections()).toContainEqual({
      organization_id: organizationId,
      version: 1,
      seat_limit: 10,
    });
    expect(await processed(event.id)).toEqual([{ event_id: event.id }]);
  });
});
