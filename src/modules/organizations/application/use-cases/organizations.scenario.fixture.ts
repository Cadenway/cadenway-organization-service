import { CreateOrganization } from './commands/organizations/create-organization/create-organization.use-case.js';
import type { CreateOrganizationOutput } from './commands/organizations/create-organization/create-organization.output.js';
import { AcceptInvitation } from './commands/invitations/accept-invitation/accept-invitation.use-case.js';
import { InviteMembers } from './commands/invitations/invite-members/invite-members.use-case.js';
import type { InviteMembersOutput } from './commands/invitations/invite-members/invite-members.output.js';
import { FixedClock, InMemoryOrganizations } from './organizations.fixture.js';

/** An account of the mockup. */
export interface Person {
  // #region Properties
  /** Id of the account. */
  readonly id: string;

  /** Full name. */
  readonly name: string;

  /** Address. */
  readonly email: string;
  // #endregion
}

/** Camille Martin, owner of Atelier Nord. */
export const CAMILLE: Person = {
  id: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
  name: 'Camille Martin',
  email: 'camille.martin@ateliernord.fr',
};

/** Inès Robert, admin of Atelier Nord. */
export const INES: Person = {
  id: '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31',
  name: 'Inès Robert',
  email: 'ines.robert@ateliernord.fr',
};

/** Hugo Dubois, member of Atelier Nord. */
export const HUGO: Person = {
  id: '019a5f3c-a0b1-7c2d-9e3f-5a6b7c8d9e32',
  name: 'Hugo Dubois',
  email: 'hugo.dubois@ateliernord.fr',
};

/** Nadia Garnier, guest of Atelier Nord. */
export const NADIA: Person = {
  id: '019a5f3c-b0b1-7c2d-9e3f-5a6b7c8d9e33',
  name: 'Nadia Garnier',
  email: 'nadia@cabinet-garnier.fr',
};

/** Atelier Nord with its owner, an admin, a member and a guest, all joined by invitation. */
export interface AtelierNord {
  // #region Properties
  /** The fake database. */
  readonly store: InMemoryOrganizations;

  /** The clock of the scenario, on 8 November 2026. */
  readonly clock: FixedClock;

  /** Id of Atelier Nord. */
  readonly organizationId: string;

  /** Id of the membership of each person, by account id. */
  readonly memberIds: ReadonlyMap<string, string>;
  // #endregion
}

/**
 * Builds Atelier Nord through its use cases: Camille creates it, invites Inès as admin, Hugo as
 * member and Nadia as guest, and each accepts.
 *
 * @returns The scenario.
 */
export async function atelierNord(): Promise<AtelierNord> {
  const store: InMemoryOrganizations = new InMemoryOrganizations();
  for (const person of [CAMILLE, INES, HUGO, NADIA]) {
    store.withAccount(person.id, person.name, person.email);
  }
  const clock: FixedClock = new FixedClock('2026-11-08T09:00:00Z');
  const created: CreateOrganizationOutput = await new CreateOrganization(store, clock).execute({
    actorUserId: CAMILLE.id,
    name: 'Atelier Nord',
    slug: null,
    teamSize: '6-20',
    primaryUse: 'product-engineering',
    inviteEmails: [],
  });
  const organizationId: string = created.organization.id;
  const invite: InviteMembers = new InviteMembers(store, clock);
  const accept: AcceptInvitation = new AcceptInvitation(store, clock);
  for (const [person, role] of [
    [INES, 'admin'],
    [HUGO, 'member'],
    [NADIA, 'guest'],
  ] as const) {
    const batch: InviteMembersOutput = await invite.execute({
      actorUserId: CAMILLE.id,
      organizationId,
      emails: [person.email],
      role,
    });
    await accept.execute({
      actorUserId: person.id,
      userId: person.id,
      invitationId: batch.invitations[0]?.invitationId ?? '',
    });
  }
  const memberIds: Map<string, string> = new Map<string, string>(
    [...store.tables.members.values()].map((member) => [member.userId, member.id]),
  );
  store.tables.events = [];
  return { store, clock, organizationId, memberIds };
}
