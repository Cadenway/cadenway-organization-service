import { beforeEach, describe, expect, it } from 'vitest';

import type { InvitationView } from '../../../../projections/invitations/invitation-view.projection.js';
import { atelierNord, CAMILLE, HUGO, INES } from '../../../organizations.scenario.fixture.js';
import type { AtelierNord } from '../../../organizations.scenario.fixture.js';
import type { InviteMembersOutput } from '../invite-members/invite-members.output.js';
import { InviteMembers } from '../invite-members/invite-members.use-case.js';
import { ResendInvitation } from './resend-invitation.use-case.js';

/** One hour, in milliseconds. */
const HOUR: number = 60 * 60_000;

describe('ResendInvitation', () => {
  let scenario: AtelierNord;
  let resend: ResendInvitation;
  let invitationId: string;
  let owner: { readonly actorUserId: string; readonly organizationId: string };

  beforeEach(async () => {
    scenario = await atelierNord();
    resend = new ResendInvitation(scenario.store, scenario.clock);
    owner = { actorUserId: CAMILLE.id, organizationId: scenario.organizationId };
    const batch: InviteMembersOutput = await new InviteMembers(
      scenario.store,
      scenario.clock,
    ).execute({ ...owner, emails: ['marc.roux@ateliernord.fr'], role: 'member' });
    invitationId = batch.invitations[0]?.invitationId ?? '';
    scenario.store.tables.events = [];
  });

  it('refuses a resend within the hour of the last sending, and changes nothing', async () => {
    const emails: number = scenario.store.tables.invitationEmails.length;
    scenario.clock.advance(HOUR - 1);

    await expect(resend.execute({ ...owner, invitationId })).rejects.toMatchObject({
      refusal: {
        reason: 'invitation-resend-throttled',
        resendAvailableAt: new Date('2026-11-08T10:00:00Z'),
      },
    });
    expect(scenario.store.tables.invitations.get(invitationId)).toMatchObject({ version: 1 });
    expect(scenario.store.tables.invitationEmails).toHaveLength(emails);
    expect(scenario.store.tables.events).toEqual([]);
  });

  it('resends once the hour is over, counts its email, then waits an hour from that resend', async () => {
    const emails: number = scenario.store.tables.invitationEmails.length;
    scenario.clock.advance(HOUR);

    const resent: InvitationView = await resend.execute({ ...owner, invitationId });

    expect(resent).toMatchObject({ sentAt: new Date('2026-11-08T10:00:00Z'), version: 2 });
    expect(scenario.store.tables.invitationEmails).toHaveLength(emails + 1);
    expect(scenario.store.tables.invitationEmails.at(-1)).toEqual({
      organizationId: scenario.organizationId,
      invitationId,
      sentAt: new Date('2026-11-08T10:00:00Z'),
    });
    expect(scenario.store.eventsNamed('invitation.issued.v1')).toHaveLength(1);

    scenario.clock.advance(HOUR / 2);
    await expect(resend.execute({ ...owner, invitationId })).rejects.toMatchObject({
      refusal: {
        reason: 'invitation-resend-throttled',
        resendAvailableAt: new Date('2026-11-08T11:00:00Z'),
      },
    });
  });

  it('refuses a resend with no invitation email left today, after the hour rule', async () => {
    const invite: InviteMembers = new InviteMembers(scenario.store, scenario.clock);
    for (const [prefix, count] of [
      ['first', 50],
      ['second', 46],
    ] as const) {
      await invite.execute({
        actorUserId: INES.id,
        organizationId: scenario.organizationId,
        emails: Array.from(
          { length: count },
          (_: unknown, index: number) => `${prefix}.${String(index)}@exemple.fr`,
        ),
        role: 'member',
      });
    }
    expect(scenario.store.tables.invitationEmails).toHaveLength(100);
    scenario.store.tables.events = [];

    await expect(resend.execute({ ...owner, invitationId })).rejects.toMatchObject({
      refusal: { reason: 'invitation-resend-throttled' },
    });
    scenario.clock.advance(HOUR);
    await expect(resend.execute({ ...owner, invitationId })).rejects.toMatchObject({
      refusal: {
        reason: 'invitation-daily-limit-reached',
        remaining: 0,
        nextAvailableAt: new Date('2026-11-09T09:00:00Z'),
      },
    });
    expect(scenario.store.tables.invitations.get(invitationId)).toMatchObject({ version: 1 });
    expect(scenario.store.tables.invitationEmails).toHaveLength(100);
    expect(scenario.store.tables.events).toEqual([]);
  });

  it('lets only the owner and the admins resend, and only the invitations of their organization', async () => {
    scenario.clock.advance(HOUR);

    await expect(
      resend.execute({ ...owner, actorUserId: HUGO.id, invitationId }),
    ).rejects.toMatchObject({ refusal: { reason: 'role-forbidden' } });
    await expect(
      resend.execute({ ...owner, organizationId: 'elsewhere', invitationId }),
    ).rejects.toMatchObject({ refusal: { reason: 'organization-not-found' } });
    await expect(
      resend.execute({ ...owner, invitationId: '00000000-0000-7000-8000-999999999999' }),
    ).rejects.toMatchObject({ refusal: { reason: 'invitation-not-found' } });
  });
});
