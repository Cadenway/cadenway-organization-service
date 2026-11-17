import { InvitationAnsweredError } from '../../errors/invitations/invitation-answered.error.js';
import { InvitationExpiredError } from '../../errors/invitations/invitation-expired.error.js';
import { InvitationResendThrottledError } from '../../errors/invitations/invitation-resend-throttled.error.js';
import { InvitationRevokedError } from '../../errors/invitations/invitation-revoked.error.js';
import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import { EmailAddress } from '../../value-objects/email/email-address.value-object.js';
import type { InvitationDraft } from '../../value-objects/invitations/invitation-draft.value-object.js';
import type { InvitationState } from '../../value-objects/invitations/invitation-state.value-object.js';
import type { PendingInvitationStatus } from '../../value-objects/invitations/pending-invitation-status.value-object.js';
import type { AssignableRole } from '../../value-objects/members/assignable-role.value-object.js';

/**
 * Class Invitation
 *
 * @description
 * An invitation of an address to join an organization with a role. Rules, from decision 5 of P2b,
 * the invite dialog and the pending list of the mockup (`Organisation.dc.html`) and
 * `openapi/public/members.yaml`:
 *
 * - an invitation is valid 7 days from its last sending ("Elles expirent dans 7 jours.");
 * - a resend sends the email again and starts the 7 days again, expired or not; a revoked or
 *   answered invitation is never sent again;
 * - its email goes out at most once an hour: a resend less than an hour after its last sending is
 *   refused (decision 1 of the P2b security follow-ups);
 * - an expired invitation stays pending until it is resent or revoked;
 * - revoking a revoked invitation changes nothing; an answered one cannot be revoked;
 * - the invitee accepts or refuses a pending invitation before its expiry, once.
 */
export class Invitation {
  // #region Properties
  /**
   * Property VALIDITY_MS
   *
   * @description
   * Validity of an invitation from its last sending: 7 days, in milliseconds.
   *
   * @type {number}
   * @readonly
   */
  public static readonly VALIDITY_MS: number = 7 * 24 * 60 * 60_000;

  /**
   * Property RESEND_INTERVAL_MS
   *
   * @description
   * Time between two sendings of an invitation: one hour, in milliseconds.
   *
   * @type {number}
   * @readonly
   */
  public static readonly RESEND_INTERVAL_MS: number = 60 * 60_000;

  /**
   * Property state
   *
   * @description
   * The state of the invitation; a change returns a new `Invitation`.
   *
   * @type {InvitationState}
   * @readonly
   */
  private readonly state: InvitationState;

  /**
   * Property id
   *
   * @description
   * Id of the invitation.
   *
   * @type {string}
   * @readonly
   */
  public get id(): string {
    return this.state.id;
  }

  /**
   * Property snapshot
   *
   * @description
   * The state to store.
   *
   * @type {InvitationState}
   * @readonly
   */
  public get snapshot(): InvitationState {
    return this.state;
  }
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps a state checked by `restore`.
   *
   * @param {InvitationState} state - The checked state.
   * @constructor
   */
  private constructor(state: InvitationState) {
    this.state = state;
  }
  // #endregion

  // #region Methods
  /**
   * Method issue
   *
   * @description
   * A new pending invitation sent at `now`, valid 7 days, at version 1.
   *
   * @param {string} organizationId - The organization.
   * @param {EmailAddress} email - The invited address.
   * @param {AssignableRole} role - The proposed role.
   * @param {string} invitedByUserId - The owner or the admin who invites.
   * @param {Date} now - When it is sent.
   * @returns {InvitationDraft} The invitation to store.
   */
  public static issue(
    organizationId: string,
    email: EmailAddress,
    role: AssignableRole,
    invitedByUserId: string,
    now: Date,
  ): InvitationDraft {
    return {
      organizationId,
      email: email.value,
      role,
      invitedByUserId,
      status: 'pending',
      sentAt: now,
      expiresAt: new Date(now.getTime() + Invitation.VALIDITY_MS),
      answeredAt: null,
      version: 1,
    };
  }

  /**
   * Method restore
   *
   * @description
   * Rebuilds a stored invitation.
   *
   * @param {InvitationState} state - The stored state.
   * @returns {Invitation} The invitation.
   * @throws {InvalidStoredStateError} When the version is not a positive integer.
   */
  public static restore(state: InvitationState): Invitation {
    if (!Number.isInteger(state.version) || state.version < 1) {
      throw new InvalidStoredStateError('invitation', 'the version is a positive integer');
    }
    return new Invitation(state);
  }

  /**
   * Method pendingStatusAt
   *
   * @description
   * What the pending list shows of a pending invitation at `now`.
   *
   * @param {Date} expiresAt - Its expiry.
   * @param {Date} now - The instant of the list.
   * @returns {PendingInvitationStatus} `expired` from its expiry on, `pending` before.
   */
  public static pendingStatusAt(expiresAt: Date, now: Date): PendingInvitationStatus {
    return now.getTime() >= expiresAt.getTime() ? 'expired' : 'pending';
  }

