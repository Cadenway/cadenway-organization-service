import { beforeEach, describe, expect, it } from 'vitest';

import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import { FixedClock, InMemoryOrganizations } from '../../../organizations.fixture.js';
import type { CreateOrganizationOutput } from './create-organization.output.js';
import { CreateOrganization } from './create-organization.use-case.js';

/** Camille Martin, the creator of Atelier Nord. */
const CAMILLE_ID: string = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';

describe('CreateOrganization', () => {
  let store: InMemoryOrganizations;
  let create: CreateOrganization;

  beforeEach(() => {
    store = new InMemoryOrganizations().withAccount(
      CAMILLE_ID,
      'Camille Martin',
      'camille.martin@ateliernord.fr',
    );
    create = new CreateOrganization(store, new FixedClock('2026-03-02T09:00:00Z'));
  });

  it('creates the organization, its owner and one invitation per distinct address, with events', async () => {
    const created: CreateOrganizationOutput = await create.execute({
      actorUserId: CAMILLE_ID,
      name: 'Atelier Nord',
      slug: null,
      teamSize: '6-20',
      primaryUse: 'product-engineering',
      inviteEmails: [
        'ines.robert@ateliernord.fr',
        'Ines.Robert@ateliernord.fr',
        'Camille.Martin@ateliernord.fr',
      ],
    });

    expect(created.organization).toMatchObject({
      name: 'Atelier Nord',
      slug: 'atelier-nord',
      plan: 'free',
      defaultLanguage: 'fr',
      role: 'owner',
      memberCount: 1,
      version: 1,
    });
    expect(created.invitations).toEqual([
      {
        email: 'ines.robert@ateliernord.fr',
        outcome: 'invited',
        invitationId: expect.any(String) as string,
      },
      { email: 'camille.martin@ateliernord.fr', outcome: 'already-member', invitationId: null },
    ]);
    expect(store.tables.events.map((event) => event.name)).toEqual([
      'organization.created.v1',
      'member.joined.v1',
      'invitation.issued.v1',
    ]);
    expect(store.eventsNamed('invitation.issued.v1')[0]?.payload).toMatchObject({
      inviterName: 'Camille Martin',
      organizationName: 'Atelier Nord',
      memberCount: 1,
      language: 'fr',
      role: 'member',
      expiresAt: new Date('2026-03-09T09:00:00Z'),
    });
  });

  it('counts each address it invites against the daily allowance of the new organization, never refusing', async () => {
    const created: CreateOrganizationOutput = await create.execute({
      actorUserId: CAMILLE_ID,
      name: 'Atelier Nord',
      slug: null,
      teamSize: '21-100',
      primaryUse: 'product-engineering',
      inviteEmails: [
        'Camille.Martin@ateliernord.fr',
        ...Array.from({ length: 49 }, (_: unknown, index: number) => {
          return `equipe.${String(index)}@ateliernord.fr`;
        }),
      ],
    });

    expect(created.invitations.filter((outcome) => outcome.outcome === 'invited')).toHaveLength(49);
    expect(store.tables.invitationEmails).toHaveLength(49);
    expect(
      store.tables.invitationEmails.every(
        (entry) =>
          entry.organizationId === created.organization.id &&
          entry.sentAt.getTime() === Date.parse('2026-03-02T09:00:00Z'),
      ),
    ).toBe(true);
  });

  it('creates nothing for an account the directory does not know yet', async () => {
    await expect(
      create.execute({
        actorUserId: '019a5f3c-0000-7000-8000-000000000099',
        name: 'Studio Nord',
        slug: null,
        teamSize: '1-5',
        primaryUse: 'other',
        inviteEmails: [],
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'user-not-synchronized' } });
    expect(store.tables.organizations.size).toBe(0);
    expect(store.tables.events).toEqual([]);
  });

  it('refuses an address taken by another organization, or too short', async () => {
    const form = {
      actorUserId: CAMILLE_ID,
      slug: null,
      teamSize: '6-20',
      primaryUse: 'other',
      inviteEmails: [],
    };
    await create.execute({ ...form, name: 'Atelier Nord' });

    await expect(create.execute({ ...form, name: 'Atelier-Nord' })).rejects.toMatchObject({
      refusal: { reason: 'slug-taken', slug: 'atelier-nord' },
    });
    await expect(create.execute({ ...form, name: '!' })).rejects.toMatchObject({
      refusal: { reason: 'slug-invalid', slug: '' },
    });
    await expect(create.execute({ ...form, name: '  ' })).rejects.toBeInstanceOf(
      OrganizationRefusal,
    );
    expect(store.tables.organizations.size).toBe(1);
  });
});
