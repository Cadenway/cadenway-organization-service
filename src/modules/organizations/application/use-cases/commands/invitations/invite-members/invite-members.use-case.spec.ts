import { beforeEach, describe, expect, it } from 'vitest';

import { atelierNord, CAMILLE, HUGO, INES } from '../../../organizations.scenario.fixture.js';
import type { AtelierNord } from '../../../organizations.scenario.fixture.js';
import type { InviteMembersInput } from './invite-members.input.js';
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

describe('InviteMembers with an Idempotency-Key', () => {
  let scenario: AtelierNord;
  let invite: InviteMembers;

  beforeEach(async () => {
    scenario = await atelierNord();
    invite = new InviteMembers(scenario.store, scenario.clock);
  });

  /**
   * A keyed batch of Inès Robert, an admin of Atelier Nord.
   *
   * @param emails - The addresses.
   * @param overrides - What differs from the first batch.
   * @returns The input.
   */
  function keyed(
    emails: readonly string[],
    overrides: Partial<InviteMembersInput> = {},
  ): InviteMembersInput {
    return {
      actorUserId: INES.id,
      organizationId: scenario.organizationId,
      emails,
      role: 'member',
      idempotencyKey: 'members-page-7f3a',
      ...overrides,
    };
  }

  /**
   * Changes the role of an active member of Atelier Nord in the committed data.
   *
   * @param userId - The member.
   * @param role - The new role.
   */
  function demote(userId: string, role: 'member' | 'guest'): void {
    for (const [id, member] of scenario.store.tables.members) {
      if (member.userId === userId && member.removedAt === null) {
        scenario.store.tables.members.set(id, { ...member, role });
      }
    }
  }

  it('replays an equivalent batch without sending, emitting or charging the allowances again', async () => {
    const first: InviteMembersOutput = await invite.execute(
      keyed(['marc.roux@ateliernord.fr', 'lucie@exemple.fr']),
    );
    const emails: number = scenario.store.tables.invitationEmails.length;
    const senderEmails: number = scenario.store.tables.senderEmails.length;
    scenario.clock.advance(23 * HOUR);

    const replayed: InviteMembersOutput = await invite.execute(
      keyed([' Marc.Roux@AtelierNord.fr', 'lucie@exemple.fr', 'LUCIE@exemple.fr']),
    );

    expect(replayed).toEqual(first);
    expect(replayed.invitations.map((outcome) => outcome.outcome)).toEqual(['invited', 'invited']);
    expect(scenario.store.eventsNamed('invitation.issued.v1')).toHaveLength(2);
    expect(scenario.store.tables.invitationEmails).toHaveLength(emails);
    expect(scenario.store.tables.senderEmails).toHaveLength(senderEmails);
  });

  it('refuses another batch under the same key, and writes nothing', async () => {
    await invite.execute(keyed(['marc.roux@ateliernord.fr', 'lucie@exemple.fr']));
    const invitations: number = scenario.store.tables.invitations.size;

    for (const other of [
      keyed(['lucie@exemple.fr', 'marc.roux@ateliernord.fr']),
      keyed(['marc.roux@ateliernord.fr', 'lucie@exemple.fr'], { role: 'guest' }),
      keyed(['marc.roux@ateliernord.fr']),
    ]) {
      await expect(invite.execute(other)).rejects.toMatchObject({
        refusal: { reason: 'idempotency-key-reused' },
      });
    }
    expect(scenario.store.tables.invitations.size).toBe(invitations);
    expect(scenario.store.eventsNamed('invitation.issued.v1')).toHaveLength(2);
  });

  it('checks the authorization again before a replay, and answers as a fresh batch would', async () => {
    await invite.execute(keyed(['marc.roux@ateliernord.fr']));
    demote(INES.id, 'member');

    await expect(invite.execute(keyed(['marc.roux@ateliernord.fr']))).rejects.toMatchObject({
      refusal: { reason: 'role-forbidden' },
    });
    await expect(
      invite.execute(keyed(['marc.roux@ateliernord.fr'], { organizationId: 'elsewhere' })),
    ).rejects.toMatchObject({ refusal: { reason: 'organization-not-found' } });
  });

  it('runs the same key afresh for another user', async () => {
    const ines: InviteMembersOutput = await invite.execute(keyed(['marc.roux@ateliernord.fr']));

    const camille: InviteMembersOutput = await invite.execute(
      keyed(['lucie@exemple.fr'], { actorUserId: CAMILLE.id }),
    );

    expect(ines.invitations[0]?.outcome).toBe('invited');
    expect(camille.invitations).toEqual([
      expect.objectContaining({ email: 'lucie@exemple.fr', outcome: 'invited' }),
    ]);
    expect(scenario.store.eventsNamed('invitation.issued.v1')).toHaveLength(2);
  });

  it('stores no refusal of the allowance, so the key runs once emails are available again', async () => {
    const owner = { actorUserId: CAMILLE.id, organizationId: scenario.organizationId };
    await invite.execute({ ...owner, emails: newcomers('first', 50), role: 'member' });
    await invite.execute({ ...owner, emails: newcomers('second', 47), role: 'member' });

    await expect(invite.execute(keyed(['lucie@exemple.fr']))).rejects.toMatchObject({
      refusal: { reason: 'invitation-daily-limit-reached' },
    });
    expect(scenario.store.tables.replays.size).toBe(0);

    scenario.clock.advance(24 * HOUR);
    const later: InviteMembersOutput = await invite.execute(keyed(['lucie@exemple.fr']));
    expect(later.invitations[0]?.outcome).toBe('invited');
  });

  it('answers request-in-progress while an equivalent batch holds the key', async () => {
    const [first, second] = await Promise.allSettled([
      invite.execute(keyed(['marc.roux@ateliernord.fr'])),
      invite.execute(keyed(['marc.roux@ateliernord.fr'])),
    ]);

    expect(first).toMatchObject({ status: 'fulfilled' });
    expect(second).toMatchObject({
      status: 'rejected',
      reason: { refusal: { reason: 'idempotency-request-in-progress' } },
    });
    expect(scenario.store.eventsNamed('invitation.issued.v1')).toHaveLength(1);
    const replayed: InviteMembersOutput = await invite.execute(keyed(['marc.roux@ateliernord.fr']));
    expect(replayed.invitations[0]?.outcome).toBe('invited');
  });

  it('commits nothing when the replay record fails, and lets the key run again', async () => {
    const invitations: number = scenario.store.tables.invitations.size;
    scenario.store.failReplayRecords = true;

    await expect(invite.execute(keyed(['marc.roux@ateliernord.fr']))).rejects.toThrow(
      'The replay record could not be written.',
    );
    expect(scenario.store.tables.invitations.size).toBe(invitations);
    expect(scenario.store.tables.events).toEqual([]);

    scenario.store.failReplayRecords = false;
    const retried: InviteMembersOutput = await invite.execute(keyed(['marc.roux@ateliernord.fr']));
    expect(retried.invitations[0]?.outcome).toBe('invited');
    expect(scenario.store.eventsNamed('invitation.issued.v1')).toHaveLength(1);
  });

  it('runs the key afresh once its 24 hours of replay are over', async () => {
    await invite.execute(keyed(['marc.roux@ateliernord.fr']));
    scenario.clock.advance(24 * HOUR);

    const fresh: InviteMembersOutput = await invite.execute(keyed(['marc.roux@ateliernord.fr']));

    expect(fresh.invitations[0]?.outcome).toBe('already-invited');
    expect(scenario.store.tables.replays.size).toBe(1);
  });
});