  /**
   * Method isAddressedTo
   *
   * @description
   * Whether the invitation was sent to an address, without regard to case.
   *
   * @param {EmailAddress} email - The address.
   * @returns {boolean} Whether it is the invited address.
   */
  public isAddressedTo(email: EmailAddress): boolean {
    return EmailAddress.parse(this.state.email).equals(email);
  }

  /**
   * Method resend
   *
   * @description
   * Sends a pending invitation again, expired or not ("Renvoyer"): its 7 days start again at `now`
   * and its version goes up by one. The checks run in the order of the contract: pending first,
   * then one hour at least since its last sending, the invitation itself or the previous resend.
   *
   * @param {Date} now - When it is sent again.
   * @returns {Invitation} The invitation after the resend.
   * @throws {InvitationRevokedError} When it was revoked.
   * @throws {InvitationAnsweredError} When it was accepted or refused.
   * @throws {InvitationResendThrottledError} When it was sent less than an hour before `now`.
   */
  public resend(now: Date): Invitation {
    this.assertPending();
    const resendAvailableAt: Date = new Date(
      this.state.sentAt.getTime() + Invitation.RESEND_INTERVAL_MS,
    );
    if (now.getTime() < resendAvailableAt.getTime()) {
      throw new InvitationResendThrottledError(resendAvailableAt);
    }
    return new Invitation({
      ...this.state,
      sentAt: now,
      expiresAt: new Date(now.getTime() + Invitation.VALIDITY_MS),
      version: this.state.version + 1,
    });
  }

  /**
   * Method revoke
   *
   * @description
   * Revokes a pending invitation, expired or not ("Annuler"): its link stops working.
   *
   * @param {Date} now - When it is revoked.
   * @returns {Invitation} The revoked invitation, or this one when it was revoked already.
   * @throws {InvitationAnsweredError} When it was accepted or refused.
   */
  public revoke(now: Date): Invitation {
    if (this.state.status === 'revoked') {
      return this;
    }
    this.assertPending();
    return this.close('revoked', now);
  }

  /**
   * Method accept
   *
   * @description
   * Accepts the invitation ("Accepter").
   *
   * @param {Date} now - When it is accepted.
   * @returns {Invitation} The accepted invitation.
   * @throws {InvitationRevokedError} When it was revoked.
   * @throws {InvitationAnsweredError} When it was accepted or refused already.
   * @throws {InvitationExpiredError} When its 7 days are over.
   */
  public accept(now: Date): Invitation {
    this.assertAnswerable(now);
    return this.close('accepted', now);
  }

  /**
   * Method refuse
   *
   * @description
   * Refuses the invitation ("Refuser"); the person who invited can send a new one.
   *
   * @param {Date} now - When it is refused.
   * @returns {Invitation} The refused invitation.
   * @throws {InvitationRevokedError} When it was revoked.
   * @throws {InvitationAnsweredError} When it was accepted or refused already.
   * @throws {InvitationExpiredError} When its 7 days are over.
   */
  public refuse(now: Date): Invitation {
    this.assertAnswerable(now);
    return this.close('refused', now);
  }

  /**
   * Method assertPending
   *
   * @description
   * Refuses a change to an invitation that is no longer pending.
   *
   * @throws {InvitationRevokedError} When it was revoked.
   * @throws {InvitationAnsweredError} When it was accepted or refused.
   */
  private assertPending(): void {
    switch (this.state.status) {
      case 'pending':
        return;
      case 'revoked':
        throw new InvitationRevokedError();
      case 'accepted':
      case 'refused':
        throw new InvitationAnsweredError(this.state.status);
    }
  }

  /**
   * Method assertAnswerable
   *
   * @description
   * Refuses an answer to an invitation that is not pending or expired, in the order of the
   * contract: revoked, answered, then expired.
   *
   * @param {Date} now - When the invitee answers.
   * @throws {InvitationRevokedError} When it was revoked.
   * @throws {InvitationAnsweredError} When it was accepted or refused.
   * @throws {InvitationExpiredError} When its 7 days are over.
   */
  private assertAnswerable(now: Date): void {
    this.assertPending();
    if (Invitation.pendingStatusAt(this.state.expiresAt, now) === 'expired') {
      throw new InvitationExpiredError(this.state.expiresAt);
    }
  }

  /**
   * Method close
   *
   * @description
   * Ends the life of a pending invitation with the next version.
   *
   * @param {'accepted' | 'refused' | 'revoked'} status - How it ends.
   * @param {Date} now - When it ends.
   * @returns {Invitation} The closed invitation.
   */
  private close(status: 'accepted' | 'refused' | 'revoked', now: Date): Invitation {
    return new Invitation({
      ...this.state,
      status,
      answeredAt: now,
      version: this.state.version + 1,
    });
  }
  // #endregion
}
