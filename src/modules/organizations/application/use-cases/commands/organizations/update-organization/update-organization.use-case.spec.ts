import { beforeEach, describe, expect, it } from 'vitest';

import type { Page } from '../../../../models/pagination/page.model.js';
import type { MyOrganizationView } from '../../../../projections/organizations/my-organization-view.projection.js';
import type { OrganizationView } from '../../../../projections/organizations/organization-view.projection.js';
import { GetCurrentOrganization } from '../../../queries/organizations/get-current-organization/get-current-organization.use-case.js';
import { ListMyOrganizations } from '../../../queries/organizations/list-my-organizations/list-my-organizations.use-case.js';
import {
  atelierNord,
  CAMILLE,
  HUGO,
  INES,
  NADIA,
} from '../../../organizations.scenario.fixture.js';
import type { AtelierNord } from '../../../organizations.scenario.fixture.js';
import { CreateOrganization } from '../create-organization/create-organization.use-case.js';
import { UpdateOrganization } from './update-organization.use-case.js';

describe('UpdateOrganization, GetCurrentOrganization and ListMyOrganizations', () => {
  let scenario: AtelierNord;
  let update: UpdateOrganization;

  beforeEach(async () => {
    scenario = await atelierNord();
    update = new UpdateOrganization(scenario.store);
  });

  it('lets an admin patch the organization, with the event of what moved', async () => {
    const updated: OrganizationView = await update.execute({
      actorUserId: INES.id,
      organizationId: scenario.organizationId,
      change: { website: 'https://ateliernord.fr', defaultLanguage: 'en' },
      expectedVersion: [1],
    });

    expect(updated).toMatchObject({
      website: 'https://ateliernord.fr',
      defaultLanguage: 'en',
      role: 'admin',
      memberCount: 3,
      version: 2,
    });
    expect(scenario.store.eventsNamed('organization.updated.v1')[0]?.payload).toMatchObject({
      changed: ['website', 'defaultLanguage'],
      actorUserId: INES.id,
    });
  });

  it('emits nothing for a patch that changes nothing', async () => {
    const updated: OrganizationView = await update.execute({
      actorUserId: CAMILLE.id,
      organizationId: scenario.organizationId,
      change: { name: 'Atelier Nord' },
      expectedVersion: 'any',
    });

    expect(updated.version).toBe(1);
    expect(scenario.store.tables.events).toEqual([]);
  });

  it('refuses a member, a guest, a stale version, a taken address and a script as website', async () => {
    const request = {
      organizationId: scenario.organizationId,
      change: { name: 'Atelier Sud' },
      expectedVersion: null,
    };
    await new CreateOrganization(scenario.store, scenario.clock).execute({
      actorUserId: INES.id,
      name: 'Coopérative Lumen',
      slug: 'lumen',
      teamSize: '21-100',
      primaryUse: 'other',
      inviteEmails: [],
    });

    for (const actorUserId of [HUGO.id, NADIA.id]) {
      await expect(update.execute({ ...request, actorUserId })).rejects.toMatchObject({
        refusal: { reason: 'role-forbidden' },
      });
    }
    await expect(
      update.execute({ ...request, actorUserId: CAMILLE.id, expectedVersion: [2] }),
    ).rejects.toMatchObject({ refusal: { reason: 'version-mismatch', version: 1 } });
    await expect(
      update.execute({ ...request, actorUserId: CAMILLE.id, change: { slug: 'lumen' } }),
    ).rejects.toMatchObject({ refusal: { reason: 'slug-taken', slug: 'lumen' } });
    await expect(
      update.execute({
        ...request,
        actorUserId: CAMILLE.id,
        change: { website: 'javascript:alert(1)' },
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'invalid-field', field: 'website' } });
  });

  it('reads the organization for every member, and lists the organizations of an account', async () => {
    await new CreateOrganization(scenario.store, scenario.clock).execute({
      actorUserId: INES.id,
      name: 'Coopérative Lumen',
      slug: 'lumen',
      teamSize: '21-100',
      primaryUse: 'other',
      inviteEmails: [],
    });
    const read: OrganizationView = await new GetCurrentOrganization(scenario.store).execute({
      actorUserId: NADIA.id,
      organizationId: scenario.organizationId,
    });
    const list: ListMyOrganizations = new ListMyOrganizations(scenario.store);
    const first: Page<MyOrganizationView> = await list.execute({
      actorUserId: INES.id,
      after: null,
      limit: 1,
    });
    const second: Page<MyOrganizationView> = await list.execute({
      actorUserId: INES.id,
      after: first.next,
      limit: 1,
    });

    expect(read).toMatchObject({ role: 'guest', memberCount: 3 });
    expect(first.items.map((item) => [item.name, item.role])).toEqual([['Atelier Nord', 'admin']]);
    expect(second.items.map((item) => [item.name, item.role])).toEqual([
      ['Coopérative Lumen', 'owner'],
    ]);
    expect(second.next).toBeNull();
    await expect(
      new GetCurrentOrganization(scenario.store).execute({
        actorUserId: 'outsider',
        organizationId: scenario.organizationId,
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'organization-not-found' } });
  });
});
