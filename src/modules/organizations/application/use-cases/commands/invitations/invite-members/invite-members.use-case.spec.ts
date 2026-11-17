import { beforeEach, describe, expect, it } from 'vitest';

import { atelierNord, CAMILLE, HUGO, INES } from '../../../organizations.scenario.fixture.js';
import type { AtelierNord } from '../../../organizations.scenario.fixture.js';
import type { InviteMembersOutput } from './invite-members.output.js';
import { InviteMembers } from './invite-members.use-case.js';

describe('InviteMembers', () => {
  let scenario: AtelierNord;
  let invite: InviteMembers;

  beforeEach(async () => {
    scenario = await atelierNord();
    invite = new InviteMembers(scenario.store, scenario.clock);
  });

  it('answers each distinct address in its order, and sends the new invitations only', async () => {
    const first: InviteMembersOutput = await invite.execute({
      actorUserId: INES.id,
      organizationId: scenario.organizationId,
      emails: ['marc.roux@ateliernord.fr', 'lucie@exemple.fr'],
      role: 'member',
    });
    const second: InviteMembersOutput = await invite.execute({
      actorUserId: INES.id,
      organizationId: scenario.organizationId,
      emails: ['Lucie@Exemple.fr', 'hugo.dubois@ateliernord.fr', 'lucie@exemple.fr'],
      role: 'guest',
    });

    expect(first.invitations.map((outcome) => outcome.outcome)).toEqual(['invited', 'invited']);
    expect(second.invitations).toEqual([
      {
        email: 'lucie@exemple.fr',
        outcome: 'already-invited',
        invitationId: first.invitations[1]?.invitationId,
      },
      { email: 'hugo.dubois@ateliernord.fr', outcome: 'already-member', invitationId: null },
    ]);
    expect(scenario.store.eventsNamed('invitation.issued.v1')).toHaveLength(2);
    expect(scenario.store.eventsNamed('invitation.issued.v1')[0]?.payload).toMatchObject({
      inviterUserId: INES.id,
      inviterName: 'Inès Robert',
      organizationName: 'Atelier Nord',
      memberCount: 3,
      email: 'marc.roux@ateliernord.fr',
    });
  });

  it('lets only the owner and the admins invite', async () => {
    await expect(
      invite.execute({
        actorUserId: HUGO.id,
        organizationId: scenario.organizationId,
        emails: ['lucie@exemple.fr'],
        role: 'member',
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'role-forbidden' } });
    await expect(
      invite.execute({
        actorUserId: CAMILLE.id,
        organizationId: 'elsewhere',
        emails: ['lucie@exemple.fr'],
        role: 'member',
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'organization-not-found' } });
    expect(scenario.store.tables.events).toEqual([]);
  });
});
