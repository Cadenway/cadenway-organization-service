import { runWithOrganizationContext } from '@cadenway/nest-common';
import { TenantTransactionRunner } from '@cadenway/nest-common/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newId, ServiceStack } from '../../../../../../../../tests/support/service-stack.js';
import { DrizzleMemberNamesUnitOfWork } from '../../transactions/organizations/drizzle-member-names.unit-of-work.js';

describe('member name lookup persistence', () => {
  const organizationId = newId();
  const otherOrganizationId = newId();
  const guestId = newId();
  const memberId = newId();
  const removedId = newId();
  const blankId = newId();
  const outsiderId = newId();
  let stack: ServiceStack;
  let work: DrizzleMemberNamesUnitOfWork;

  beforeAll(async () => {
    stack = await ServiceStack.start('member-names');
    const app = await stack.startApplication();
    work = new DrizzleMemberNamesUnitOfWork(app.get(TenantTransactionRunner));
    await stack.system(
      `insert into organizations
       (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'First', 'first', 'first', 'fr', '1-5', 'other', $3),
              ($2, 'Second', 'second', 'second', 'fr', '1-5', 'other', $4)`,
      [organizationId, otherOrganizationId, guestId, outsiderId],
    );
    await stack.system(
      `insert into directory_users (user_id, name, email)
       values ($1, 'Guest Name', 'guest@example.test'), ($2, 'Member Name', 'member@example.test'),
              ($3, 'Removed Name', 'removed@example.test'), ($4, '   ', 'blank@example.test'),
              ($5, 'Other Name', 'other@example.test')`,
      [guestId, memberId, removedId, blankId, outsiderId],
    );
    await stack.system(
      `insert into members (organization_id, user_id, role, joined_at, removed_at)
       values ($1, $3, 'guest', now(), null), ($1, $4, 'member', now(), null),
              ($1, $5, 'member', now(), now()), ($1, $6, 'member', now(), null),
              ($2, $7, 'member', now(), null)`,
      [organizationId, otherOrganizationId, guestId, memberId, removedId, blankId, outsiderId],
    );
  });

  afterAll(async () => {
    await stack.stop();
  });

  it('keeps only names of active requested members in the verified tenant', async () => {
    const result = await runWithOrganizationContext(
      { organizationId, actor: { type: 'user', id: guestId }, role: null, scopes: [] },
      () =>
        work.read(async (reader) => ({
          guest: await reader.findActiveActor(organizationId, guestId),
          removed: await reader.findActiveActor(organizationId, removedId),
          foreign: await reader.findActiveActor(otherOrganizationId, outsiderId),
          names: await reader.findActiveNames(organizationId, [
            guestId,
            memberId,
            removedId,
            blankId,
            outsiderId,
            newId(),
          ]),
          foreignNames: await reader.findActiveNames(otherOrganizationId, [outsiderId]),
        })),
    );
    expect(result.guest).toBe(true);
    expect(result.removed).toBe(false);
    expect(result.foreign).toBe(false);
    expect(result.names).toEqual(
      expect.arrayContaining([
        { userId: guestId, name: 'Guest Name' },
        { userId: memberId, name: 'Member Name' },
      ]),
    );
    expect(result.names).toHaveLength(2);
    expect(result.foreignNames).toEqual([]);
  });

  it('keeps actor and name reads in one snapshot during a concurrent removal', async () => {
    const names = await runWithOrganizationContext(
      { organizationId, actor: { type: 'user', id: guestId }, role: null, scopes: [] },
      () =>
        work.read(async (reader) => {
          expect(await reader.findActiveActor(organizationId, memberId)).toBe(true);
          await stack.system(
            'update members set removed_at = now() where organization_id = $1 and user_id = $2',
            [organizationId, memberId],
          );
          return reader.findActiveNames(organizationId, [memberId]);
        }),
    );
    expect(names).toEqual([{ userId: memberId, name: 'Member Name' }]);
    const after = await runWithOrganizationContext(
      { organizationId, actor: { type: 'user', id: guestId }, role: null, scopes: [] },
      () => work.read((reader) => reader.findActiveNames(organizationId, [memberId])),
    );
    expect(after).toEqual([]);
  });
});
