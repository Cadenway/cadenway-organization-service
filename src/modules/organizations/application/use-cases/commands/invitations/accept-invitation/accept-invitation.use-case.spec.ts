import { beforeEach, describe, expect, it } from 'vitest';

import type { Page } from '../../../../models/pagination/page.model.js';
import type { InvitationView } from '../../../../projections/invitations/invitation-view.projection.js';
import type { ReceivedInvitationView } from '../../../../projections/invitations/received-invitation-view.projection.js';
import type { MyOrganizationView } from '../../../../projections/organizations/my-organization-view.projection.js';
import { ListReceivedInvitations } from '../../../queries/invitations/list-received-invitations/list-received-invitations.use-case.js';
import { atelierNord, CAMILLE, HUGO } from '../../../organizations.scenario.fixture.js';
import type { AtelierNord } from '../../../organizations.scenario.fixture.js';
import type { InviteMembersOutput } from '../invite-members/invite-members.output.js';
import { InviteMembers } from '../invite-members/invite-members.use-case.js';
import { RefuseInvitation } from '../refuse-invitation/refuse-invitation.use-case.js';
import { ResendInvitation } from '../resend-invitation/resend-invitation.use-case.js';
import { RevokeInvitation } from '../revoke-invitation/revoke-invitation.use-case.js';
import { AcceptInvitation } from './accept-invitation.use-case.js';

/** Marc Roux, invited to Atelier Nord. */
const MARC = { id: '019a5f3c-c0b1-7c2d-9e3f-5a6b7c8d9e34', email: 'marc.roux@ateliernord.fr' };

/** Seven days, in milliseconds. */
const WEEK: number = 7 * 24 * 60 * 60_000;

