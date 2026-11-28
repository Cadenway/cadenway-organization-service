import { beforeEach, describe, expect, it } from 'vitest';

import type { InvitationStateView } from '../../../../projections/invitations/invitation-state-view.projection.js';
import { AcceptInvitation } from '../../../commands/invitations/accept-invitation/accept-invitation.use-case.js';
import type { InviteMembersOutput } from '../../../commands/invitations/invite-members/invite-members.output.js';
import { InviteMembers } from '../../../commands/invitations/invite-members/invite-members.use-case.js';
import { RefuseInvitation } from '../../../commands/invitations/refuse-invitation/refuse-invitation.use-case.js';
import { RevokeInvitation } from '../../../commands/invitations/revoke-invitation/revoke-invitation.use-case.js';
import { atelierNord, CAMILLE, HUGO, INES } from '../../../organizations.scenario.fixture.js';
import type { AtelierNord } from '../../../organizations.scenario.fixture.js';
import { GetInvitation } from './get-invitation.use-case.js';

/** Marc Roux, invited to Atelier Nord. */
const MARC = { id: '019a5f3c-c0b1-7c2d-9e3f-5a6b7c8d9e34', email: 'marc.roux@ateliernord.fr' };

/** One day, in milliseconds. */
const DAY: number = 24 * 60 * 60_000;

describe('GetInvitation', () => {
  let scenario: AtelierNord;
  let read: GetInvitation;
  let invitationId: string;
  let owner: { readonly actorUserId: string; readonly organizationId: string };

  beforeEach(async () => {
    scenario = await atelierNord();
    scenario.store.withAccount(MARC.id, 'Marc Roux', MARC.email);
    read = new GetInvitation(scenario.store);
    owner = { actorUserId: CAMILLE.id, organizationId: scenario.organizationId };
    const batch: InviteMembersOutput = await new InviteMembers(
      scenario.store,
      scenario.clock,
    ).execute({ ...owner, emails: [MARC.email], role: 'member' });
    invitationId = batch.invitations[0]?.invitationId ?? '';
  });

  it('reads a pending invitation, then the same one expired, with its sender', async () => {
    const pending: InvitationStateView = await read.execute({ ...owner, invitationId });

    expect(pending).toEqual({
      id: invitationId,
      email: MARC.email,
      role: 'member',
      invitedBy: { userId: CAMILLE.id, name: 'Camille Martin' },
      status: 'pending',
      sentAt: scenario.clock.now(),
      expiresAt: new Date(scenario.clock.now().getTime() + 7 * DAY),
      answeredAt: null,
      revokedAt: null,
      version: 1,
    });
    scenario.clock.advance(7 * DAY);
    await expect(read.execute({ ...owner, invitationId })).resolves.toMatchObject({
      status: 'expired',
      answeredAt: null,
      revokedAt: null,
    });
  });

  it('tells an accepted, a refused and a revoked invitation apart', async () => {
    scenario.clock.advance(DAY);
    await new AcceptInvitation(scenario.store, scenario.clock, scenario.store).execute({
      actorUserId: MARC.id,
      userId: MARC.id,
      invitationId,
    });
    const acceptedAt: Date = scenario.clock.now();
    const invite = new InviteMembers(scenario.store, scenario.clock);
    const refusedBatch: InviteMembersOutput = await invite.execute({
      ...owner,
      emails: ['lucie@exemple.fr'],
      role: 'guest',
    });
    const revokedBatch: InviteMembersOutput = await invite.execute({
      ...owner,
      emails: ['paul@exemple.fr'],
      role: 'guest',
    });
    const lucie = { id: '019a5f3c-d0b1-7c2d-9e3f-5a6b7c8d9e35', email: 'lucie@exemple.fr' };
    scenario.store.withAccount(lucie.id, 'Lucie Bernard', lucie.email);
    scenario.clock.advance(DAY);
    await new RefuseInvitation(scenario.store, scenario.clock, scenario.store).execute({
      actorUserId: lucie.id,
      userId: lucie.id,
      invitationId: refusedBatch.invitations[0]?.invitationId ?? '',
    });
    const refusedAt: Date = scenario.clock.now();
    scenario.clock.advance(DAY);
    await new RevokeInvitation(scenario.store, scenario.clock).execute({
      ...owner,
      invitationId: revokedBatch.invitations[0]?.invitationId ?? '',
    });
    const revokedAt: Date = scenario.clock.now();
    scenario.clock.advance(30 * DAY);

    await expect(read.execute({ ...owner, invitationId })).resolves.toMatchObject({
      status: 'accepted',
      answeredAt: acceptedAt,
      revokedAt: null,
      version: 2,
    });
    await expect(
      read.execute({ ...owner, invitationId: refusedBatch.invitations[0]?.invitationId ?? '' }),
    ).resolves.toMatchObject({ status: 'refused', answeredAt: refusedAt, revokedAt: null });
    await expect(
      read.execute({ ...owner, invitationId: revokedBatch.invitations[0]?.invitationId ?? '' }),
    ).resolves.toMatchObject({ status: 'revoked', answeredAt: null, revokedAt });
  });

  it('tells pending from expired at the read, not at the arrival of a request that waited', async () => {
    scenario.clock.advance(7 * DAY - 1_000);
    scenario.store.onCheckout = (): void => {
      scenario.clock.advance(2_000);
    };

    const waited: InvitationStateView = await read.execute({ ...owner, invitationId });
    scenario.store.onCheckout = null;

    expect(waited.status).toBe('expired');
  });

  it('reads the role of the actor and the invitation in one read-only transaction', async () => {
    const before: number = scenario.store.requestOptions.length;

    await read.execute({ ...owner, invitationId });

    expect(scenario.store.requestOptions.slice(before)).toEqual([{ readOnly: true }]);
  });

  it('lets the owner and the admins read it, and no other member', async () => {
    await expect(
      read.execute({ ...owner, actorUserId: INES.id, invitationId }),
    ).resolves.toMatchObject({ id: invitationId });
    await expect(
      read.execute({ ...owner, actorUserId: HUGO.id, invitationId }),
    ).rejects.toMatchObject({ refusal: { reason: 'role-forbidden' } });
    await expect(
      read.execute({ ...owner, actorUserId: MARC.id, invitationId }),
    ).rejects.toMatchObject({ refusal: { reason: 'organization-not-found' } });
  });

  it('answers invitation-not-found for an unknown id or an invitation of another organization', async () => {
    await expect(
      read.execute({ ...owner, invitationId: '019a6b10-3c4d-7e5f-8a6b-7c8d9e0f1a70' }),
    ).rejects.toMatchObject({ refusal: { reason: 'invitation-not-found' } });
    const invitation = scenario.store.tables.invitations.get(invitationId);
    if (invitation === undefined) throw new Error('The invitation was not stored.');
    scenario.store.tables.invitations.set(invitationId, {
      ...invitation,
      organizationId: 'elsewhere',
    });
    await expect(read.execute({ ...owner, invitationId })).rejects.toMatchObject({
      refusal: { reason: 'invitation-not-found' },
    });
  });
});
