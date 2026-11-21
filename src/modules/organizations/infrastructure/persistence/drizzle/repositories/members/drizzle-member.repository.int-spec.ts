import { runWithOrganizationContext } from '@cadenway/nest-common';
import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId, ServiceStack } from '../../../../../../../../tests/support/service-stack.js';
import { ApplySeatEntitlement } from '../../../../../application/use-cases/commands/billing/apply-seat-entitlement/apply-seat-entitlement.use-case.js';
import { DrizzleSeatEntitlementRepository } from '../billing/drizzle-seat-entitlement.repository.js';
import { DrizzleMemberRepository } from './drizzle-member.repository.js';

describe('Seat admission persistence', () => {
  const organizationId = newId();
  const otherOrganizationId = newId();
  const ownerId = newId();
  let stack: ServiceStack | undefined;
  let tenant: TenantTransactionRunner;
  let apply: ApplySeatEntitlement;

  beforeAll(async () => {
    stack = await ServiceStack.start('seat-admission');
    const app = await stack.startApplication();
    tenant = app.get(TenantTransactionRunner);
    apply = app.get(ApplySeatEntitlement);
    await stack.system(
      `insert into organizations
        (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Atelier Nord', 'atelier nord', 'atelier-nord', 'fr', '1-5', 'other', $2)`,
      [organizationId, ownerId],
    );
    await stack.system(
      `insert into members (organization_id, user_id, role, joined_at, version)
       values ($1, $2, 'owner', now(), 1), ($1, $3, 'member', now(), 1),
              ($1, $4, 'admin', now(), 1), ($1, $5, 'member', now(), 1),
              ($1, $6, 'guest', now(), 1)`,
      [organizationId, ownerId, newId(), newId(), newId(), newId()],
    );
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it('serializes two additions and counts committed seats after the first lock releases', async () => {
    let releaseFirst: () => void = () => undefined;
    let announceFirst: () => void = () => undefined;
    let announceSecond: () => void = () => undefined;
    let secondAcquired = false;
    const firstLocked = new Promise<void>((resolve) => {
      announceFirst = resolve;
    });
    const mayCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      announceSecond = resolve;
    });
    const context = {
      organizationId,
      actor: { type: 'system' as const, id: 'test' },
      role: null,
      scopes: [],
    };

    const first = runWithOrganizationContext(context, () =>
      tenant.run(async ({ db }) => {
        const members = new DrizzleMemberRepository(db);
        await members.lockSeatAdmission(organizationId);
        expect(await members.countSeats(organizationId)).toBe(4);
        await db.execute(
          sql`insert into members
            (organization_id, user_id, role, joined_at, version)
            values (${organizationId}, ${newId()}, 'member', now(), 1)`,
        );
        announceFirst();
        await mayCommit;
      }),
    );
    await firstLocked;
    const second = runWithOrganizationContext(context, () =>
      tenant.run(async ({ db }) => {
        const members = new DrizzleMemberRepository(db);
        announceSecond();
        await members.lockSeatAdmission(organizationId);
        secondAcquired = true;
        return members.countSeats(organizationId);
      }),
    );
    try {
      await secondStarted;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(secondAcquired).toBe(false);
    } finally {
      releaseFirst();
    }
    await first;
    expect(await second).toBe(5);
  });

  it('rejects a lock for a different tenant', async () => {
    await runWithOrganizationContext(
      { organizationId, actor: { type: 'system', id: 'test' }, role: null, scopes: [] },
      () =>
        tenant.run(async ({ db }) => {
          await expect(
            new DrizzleMemberRepository(db).lockSeatAdmission(otherOrganizationId),
          ).rejects.toThrow('Seat admission organization does not match the current tenant.');
        }),
    );
  });

  it('applies a new limit only when the shared admission lock is released', async () => {
    let release: () => void = () => undefined;
    let announce: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const mayCommit = new Promise<void>((resolve) => {
      release = resolve;
    });
    const context = {
      organizationId,
      actor: { type: 'system' as const, id: 'billing-service' },
      role: null,
      scopes: [],
    };
    const owner = runWithOrganizationContext(context, () =>
      tenant.run(async ({ db }) => {
        await new DrizzleMemberRepository(db).lockSeatAdmission(organizationId);
        const seats = new DrizzleSeatEntitlementRepository(db);
        expect(await seats.find(organizationId)).toBeNull();
        announce();
        await mayCommit;
        expect(await seats.find(organizationId)).toBeNull();
      }),
    );
    await Promise.race([held, owner]);
    let settled = false;
    const entitlement = { version: 2, plan: 'team', seatLimit: 8 };
    const projection = runWithOrganizationContext(context, () =>
      apply.execute({ organizationId, entitlement }),
    ).then((result) => {
      settled = true;
      return result;
    });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      expect(settled).toBe(false);
    } finally {
      release();
    }
    await owner;
    await expect(projection).resolves.toBe('applied');
    await runWithOrganizationContext(context, () =>
      tenant.run(async ({ db }) => {
        await new DrizzleMemberRepository(db).lockSeatAdmission(organizationId);
        const seats = new DrizzleSeatEntitlementRepository(db);
        await expect(seats.find(organizationId)).resolves.toEqual(entitlement);
        await expect(
          seats.writeNext(organizationId, { ...entitlement, version: 1, seatLimit: 9 }),
        ).resolves.toBe(false);
        await expect(
          seats.writeNext(organizationId, { ...entitlement, version: 3, seatLimit: 7 }),
        ).resolves.toBe(false);
        await expect(seats.find(organizationId)).resolves.toEqual(entitlement);
      }),
    );
    await runWithOrganizationContext({ ...context, organizationId: otherOrganizationId }, () =>
      tenant.run(async ({ db }) => {
        const rows = await db.execute(
          sql`select organization_id from organization_seat_entitlements where organization_id = ${organizationId}`,
        );
        expect(rows.rows).toEqual([]);
      }),
    );
  });
});