describe('the invitation lifecycle', () => {
  let scenario: AtelierNord;
  let accept: AcceptInvitation;
  let invitationId: string;

  beforeEach(async () => {
    scenario = await atelierNord();
    scenario.store.withAccount(MARC.id, 'Marc Roux', MARC.email);
    accept = new AcceptInvitation(scenario.store, scenario.clock);
    const batch: InviteMembersOutput = await new InviteMembers(
      scenario.store,
      scenario.clock,
    ).execute({
      actorUserId: CAMILLE.id,
      organizationId: scenario.organizationId,
      emails: [MARC.email],
      role: 'member',
    });
    invitationId = batch.invitations[0]?.invitationId ?? '';
    scenario.store.tables.events = [];
  });

  it('makes the invitee a member, with the event of the new membership', async () => {
    const joined: MyOrganizationView = await accept.execute({
      actorUserId: MARC.id,
      userId: MARC.id,
      invitationId,
    });

    expect(joined).toMatchObject({ name: 'Atelier Nord', role: 'member', memberCount: 4 });
    expect(scenario.store.eventsNamed('member.joined.v1')[0]?.payload).toMatchObject({
      userId: MARC.id,
      invitationId,
      version: 1,
    });
    await expect(
      accept.execute({ actorUserId: MARC.id, userId: MARC.id, invitationId }),
    ).rejects.toMatchObject({ refusal: { reason: 'invitation-answered', status: 'accepted' } });
  });

  it('rolls back an acceptance at the free seat limit', async () => {
    const member = scenario.store.tables.members.get(scenario.memberIds.get(HUGO.id) ?? '');
    if (member === undefined) throw new Error('The member fixture is missing.');
    for (const id of ['extra-one', 'extra-two']) {
      scenario.store.tables.members.set(id, { ...member, id, userId: id });
    }
    const acceptance = new AcceptInvitation(scenario.store, scenario.clock, true);

    await expect(
      acceptance.execute({ actorUserId: MARC.id, userId: MARC.id, invitationId }),
    ).rejects.toMatchObject({ refusal: { reason: 'seat-quota-exceeded' } });
    expect(scenario.store.tables.invitations.get(invitationId)?.status).toBe('pending');
    expect(scenario.store.eventsNamed('member.joined.v1')).toEqual([]);
    expect([...scenario.store.tables.members.values()].some((row) => row.userId === MARC.id)).toBe(
      false,
    );
  });

  it('accepts the last free seat when enforcement is enabled', async () => {
    const member = scenario.store.tables.members.get(scenario.memberIds.get(HUGO.id) ?? '');
    if (member === undefined) throw new Error('The member fixture is missing.');
    scenario.store.tables.members.set('extra-one', {
      ...member,
      id: 'extra-one',
      userId: 'extra-one',
    });
    const acceptance = new AcceptInvitation(scenario.store, scenario.clock, true);
    const joined = await acceptance.execute({
      actorUserId: MARC.id,
      userId: MARC.id,
      invitationId,
    });
    expect(joined.memberCount).toBe(5);
    expect(scenario.store.eventsNamed('member.joined.v1')).toHaveLength(1);
  });

  it('admits a sixth billed member under the committed Team limit', async () => {
    const member = scenario.store.tables.members.get(scenario.memberIds.get(HUGO.id) ?? '');
    if (member === undefined) throw new Error('The member fixture is missing.');
    for (const id of ['extra-one', 'extra-two']) {
      scenario.store.tables.members.set(id, { ...member, id, userId: id });
    }
    scenario.store.tables.seatEntitlements.set(scenario.organizationId, {
      version: 1,
      plan: 'team',
      seatLimit: 6,
    });

    await expect(
      new AcceptInvitation(scenario.store, scenario.clock, true).execute({
        actorUserId: MARC.id,
        userId: MARC.id,
        invitationId,
      }),
    ).resolves.toMatchObject({ role: 'member', memberCount: 6 });
    expect(scenario.store.eventsNamed('member.joined.v1')).toHaveLength(1);
  });

  it('accepts a guest even when all free seats are occupied', async () => {
    const member = scenario.store.tables.members.get(scenario.memberIds.get(HUGO.id) ?? '');
    const invitation = scenario.store.tables.invitations.get(invitationId);
    if (member === undefined || invitation === undefined) {
      throw new Error('The invitation fixtures are missing.');
    }
    for (const id of ['extra-one', 'extra-two']) {
      scenario.store.tables.members.set(id, { ...member, id, userId: id });
    }
    scenario.store.tables.invitations.set(invitationId, { ...invitation, role: 'guest' });
    const acceptance = new AcceptInvitation(scenario.store, scenario.clock, true);
    const joined = await acceptance.execute({
      actorUserId: MARC.id,
      userId: MARC.id,
      invitationId,
    });
    expect(joined).toMatchObject({ role: 'guest', memberCount: 5 });
    expect(scenario.store.eventsNamed('member.joined.v1')).toHaveLength(1);
  });

  it('checks the account, then the invitation, then the address, then the state', async () => {
    await expect(
      accept.execute({ actorUserId: MARC.id, userId: HUGO.id, invitationId }),
    ).rejects.toMatchObject({ refusal: { reason: 'user-not-found' } });
    await expect(
      accept.execute({ actorUserId: MARC.id, userId: MARC.id, invitationId: 'unknown' }),
    ).rejects.toMatchObject({ refusal: { reason: 'invitation-not-found' } });
    await expect(
      accept.execute({ actorUserId: HUGO.id, userId: HUGO.id, invitationId }),
    ).rejects.toMatchObject({ refusal: { reason: 'invitation-email-mismatch' } });
    scenario.clock.advance(WEEK);
    await expect(
      accept.execute({ actorUserId: MARC.id, userId: MARC.id, invitationId }),
    ).rejects.toMatchObject({ refusal: { reason: 'invitation-expired' } });
    expect(scenario.store.tables.events).toEqual([]);
  });

  it('finds no invitation for an account whose address is not verified yet', async () => {
    scenario.store.withAccount(MARC.id, 'Marc Roux', MARC.email, false);
    const received: Page<ReceivedInvitationView> = await new ListReceivedInvitations(
      scenario.store,
      scenario.clock,
    ).execute({ actorUserId: MARC.id, userId: MARC.id, after: null, limit: 50 });

    expect(received.items).toEqual([]);
    await expect(
      accept.execute({ actorUserId: MARC.id, userId: MARC.id, invitationId }),
    ).rejects.toMatchObject({ refusal: { reason: 'invitation-not-found' } });
  });

  it('resends an expired invitation for 7 more days, then lets it be accepted', async () => {
    scenario.clock.advance(WEEK + 1);
    const resent: InvitationView = await new ResendInvitation(
      scenario.store,
      scenario.clock,
    ).execute({ actorUserId: CAMILLE.id, organizationId: scenario.organizationId, invitationId });

    expect(resent).toMatchObject({
      status: 'pending',
      version: 2,
      invitedBy: { userId: CAMILLE.id, name: 'Camille Martin' },
    });
    expect(resent.expiresAt.getTime() - resent.sentAt.getTime()).toBe(WEEK);
    expect(scenario.store.eventsNamed('invitation.issued.v1')[0]?.payload).toMatchObject({
      version: 2,
      inviterUserId: CAMILLE.id,
    });
    await expect(
      accept.execute({ actorUserId: MARC.id, userId: MARC.id, invitationId }),
    ).resolves.toMatchObject({ role: 'member' });
  });

  it('refuses once, and never accepts a revoked or refused invitation', async () => {
    const refuse: RefuseInvitation = new RefuseInvitation(scenario.store, scenario.clock);
    const revoke: RevokeInvitation = new RevokeInvitation(scenario.store, scenario.clock);
    const resend: ResendInvitation = new ResendInvitation(scenario.store, scenario.clock);
    const owner = { actorUserId: CAMILLE.id, organizationId: scenario.organizationId };

    await revoke.execute({ ...owner, invitationId });
    await revoke.execute({ ...owner, invitationId });
    await expect(
      accept.execute({ actorUserId: MARC.id, userId: MARC.id, invitationId }),
    ).rejects.toMatchObject({ refusal: { reason: 'invitation-revoked' } });
    await expect(resend.execute({ ...owner, invitationId })).rejects.toMatchObject({
      refusal: { reason: 'invitation-revoked' },
    });

    const batch: InviteMembersOutput = await new InviteMembers(
      scenario.store,
      scenario.clock,
    ).execute({ ...owner, emails: [MARC.email], role: 'member' });
    const second: string = batch.invitations[0]?.invitationId ?? '';
    await refuse.execute({ actorUserId: MARC.id, userId: MARC.id, invitationId: second });
    await expect(
      refuse.execute({ actorUserId: MARC.id, userId: MARC.id, invitationId: second }),
    ).rejects.toMatchObject({ refusal: { reason: 'invitation-answered', status: 'refused' } });
    await expect(revoke.execute({ ...owner, invitationId: second })).rejects.toMatchObject({
      refusal: { reason: 'invitation-answered' },
    });
    await expect(
      revoke.execute({
        actorUserId: HUGO.id,
        organizationId: scenario.organizationId,
        invitationId,
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'role-forbidden' } });
    expect(scenario.store.eventsNamed('member.joined.v1')).toEqual([]);
  });
});
