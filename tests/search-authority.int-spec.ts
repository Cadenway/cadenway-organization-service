import { runWithOrganizationContext } from '@cadenway/nest-common';
import { SystemTransactionRunner, TenantTransactionRunner } from '@cadenway/nest-common/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GetSearchMembership } from '../src/modules/organizations/application/use-cases/queries/search/get-search-membership/get-search-membership.use-case.js';
import { ListSearchOrganizations } from '../src/modules/organizations/application/use-cases/queries/search/list-search-organizations/list-search-organizations.use-case.js';
import { DrizzleSearchMembershipReader } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/search/drizzle-search-membership.repository.js';
import { DrizzleSearchOrganizationsReader } from '../src/modules/organizations/infrastructure/persistence/drizzle/repositories/search/drizzle-search-organizations.repository.js';
import { SearchOrganizationCursor } from '../src/modules/organizations/presentation/http/mappers/search/search-organization-cursor.mapper.js';
import { newId, ServiceStack } from './support/service-stack.js';

describe('Organization Search authority persistence', () => {
  const firstId = '019a7001-2b3c-4d4e-8f5a-6b7c8d9e0f12';
  const secondId = '019a7002-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const thirdId = '019a7003-2b3c-4d4e-8f5a-6b7c8d9e0f12';
  const newOrganizationId = '019a7004-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const userId = newId();
  const outsiderId = newId();
  const memberId = newId();
  const newMemberId = newId();
  let stack: ServiceStack | undefined;
  let searchMembership: GetSearchMembership;
  let searchOrganizations: ListSearchOrganizations;

  beforeAll(async () => {
    stack = await ServiceStack.start('search-authority');
    const app = await stack.startApplication();
    searchMembership = new GetSearchMembership(
      new DrizzleSearchMembershipReader(app.get(TenantTransactionRunner)),
    );
    searchOrganizations = new ListSearchOrganizations(
      new DrizzleSearchOrganizationsReader(app.get(SystemTransactionRunner)),
    );
    await stack.system(
      `insert into organizations
       (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($2, 'Second', 'second', 'second', 'fr', '1-5', 'other', $5),
              ($1, 'First', 'first', 'first', 'fr', '1-5', 'other', $4),
              ($3, 'Third', 'third', 'third', 'fr', '1-5', 'other', $5)`,
      [firstId, secondId, thirdId, userId, outsiderId],
    );
    await stack.system(
      `insert into members (id, organization_id, user_id, role, joined_at, version)
       values ($1, $2, $4, 'admin', now(), 2), ($6, $3, $5, 'owner', now(), 1)`,
      [memberId, firstId, secondId, userId, outsiderId, newId()],
    );
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it('resumes signed pages across historical IDs and includes the original upper ID', async () => {
    const cursor = new SearchOrganizationCursor(Buffer.alloc(32, 7).toString('base64url'));
    const first = await searchOrganizations.execute({ position: null, limit: 1 });
    expect(first).toEqual({ items: [firstId], next: { upperId: thirdId, afterId: firstId } });
    await stack?.system(
      `insert into organizations
       (id, name, name_key, slug, default_language, team_size, primary_use, owner_user_id)
       values ($1, 'Fourth', 'fourth', 'fourth', 'fr', '1-5', 'other', $2)`,
      [newOrganizationId, outsiderId],
    );

    const second = await searchOrganizations.execute({
      position: cursor.read(cursor.write(first.next) ?? undefined),
      limit: 1,
    });
    expect(second).toEqual({ items: [secondId], next: { upperId: thirdId, afterId: secondId } });
    const third = await searchOrganizations.execute({
      position: cursor.read(cursor.write(second.next) ?? undefined),
      limit: 1,
    });
    expect(third).toEqual({ items: [thirdId], next: null });

    const fresh = await searchOrganizations.execute({ position: null, limit: 100 });
    expect(fresh).toEqual({ items: [firstId, secondId, thirdId, newOrganizationId], next: null });
  });

  it('uses the active tenant stamp through role changes, removal and rejoining', async () => {
    const proof = (organizationId: string, actorUserId: string) =>
      runWithOrganizationContext(
        { organizationId, actor: { type: 'user', id: actorUserId }, role: 'guest', scopes: [] },
        () => searchMembership.execute({ organizationId, actorUserId }),
      );

    await expect(proof(firstId, userId)).resolves.toEqual({ memberId, role: 'admin', version: 2 });
    await expect(proof(firstId, outsiderId)).rejects.toThrow('organization-not-found');
    await expect(proof(secondId, userId)).rejects.toThrow('organization-not-found');
    await expect(proof(newId(), userId)).rejects.toThrow('organization-not-found');

    await stack?.system("update members set role = 'member', version = 3 where id = $1", [
      memberId,
    ]);
    await expect(proof(firstId, userId)).resolves.toEqual({ memberId, role: 'member', version: 3 });

    await stack?.system('update members set removed_at = now(), version = 4 where id = $1', [
      memberId,
    ]);
    await expect(proof(firstId, userId)).rejects.toThrow('organization-not-found');

    await stack?.system(
      `insert into members (id, organization_id, user_id, role, joined_at)
       values ($1, $2, $3, 'guest', now())`,
      [newMemberId, firstId, userId],
    );
    await expect(proof(firstId, userId)).resolves.toEqual({
      memberId: newMemberId,
      role: 'guest',
      version: 1,
    });
  });
});
