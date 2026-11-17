import { describe, expect, it } from 'vitest';

import { MemberRemovedError } from '../../errors/members/member-removed.error.js';
import { OwnerProtectedError } from '../../errors/members/owner-protected.error.js';
import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import type { MemberDraft } from '../../value-objects/members/member-draft.value-object.js';
import { Member } from './member.aggregate.js';

/** Atelier Nord. */
const ATELIER_NORD_ID: string = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';

/** When the memberships of the specs began. */
const JOINED_AT: Date = new Date('2026-03-03T09:40:00Z');

/**
 * A stored membership.
 *
 * @param draft - The membership as created.
 * @returns The membership.
 */
function stored(draft: MemberDraft): Member {
  return Member.restore({ ...draft, id: '019a5f3d-1a2b-7c3d-8e4f-5a6b7c8d9e41', removedAt: null });
}

describe('Member', () => {
  it('makes the creator the owner, without invitation, at version 1', () => {
    expect(Member.owner(ATELIER_NORD_ID, 'camille', JOINED_AT)).toEqual({
      organizationId: ATELIER_NORD_ID,
      userId: 'camille',
      role: 'owner',
      invitationId: null,
      joinedAt: JOINED_AT,
      version: 1,
    });
  });

  it('gives a joining account the role of its invitation', () => {
    expect(Member.joining(ATELIER_NORD_ID, 'ines', 'admin', 'invitation', JOINED_AT)).toMatchObject(
      { role: 'admin', invitationId: 'invitation', version: 1 },
    );
  });

  it('changes the role of a member with the next version, and keeps the same role as is', () => {
    const ines: Member = stored(
      Member.joining(ATELIER_NORD_ID, 'ines', 'member', 'invitation', JOINED_AT),
    );

    const admin: Member = ines.changeRole('admin');

    expect(admin.snapshot).toMatchObject({ role: 'admin', version: 2 });
    expect(admin.changeRole('admin')).toBe(admin);
  });

  it('never changes the role of the owner nor removes them', () => {
    const camille: Member = stored(Member.owner(ATELIER_NORD_ID, 'camille', JOINED_AT));

    expect(() => camille.changeRole('admin')).toThrow(OwnerProtectedError);
    expect(() => camille.remove(JOINED_AT)).toThrow(OwnerProtectedError);
  });

  it('removes a member with its last version, and never changes it again', () => {
    const hugo: Member = stored(
      Member.joining(ATELIER_NORD_ID, 'hugo', 'member', 'invitation', JOINED_AT),
    );

    const removed: Member = hugo.remove(new Date('2026-11-08T10:00:00Z'));

    expect(removed.snapshot).toMatchObject({
      removedAt: new Date('2026-11-08T10:00:00Z'),
      role: 'member',
      version: 2,
    });
    expect(() => removed.remove(JOINED_AT)).toThrow(MemberRemovedError);
    expect(() => removed.changeRole('admin')).toThrow(MemberRemovedError);
  });

  it('refuses a stored membership without a positive version', () => {
    expect(() =>
      Member.restore({
        ...Member.owner(ATELIER_NORD_ID, 'camille', JOINED_AT),
        id: 'member',
        removedAt: null,
        version: 0,
      }),
    ).toThrow(InvalidStoredStateError);
  });
});
