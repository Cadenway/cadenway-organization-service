import type { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import type { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import type { Role } from '../../../../../domain/value-objects/members/role.value-object.js';
import type { OrganizationField } from '../../../../../domain/value-objects/organizations/organization-field.value-object.js';
import type { InvitationMail } from '../../../../models/invitations/invitation-mail.model.js';

/**
 * Interface OrganizationEvents
 *
 * @description
 * The events of `asyncapi/organization-service.yaml`, appended to the outbox in the transaction of
 * the change, each with the organization it belongs to and the version of its aggregate after the
 * change.
 */
export interface OrganizationEvents {
  // #region Methods
  /**
   * Method organizationCreated
   *
   * @description
   * Appends `organization.created.v1`; its actor is the creator, the owner.
   *
   * @param {Organization} organization - The new organization.
   * @returns {Promise<void>} Resolves once appended.
   */
  organizationCreated(organization: Organization): Promise<void>;

  /**
   * Method organizationUpdated
   *
   * @description
   * Appends `organization.updated.v1` with the whole profile and the members that moved.
   *
   * @param {Organization} organization - The organization after the change.
   * @param {readonly OrganizationField[]} changed - The members that moved, one at least.
   * @param {string} actorUserId - The owner or the admin who changed it.
   * @returns {Promise<void>} Resolves once appended.
   */
  organizationUpdated(
    organization: Organization,
    changed: readonly OrganizationField[],
    actorUserId: string,
  ): Promise<void>;

  /**
   * Method memberJoined
   *
   * @description
   * Appends `member.joined.v1`; its actor is the account that joined.
   *
   * @param {Member} member - The new membership.
   * @returns {Promise<void>} Resolves once appended.
   */
  memberJoined(member: Member): Promise<void>;

  /**
   * Method memberRoleChanged
   *
   * @description
   * Appends `member.role-changed.v1`.
   *
   * @param {Member} member - The membership after the change.
   * @param {Role} previousRole - The role it had.
   * @param {string} actorUserId - The owner or the admin who changed it.
   * @returns {Promise<void>} Resolves once appended.
   */
  memberRoleChanged(member: Member, previousRole: Role, actorUserId: string): Promise<void>;

  /**
   * Method memberRemoved
   *
   * @description
   * Appends `member.removed.v1`, the last event of the membership.
   *
   * @param {Member} member - The removed membership.
   * @param {string} actorUserId - The owner or the admin who removed it.
   * @returns {Promise<void>} Resolves once appended.
   */
  memberRemoved(member: Member, actorUserId: string): Promise<void>;

  /**
   * Method memberRemovedBySystem
   *
   * @description
   * Appends `member.removed.v1` for a membership of an account identity-service deleted
   * (`user.deleted.v1`), the last event of the membership; its actor is the system,
   * `{ type: 'system', id: 'organization-service' }`, as the contract says.
   *
   * @param {Member} member - The removed membership.
   * @returns {Promise<void>} Resolves once appended.
   */
  memberRemovedBySystem(member: Member): Promise<void>;

  /**
   * Method invitationIssued
   *
   * @description
   * Appends `invitation.issued.v1`, one email to send, at the creation and at each resend of an
   * invitation; its actor is the sender, also its `inviter`.
   *
   * @param {Invitation} invitation - The invitation as sent.
   * @param {InvitationMail} mail - The sender, the organization and the language of the email.
   * @returns {Promise<void>} Resolves once appended.
   */
  invitationIssued(invitation: Invitation, mail: InvitationMail): Promise<void>;
  // #endregion
}
