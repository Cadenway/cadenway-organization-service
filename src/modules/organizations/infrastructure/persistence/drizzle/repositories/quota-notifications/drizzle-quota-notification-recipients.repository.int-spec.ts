import { runWithOrganizationContext } from '@cadenway/nest-common';
import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId, ServiceStack } from '../../../../../../../../tests/support/service-stack.js';
import { DrizzleQuotaNotificationRecipientsReader } from './drizzle-quota-notification-recipients.repository.js';

describe('quota notification recipient persistence', () => {
  const organizationId = newId();
  const otherOrganizationId = newId();
  const ownerId = newId();
  const adminId = newId();
  const memberId = newId();
  const guestId = newId();
  const removedId = newId();
  const outsiderId = newId();
  let stack: ServiceStack;
  let tenant: TenantTransactionRunner;

  beforeAll(async () => {
    stack = await ServiceStack.start('quota-recipients');
    const app = await stack.startApplication();
    tenant = app.get(TenantTransactionRunner);
    await stack.system(
      `insert into organizations
         (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'First', 'first', 'first', 'fr', '1-5', 'other', $3),
              ($2, 'Second', 'second', 'second', 'fr', '1-5', 'other', $4)`,
      [organizationId, otherOrganizationId, ownerId, outsiderId],
    );
    await stack.system(
      `insert into members (organization_id, user_id, role, joined_at, removed_at)
       values ($1, $3, 'owner', now(), null), ($1, $4, 'admin', now(), null),
              ($1, $5, 'member', now(), null), ($1, $6, 'guest', now(), null),
              ($1, $7, 'admin', now(), now()), ($2, $8, 'owner', now(), null)`,
      [
        organizationId,
        otherOrganizationId,
        ownerId,
        adminId,
        memberId,
        guestId,
        removedId,
        outsiderId,
      ],
    );
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('pages only active owners and admins in the tenant by ascending user ID', async () => {
    await runWithOrganizationContext(
      {
        organizationId,
        actor: { type: 'system', id: 'notification-service' },
        role: null,
        scopes: [],
      },
      () =>
        tenant.run(async ({ db }) => {
          const reader = new DrizzleQuotaNotificationRecipientsReader(db);
          const expected = [ownerId, adminId].sort();
          expect(await reader.listActive(organizationId, null, 101)).toEqual(expected);
          const first = await reader.listActive(organizationId, null, 1);
          expect(first).toEqual(expected.slice(0, 1));
          expect(await reader.listActive(organizationId, first[0] ?? null, 1)).toEqual(
            expected.slice(1),
          );
          expect(await reader.listActive(otherOrganizationId, null, 101)).toEqual([]);
          await expect(reader.listActive(organizationId, null, 102)).rejects.toThrow();
        }),
    );
  });

  it('rechecks roles, deduplicates UUIDs and excludes removed and foreign memberships', async () => {
    const lookup = (): Promise<readonly string[]> =>
      runWithOrganizationContext(
        {
          organizationId,
          actor: { type: 'system', id: 'notification-service' },
          role: null,
          scopes: [],
        },
        () =>
          tenant.run(({ db }) =>
            new DrizzleQuotaNotificationRecipientsReader(db).findActive(organizationId, [
              adminId.toUpperCase(),
              adminId,
              ownerId,
              memberId,
              guestId,
              removedId,
              outsiderId,
            ]),
          ),
      );

    expect(await lookup()).toEqual([ownerId, adminId].sort());
    await stack.system('update members set role = $3 where organization_id = $1 and user_id = $2', [
      organizationId,
      adminId,
      'member',
    ]);
    expect(await lookup()).toEqual([ownerId]);
    await runWithOrganizationContext(
      {
        organizationId,
        actor: { type: 'system', id: 'notification-service' },
        role: null,
        scopes: [],
      },
      () =>
        tenant.run(async ({ db }) => {
          const reader = new DrizzleQuotaNotificationRecipientsReader(db);
          expect(await reader.findActive(organizationId, [])).toEqual([]);
          await expect(
            reader.findActive(organizationId, Array(101).fill(ownerId)),
          ).rejects.toThrow();
        }),
    );
  });
});
