import { describe, expect, it } from 'vitest';

import { InvitationAnsweredError } from '../../errors/invitations/invitation-answered.error.js';
import { InvitationExpiredError } from '../../errors/invitations/invitation-expired.error.js';
import { InvitationRevokedError } from '../../errors/invitations/invitation-revoked.error.js';
import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import { EmailAddress } from '../../value-objects/email/email-address.value-object.js';
import { Invitation } from './invitation.aggregate.js';

/** When the invitation of Marc Roux was sent ("Expire dans 5 jours" on 8 November). */
const SENT_AT: Date = new Date('2026-11-06T16:20:00Z');

/** One day, in milliseconds. */
const DAY: number = 24 * 60 * 60_000;

/**
 * An instant after the sending.
 *
 * @param days - Days after the sending.
 * @returns The instant.
 */
function after(days: number): Date {
  return new Date(SENT_AT.getTime() + days * DAY);
}

/**
 * The pending invitation of Marc Roux to Atelier Nord, sent by Inès Robert.
 *
 * @returns The invitation.
 */
function marcRoux(): Invitation {
  return Invitation.restore({
    ...Invitation.issue(
      '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f',
      EmailAddress.parse('Marc.Roux@ateliernord.fr'),
      'member',
      'ines',
      SENT_AT,
    ),
    id: '019a6b10-3c4d-7e5f-8a6b-7c8d9e0f1a70',
  });
}

describe('Invitation', () => {
  it('is valid 7 days from its sending, addressed to the address without regard to case', () => {
    const invitation: Invitation = marcRoux();

    expect(invitation.snapshot).toMatchObject({
      email: 'marc.roux@ateliernord.fr',
      status: 'pending',
      expiresAt: after(7),
      answeredAt: null,
      version: 1,
    });
    expect(invitation.isAddressedTo(EmailAddress.parse('MARC.ROUX@ateliernord.fr'))).toBe(true);
    expect(invitation.isAddressedTo(EmailAddress.parse('hugo.dubois@ateliernord.fr'))).toBe(false);
  });

  it('shows pending before its expiry and expired from then on', () => {
    expect(Invitation.pendingStatusAt(after(7), after(6.9))).toBe('pending');
    expect(Invitation.pendingStatusAt(after(7), after(7))).toBe('expired');
  });

  it('starts its 7 days again at a resend, expired or not, with the next version', () => {
    const resent: Invitation = marcRoux().resend(after(10));

    expect(resent.snapshot).toMatchObject({
      status: 'pending',
      sentAt: after(10),
      expiresAt: after(17),
      version: 2,
    });
    expect(resent.accept(after(16)).snapshot.status).toBe('accepted');
  });

  it('is accepted or refused once, before its expiry', () => {
    const accepted: Invitation = marcRoux().accept(after(1));
    const refused: Invitation = marcRoux().refuse(after(1));

    expect(accepted.snapshot).toMatchObject({
      status: 'accepted',
      answeredAt: after(1),
      version: 2,
    });
    expect(refused.snapshot.status).toBe('refused');
    expect(() => accepted.accept(after(2))).toThrow(InvitationAnsweredError);
    expect(() => refused.accept(after(2))).toThrow(InvitationAnsweredError);
    expect(() => accepted.resend(after(2))).toThrow(InvitationAnsweredError);
    expect(() => marcRoux().accept(after(7))).toThrow(InvitationExpiredError);
    expect(() => marcRoux().refuse(after(8))).toThrow(InvitationExpiredError);
  });

  it('tells which answer an answered invitation got', () => {
    try {
      marcRoux().refuse(after(1)).accept(after(2));
    } catch (error) {
      expect(error).toMatchObject({ status: 'refused' });
    }
  });

  it('revokes a pending invitation once, expired or not, and never an answered one', () => {
    const revoked: Invitation = marcRoux().revoke(after(9));

    expect(revoked.snapshot).toMatchObject({ status: 'revoked', version: 2 });
    expect(revoked.revoke(after(10))).toBe(revoked);
    expect(() => revoked.accept(after(9))).toThrow(InvitationRevokedError);
    expect(() => revoked.resend(after(9))).toThrow(InvitationRevokedError);
    expect(() => marcRoux().accept(after(1)).revoke(after(2))).toThrow(InvitationAnsweredError);
  });

  it('answers a revoked invitation as revoked rather than expired', () => {
    expect(() => marcRoux().revoke(after(1)).accept(after(30))).toThrow(InvitationRevokedError);
  });

  it('refuses a stored invitation without a positive version', () => {
    expect(() => Invitation.restore({ ...marcRoux().snapshot, version: 0 })).toThrow(
      InvalidStoredStateError,
    );
  });
});
