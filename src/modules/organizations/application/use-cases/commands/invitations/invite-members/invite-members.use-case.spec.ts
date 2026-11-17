import { beforeEach, describe, expect, it } from 'vitest';

import { atelierNord, CAMILLE, HUGO, INES } from '../../../organizations.scenario.fixture.js';
import type { AtelierNord } from '../../../organizations.scenario.fixture.js';
import type { InviteMembersOutput } from './invite-members.output.js';
import { InviteMembers } from './invite-members.use-case.js';

/** One hour, in milliseconds. */
const HOUR: number = 60 * 60_000;

/**
 * Addresses nobody was invited with yet.
 *
 * @param prefix - What tells this run of addresses from the others.
 * @param count - How many.
 * @returns The addresses.
 */
function newcomers(prefix: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_: unknown, index: number) => `${prefix}.${String(index)}@exemple.fr`,
  );
}

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

  it('records one invitation email per address invited, none for the others', async () => {
    const before: number = scenario.store.tables.invitationEmails.length;

    const batch: InviteMembersOutput = await invite.execute({
      actorUserId: INES.id,
      organizationId: scenario.organizationId,
      emails: ['marc.roux@ateliernord.fr', HUGO.email, 'lucie@exemple.fr'],
      role: 'member',
    });

    expect(batch.invitations.map((outcome) => outcome.outcome)).toEqual([
      'invited',
      'already-member',
      'invited',
    ]);
    expect(scenario.store.tables.invitationEmails).toHaveLength(before + 2);
    expect(scenario.store.tables.invitationEmails.slice(before)).toEqual([
      {
        organizationId: scenario.organizationId,
        invitationId: batch.invitations[0]?.invitationId,
        sentAt: scenario.clock.now(),
      },
      {
        organizationId: scenario.organizationId,
        invitationId: batch.invitations[2]?.invitationId,
        sentAt: scenario.clock.now(),
      },
    ]);
  });

  it('refuses a batch that needs more emails than remain as a whole, and writes nothing', async () => {
    const owner = { actorUserId: CAMILLE.id, organizationId: scenario.organizationId };
    await invite.execute({ ...owner, emails: newcomers('first', 50), role: 'member' });
    await invite.execute({ ...owner, emails: newcomers('second', 42), role: 'guest' });
    const invitations: number = scenario.store.tables.invitations.size;
    const emails: number = scenario.store.tables.invitationEmails.length;
    scenario.store.tables.events = [];

    await expect(
      invite.execute({
        ...owner,
        emails: [HUGO.email, 'first.0@exemple.fr', ...newcomers('third', 6)],
        role: 'member',
      }),
    ).rejects.toMatchObject({
      refusal: {
        reason: 'invitation-daily-limit-reached',
        remaining: 5,
        nextAvailableAt: new Date('2026-11-09T09:00:00Z'),
      },
    });
    expect(scenario.store.tables.invitations.size).toBe(invitations);
    expect(scenario.store.tables.invitationEmails).toHaveLength(emails);
    expect(scenario.store.tables.events).toEqual([]);

    const fits: InviteMembersOutput = await invite.execute({
      ...owner,
      emails: [HUGO.email, 'first.0@exemple.fr', ...newcomers('third', 5)],
      role: 'member',
    });
    expect(fits.invitations.filter((outcome) => outcome.outcome === 'invited')).toHaveLength(5);
    expect(scenario.store.tables.invitationEmails).toHaveLength(100);
  });

  it('never refuses a batch of members and pending invitations, which needs no email', async () => {
    const owner = { actorUserId: CAMILLE.id, organizationId: scenario.organizationId };
    await invite.execute({ ...owner, emails: newcomers('first', 50), role: 'member' });
    await invite.execute({ ...owner, emails: newcomers('second', 47), role: 'member' });

    const batch: InviteMembersOutput = await invite.execute({
      ...owner,
      emails: [HUGO.email, 'second.46@exemple.fr'],
      role: 'member',
    });

    expect(batch.invitations.map((outcome) => outcome.outcome)).toEqual([
      'already-member',
      'already-invited',
    ]);
  });

  it('grows the allowance again as each email leaves the 24 hours after its sending', async () => {
    const owner = { actorUserId: CAMILLE.id, organizationId: scenario.organizationId };
    scenario.clock.advance(HOUR);
    await invite.execute({ ...owner, emails: newcomers('first', 50), role: 'member' });
    scenario.clock.advance(HOUR);
    await invite.execute({ ...owner, emails: newcomers('second', 47), role: 'member' });

    await expect(
      invite.execute({ ...owner, emails: ['lucie@exemple.fr'], role: 'member' }),
    ).rejects.toMatchObject({
      refusal: { remaining: 0, nextAvailableAt: new Date('2026-11-09T09:00:00Z') },
    });

    scenario.clock.advance(22 * HOUR);
    const freed: InviteMembersOutput = await invite.execute({
      ...owner,
      emails: newcomers('third', 3),
      role: 'member',
    });
    expect(freed.invitations.map((outcome) => outcome.outcome)).toEqual([
      'invited',
      'invited',
      'invited',
    ]);
    expect(scenario.store.tables.invitationEmails).toHaveLength(100);
    await expect(
      invite.execute({ ...owner, emails: ['lucie@exemple.fr'], role: 'member' }),
    ).rejects.toMatchObject({
      refusal: { remaining: 0, nextAvailableAt: new Date('2026-11-09T10:00:00Z') },
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
