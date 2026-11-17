import { eventSchemas as identityEvents } from '@cadenway/contracts/events/identity-service';
import type { OrganizationCreated } from '@cadenway/contracts/types/internal/organization-service';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { newId, ServiceStack } from './support/service-stack.js';

// The redelivery of a directory event whose handling fails, on real PostgreSQL and NATS. The
// production schedule (`DIRECTORY_REDELIVERY`: 1 s, 5 s, 30 s, then up to an hour, 32 deliveries)
// is too long to watch, and its first delays are those of the default schedule of the kit; this
// run gives the directory consumers a short schedule that differs from the default at every step:
// 3 s, then 0.5 s, four deliveries. The consumer of `user.deleted.v1` shares it, which lets the
// refused deletion of an owner be watched until its dead letter. `directory-redelivery.model.spec.ts` checks the
// production schedule, and `tests/organizations.int-spec.ts` that the broker applies it.
vi.mock(
  '../src/modules/organizations/application/models/directory/directory-redelivery.model.js',
  () => ({ DIRECTORY_REDELIVERY: { delaysMs: [3_000, 500], maxDeliveries: 4 } }),
);

/** An account of identity-service, as its events describe it. */
interface Account {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

/** Léa Petit: every delivery of her sign-up fails until the dead letter. */
const lea: Account = { id: newId(), name: 'Léa Petit', email: 'lea.petit@ateliernord.fr' };

/** Hugo Dubois: the first two deliveries of his sign-up fail, the third applies it. */
const hugo: Account = { id: newId(), name: 'Hugo Dubois', email: 'hugo.dubois@ateliernord.fr' };

/** Camille Martin, owner of Atelier Nord: a deletion of her account contradicts the contract. */
const camille: Account = {
  id: newId(),
  name: 'Camille Martin',
  email: 'camille.martin@ateliernord.fr',
};

/**
 * `user.signed-up.v1` of an account, validated against the contract.
 *
 * @param account - The account.
 * @returns The payload.
 */
function signedUp(account: Account): { readonly id: string } {
  return identityEvents['user.signed-up.v1'].parse({
    id: newId(),
    occurredAt: new Date().toISOString(),
    organizationId: null,
    actor: { type: 'user', id: account.id },
    version: 1,
    userId: account.id,
    email: account.email,
    name: account.name,
    language: 'fr',
  });
}

/**
 * `user.email-verified.v1` of an account, validated against the contract.
 *
 * @param account - The account.
 * @returns The payload.
 */
function emailVerified(account: Account): { readonly id: string } {
  return identityEvents['user.email-verified.v1'].parse({
    id: newId(),
    occurredAt: new Date().toISOString(),
    organizationId: null,
    actor: { type: 'user', id: account.id },
    version: 2,
    userId: account.id,
    email: account.email,
  });
}

/**
 * `user.deleted.v1` of an account, validated against the contract.
 *
 * @param account - The account.
 * @returns The payload.
 */
function deleted(account: Account): { readonly id: string } {
  return identityEvents['user.deleted.v1'].parse({
    id: newId(),
    occurredAt: new Date().toISOString(),
    organizationId: null,
    actor: { type: 'system', id: 'identity-service' },
    version: 5,
    userId: account.id,
  });
}

describe('redelivery of the directory events', () => {
  let stack: ServiceStack;
  let app: NestExpressApplication;

  /**
   * Reads how many deliveries reached the insert of the directory entry of an account, from a
   * sequence the probe trigger advances: a sequence is not rolled back with the failed delivery.
   *
   * @param sequence - The sequence of the account.
   * @returns The attempts so far.
   */
  async function attempts(sequence: string): Promise<number> {
    const result = await stack.migrator.query<{ last_value: string; is_called: boolean }>(
      `select last_value, is_called from ${sequence}`,
    );
    const row = result.rows[0];
    return row?.is_called === true ? Number(row.last_value) : 0;
  }

  beforeAll(async () => {
    stack = await ServiceStack.start('redelivery');
    await stack.migrator.query('create sequence directory_probe_lea');
    await stack.migrator.query('create sequence directory_probe_hugo');
    await stack.migrator.query(`
      create function refuse_directory_probe() returns trigger language plpgsql as $$
      begin
        if new.user_id = '${lea.id}' then
          perform nextval('directory_probe_lea');
          raise exception 'directory probe';
        end if;
        if new.user_id = '${hugo.id}' and nextval('directory_probe_hugo') <= 2 then
          raise exception 'directory probe';
        end if;
        return new;
      end $$`);
    await stack.migrator.query(`
      create trigger directory_users_probe before insert on directory_users
      for each row execute function refuse_directory_probe()`);
    app = await stack.startApplication();
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('redelivers a failing event after each delay of its schedule, then gives it up', async () => {
    stack.publish('user.signed-up.v1', signedUp(lea));
    const seenAt: number[] = [];
    await vi.waitFor(
      async () => {
        const count: number = await attempts('directory_probe_lea');
        while (seenAt.length < count) {
          seenAt.push(Date.now());
        }
        expect(count).toBe(4);
      },
      { timeout: 20_000, interval: 25 },
    );
    const gaps: number[] = seenAt.slice(1).map((at: number, index: number) => {
      return at - (seenAt[index] ?? at);
    });

    // 3 s, then 0.5 s repeated; the default schedule would wait 1 s, 5 s, 30 s.
    expect(gaps[0]).toBeGreaterThanOrEqual(2_800);
    expect(gaps[0]).toBeLessThan(4_500);
    for (const gap of gaps.slice(1)) {
      expect(gap).toBeGreaterThanOrEqual(400);
      expect(gap).toBeLessThan(2_500);
    }

    // Four deliveries, not the five of the default: the fourth failure is the dead letter.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 3_000);
    });
    expect(await attempts('directory_probe_lea')).toBe(4);
    const consumer = stack.consumer('organization-service__project-user-signed-up');
    expect(consumer.config.max_deliver).toBe(4);
    expect(consumer.num_ack_pending).toBe(0);
    const entry = await stack.migrator.query('select 1 from directory_users where user_id = $1', [
      lea.id,
    ]);
    expect(entry.rows).toHaveLength(0);
  });

  it('applies the event at the first delivery that succeeds', async () => {
    stack.publish('user.signed-up.v1', signedUp(hugo));

    await vi.waitFor(
      async () => {
        const entry = await stack.migrator.query<{ name: string }>(
          'select name from directory_users where user_id = $1',
          [hugo.id],
        );
        expect(entry.rows).toEqual([{ name: 'Hugo Dubois' }]);
      },
      { timeout: 20_000, interval: 100 },
    );
    expect(await attempts('directory_probe_hugo')).toBe(3);
  });

  it('refuses the deletion of an owner at every delivery, then gives it up, changing nothing', async () => {
    stack.publish('user.signed-up.v1', signedUp(camille));
    stack.publish('user.email-verified.v1', emailVerified(camille));
    await vi.waitFor(
      async () => {
        const entry = await stack.migrator.query(
          'select 1 from directory_users where user_id = $1 and email_verified',
          [camille.id],
        );
        expect(entry.rows).toHaveLength(1);
      },
      { timeout: 20_000, interval: 100 },
    );
    const created = await request(app.getHttpServer())
      .post('/internal/v1/organizations')
      .set('Authorization', await stack.bearer(camille.id, null))
      .send({
        name: 'Atelier Nord',
        teamSize: '6-20',
        primaryUse: 'product-engineering',
        inviteEmails: [],
      });
    expect(created.status).toBe(201);
    const atelierNordId: string = (created.body as OrganizationCreated).organization.id;
    const refused: { readonly id: string } = deleted(camille);

    stack.publish('user.deleted.v1', refused);

    // Four deliveries, each refused, then the dead letter: nothing left to deliver.
    await vi.waitFor(
      () => {
        const consumer = stack.consumer('organization-service__remove-deleted-user');
        expect(consumer.config.max_deliver).toBe(4);
        expect(consumer.delivered.consumer_seq).toBe(4);
        expect(consumer.num_pending).toBe(0);
        expect(consumer.num_ack_pending).toBe(0);
      },
      { timeout: 20_000, interval: 100 },
    );
    const owners = await stack.system<{ readonly organization_id: string }>(
      `select organization_id from members
        where user_id = $1 and role = 'owner' and removed_at is null`,
      [camille.id],
    );
    expect(owners).toEqual([{ organization_id: atelierNordId }]);
    const removals = await stack.system(
      `select 1 from outbox_events
        where event_name = 'member.removed.v1' and payload ->> 'userId' = $1`,
      [camille.id],
    );
    expect(removals).toHaveLength(0);
    const entry = await stack.migrator.query<{ name: string; deleted: boolean }>(
      'select name, deleted from directory_users where user_id = $1',
      [camille.id],
    );
    expect(entry.rows).toEqual([{ name: 'Camille Martin', deleted: false }]);
    const processed = await stack.migrator.query(
      'select 1 from processed_events where event_id = $1',
      [refused.id],
    );
    expect(processed.rows).toHaveLength(0);
  });
});
