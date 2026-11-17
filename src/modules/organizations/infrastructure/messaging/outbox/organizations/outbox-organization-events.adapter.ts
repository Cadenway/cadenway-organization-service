import { eventSchemas } from '@cadenway/contracts/events/organization-service';
import type { TransactionScope } from '@cadenway/nest-common/database';
import type { OutboxWriter } from '@cadenway/nest-messaging/outbox';

import type { InvitationMail } from '../../../../application/models/invitations/invitation-mail.model.js';
import type { OrganizationEvents } from '../../../../application/ports/outbound/messaging/organizations/organization-events.port.js';
import type { Invitation } from '../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { Member } from '../../../../domain/aggregates/member/member.aggregate.js';
import type { Organization } from '../../../../domain/aggregates/organization/organization.aggregate.js';
import type { InvitationState } from '../../../../domain/value-objects/invitations/invitation-state.value-object.js';
import type { MemberState } from '../../../../domain/value-objects/members/member-state.value-object.js';
import type { Role } from '../../../../domain/value-objects/members/role.value-object.js';
import type { OrganizationField } from '../../../../domain/value-objects/organizations/organization-field.value-object.js';
import type { OrganizationState } from '../../../../domain/value-objects/organizations/organization-state.value-object.js';

/**
 * Class OutboxOrganizationEvents
 *
 * @description
 * `OrganizationEvents` on the outbox of `@cadenway/nest-messaging`, in the transaction of its unit
 * of work, validated with the schemas of `@cadenway/contracts/events/organization-service`. Every
 * event carries its organization, so it is appended in the tenant transaction of that organization
 * or, for a creation, in the system transaction that creates it. None is restricted: the
 * invitation id of `invitation.issued.v1` is not a capability (decision 5 of P2b).
 */
export class OutboxOrganizationEvents implements OrganizationEvents {
  // #region Properties
  /**
   * Property transaction
   *
   * @description
   * The transaction the events are appended in.
   *
   * @type {TransactionScope}
   * @readonly
   */
  private readonly transaction: TransactionScope;

  /**
   * Property outbox
   *
   * @description
   * The outbox writer of the kit.
   *
   * @type {OutboxWriter}
   * @readonly
   */
  private readonly outbox: OutboxWriter;

  /**
   * Property onAppend
   *
   * @description
   * Called after each append, so the unit of work wakes the relay once it commits.
   *
   * @type {() => void}
   * @readonly
   */
  private readonly onAppend: () => void;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Binds the events to a transaction.
   *
   * @param {TransactionScope} transaction - The transaction the events are appended in.
   * @param {OutboxWriter} outbox - The outbox writer of the kit.
   * @param {() => void} onAppend - Called after each append.
   * @constructor
   */
  public constructor(transaction: TransactionScope, outbox: OutboxWriter, onAppend: () => void) {
    this.transaction = transaction;
    this.outbox = outbox;
    this.onAppend = onAppend;
  }
  // #endregion

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
  public async organizationCreated(organization: Organization): Promise<void> {
    const state: OrganizationState = organization.snapshot;
    await this.outbox.append(this.transaction, eventSchemas, 'organization.created.v1', {
      organizationId: state.id,
      actor: { type: 'user', id: state.ownerUserId },
      version: state.version,
      name: state.name,
      slug: state.slug,
      defaultLanguage: state.defaultLanguage,
      plan: state.plan,
      ownerUserId: state.ownerUserId,
      teamSize: state.teamSize,
      primaryUse: state.primaryUse,
    });
    this.onAppend();
  }

  /**
   * Method organizationUpdated
   *
   * @description
   * Appends `organization.updated.v1` with the whole profile after the change.
   *
   * @param {Organization} organization - The organization after the change.
   * @param {readonly OrganizationField[]} changed - The members that moved.
   * @param {string} actorUserId - The owner or the admin who changed it.
   * @returns {Promise<void>} Resolves once appended.
   */
  public async organizationUpdated(
    organization: Organization,
    changed: readonly OrganizationField[],
    actorUserId: string,
  ): Promise<void> {
    const state: OrganizationState = organization.snapshot;
    await this.outbox.append(this.transaction, eventSchemas, 'organization.updated.v1', {
      organizationId: state.id,
      actor: { type: 'user', id: actorUserId },
      version: state.version,
      name: state.name,
      slug: state.slug,
      description: state.description,
      website: state.website,
      defaultLanguage: state.defaultLanguage,
      changed: [...changed],
    });
    this.onAppend();
  }

  /**
   * Method memberJoined
   *
   * @description
   * Appends `member.joined.v1`; its actor is the account that joined.
   *
   * @param {Member} member - The new membership.
   * @returns {Promise<void>} Resolves once appended.
   */
  public async memberJoined(member: Member): Promise<void> {
    const state: MemberState = member.snapshot;
    await this.outbox.append(this.transaction, eventSchemas, 'member.joined.v1', {
      organizationId: state.organizationId,
      actor: { type: 'user', id: state.userId },
      version: state.version,
      memberId: state.id,
      userId: state.userId,
      role: state.role,
      invitationId: state.invitationId,
    });
    this.onAppend();
  }

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
  public async memberRoleChanged(
    member: Member,
    previousRole: Role,
    actorUserId: string,
  ): Promise<void> {
    const state: MemberState = member.snapshot;
    await this.outbox.append(this.transaction, eventSchemas, 'member.role-changed.v1', {
      organizationId: state.organizationId,
      actor: { type: 'user', id: actorUserId },
      version: state.version,
      memberId: state.id,
      userId: state.userId,
      role: state.role,
      previousRole,
    });
    this.onAppend();
  }

  /**
   * Method memberRemoved
   *
   * @description
   * Appends `member.removed.v1` with the role the member had.
   *
   * @param {Member} member - The removed membership.
   * @param {string} actorUserId - The owner or the admin who removed it.
   * @returns {Promise<void>} Resolves once appended.
   */
  public async memberRemoved(member: Member, actorUserId: string): Promise<void> {
    const state: MemberState = member.snapshot;
    await this.outbox.append(this.transaction, eventSchemas, 'member.removed.v1', {
      organizationId: state.organizationId,
      actor: { type: 'user', id: actorUserId },
      version: state.version,
      memberId: state.id,
      userId: state.userId,
      role: state.role,
    });
    this.onAppend();
  }

  /**
   * Method invitationIssued
   *
   * @description
   * Appends `invitation.issued.v1`, one email to send; its actor is the sender, also `inviter`.
   *
   * @param {Invitation} invitation - The invitation as sent.
   * @param {InvitationMail} mail - The sender, the organization and the language of the email.
   * @returns {Promise<void>} Resolves once appended.
   */
  public async invitationIssued(invitation: Invitation, mail: InvitationMail): Promise<void> {
    const state: InvitationState = invitation.snapshot;
    await this.outbox.append(this.transaction, eventSchemas, 'invitation.issued.v1', {
      organizationId: state.organizationId,
      actor: { type: 'user', id: mail.inviterUserId },
      version: state.version,
      invitationId: state.id,
      email: state.email,
      role: state.role,
      inviter: { userId: mail.inviterUserId, name: mail.inviterName },
      organization: { name: mail.organizationName, memberCount: mail.memberCount },
      expiresAt: state.expiresAt.toISOString(),
      language: mail.language,
    });
    this.onAppend();
  }
  // #endregion
}
