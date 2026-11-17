import type { OrganizationEvents } from '../../ports/outbound/messaging/organizations/organization-events.port.js';
import type { DirectoryRepository } from '../../ports/outbound/persistence/directory/directory-repository.port.js';
import type { InvitationRepository } from '../../ports/outbound/persistence/invitations/invitation-repository.port.js';
import type { MemberRepository } from '../../ports/outbound/persistence/members/member-repository.port.js';
import type { OrganizationRepository } from '../../ports/outbound/persistence/organizations/organization-repository.port.js';

/**
 * Interface OrganizationsStore
 *
 * @description
 * The repositories and the outbox of one transaction of the organizations module.
 */
export interface OrganizationsStore {
  // #region Properties
  /**
   * Property organizations
   *
   * @description
   * The organizations.
   *
   * @type {OrganizationRepository}
   * @readonly
   */
  readonly organizations: OrganizationRepository;

  /**
   * Property members
   *
   * @description
   * The memberships.
   *
   * @type {MemberRepository}
   * @readonly
   */
  readonly members: MemberRepository;

  /**
   * Property invitations
   *
   * @description
   * The invitations.
   *
   * @type {InvitationRepository}
   * @readonly
   */
  readonly invitations: InvitationRepository;

  /**
   * Property directory
   *
   * @description
   * The user directory, projected from the events of identity-service.
   *
   * @type {DirectoryRepository}
   * @readonly
   */
  readonly directory: DirectoryRepository;

  /**
   * Property events
   *
   * @description
   * The outbox of the transaction.
   *
   * @type {OrganizationEvents}
   * @readonly
   */
  readonly events: OrganizationEvents;
  // #endregion
}
