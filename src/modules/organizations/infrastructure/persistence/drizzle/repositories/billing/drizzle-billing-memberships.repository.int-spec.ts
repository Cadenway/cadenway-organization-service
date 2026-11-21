import { runWithOrganizationContext } from '@cadenway/nest-common';
import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId, ServiceStack } from '../../../../../../../../tests/support/service-stack.js';
import { DrizzleBillingMembershipsReader } from './drizzle-billing-memberships.repository.js';

describe('Billing membership snapshot persistence', () => {
  const organizationId = newId();
  const otherOrganizationId = newId();
  const ownerId = newId();
  const guestId = newId();
  const adminId = newId();
  const otherOwnerId = newId();
  const firstMemberId = '019a7001-2b3c-4d4e-8f5a-6b7c8d9e0f12';
  const secondMemberId = '019a7002-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const thirdMemberId = '019a7003-2b3c-4d4e-8f5a-6b7c8d9e0f12';
  const laterMemberId = '019a7004-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  let stack: ServiceStack | undefined;
  let reader: DrizzleBillingMembershipsReader;

  beforeAll(async () => {
    stack = await ServiceStack.start('billing-memberships');
    const app = await stack.startApplication();
    reader = new DrizzleBillingMembershipsReader(app.get(TenantTransactionRunner));
    await stack.system(
      `insert into organizations
         (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Atelier Nord', 'atelier nord', 'atelier-nord', 'fr', '1-5', 'other', $3),
              ($2, 'Lumen', 'lumen', 'lumen', 'fr', '1-5', 'other', $4)`,
      [organizationId, otherOrganizationId, ownerId, otherOwnerId],
    );
    await stack.system(
      `insert into members (id, organization_id, user_id, role, joined_at, version)
       values ($1, $4, $6, 'owner', now(), 1),
              ($2, $4, $7, 'guest', now(), 2),
              ($3, $4, $8, 'admin', now(), 3),
              ($5, $9, $10, 'owner', now(), 1)`,
      [
        firstMemberId,
        secondMemberId,
        thirdMemberId,
        organizationId,
        newId(),
        ownerId,
        guestId,
        adminId,
        otherOrganizationId,
        otherOwnerId,
      ],
    );
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it('keeps a fixed upper UUID across pages and retains a removal at its terminal version', async () => {
    const read = (position: { readonly upperId: string; readonly afterId: string } | null) =>
      runWithOrganizationContext(
        {
          organizationId,
          actor: { type: 'system', id: 'billing-service' },
          role: null,
          scopes: [],
        },
        () => reader.read(organizationId, position, 1),
      );

    expect(await read(null)).toEqual({
      upperId: thirdMemberId,
      items: [{ memberId: firstMemberId, state: 'active', role: 'owner', version: 1 }],
    });

    await stack?.system('update members set removed_at = now(), version = 3 where id = $1', [
      secondMemberId,
    ]);
    await stack?.system(
      `insert into members (id, organization_id, user_id, role, joined_at, version)
       values ($1, $2, $3, 'member', now(), 1)`,
      [laterMemberId, organizationId, newId()],
    );

    const second = await read({ upperId: thirdMemberId, afterId: firstMemberId });
    expect(second).toEqual({
      upperId: thirdMemberId,
      items: [{ memberId: secondMemberId, state: 'removed', version: 3 }],
    });
    const third = await read({ upperId: thirdMemberId, afterId: secondMemberId });
    expect(third).toEqual({
      upperId: thirdMemberId,
      items: [{ memberId: thirdMemberId, state: 'active', role: 'admin', version: 3 }],
    });
    expect(await read({ upperId: thirdMemberId, afterId: thirdMemberId })).toEqual({
      upperId: thirdMemberId,
      items: [],
    });
    expect(await read(null)).toEqual({
      upperId: laterMemberId,
      items: [{ memberId: firstMemberId, state: 'active', role: 'owner', version: 1 }],
    });
  });

  it('refuses a different tenant and reports an absent organization', async () => {
    const context = {
      organizationId,
      actor: { type: 'system' as const, id: 'billing-service' },
      role: null,
      scopes: [],
    };
    await expect(
      runWithOrganizationContext(context, () => reader.read(otherOrganizationId, null, 100)),
    ).rejects.toThrow('Billing membership tenant mismatch.');
    await expect(
      runWithOrganizationContext(context, () => reader.read(organizationId, null, 102)),
    ).rejects.toThrow('The Billing membership page exceeds its bound.');

    const absentOrganizationId = newId();
    await expect(
      runWithOrganizationContext({ ...context, organizationId: absentOrganizationId }, () =>
        reader.read(absentOrganizationId, null, 100),
      ),
    ).resolves.toBeNull();
  });
});
