import { MemberRemovedError } from '../../errors/members/member-removed.error.js';
import { OwnerProtectedError } from '../../errors/members/owner-protected.error.js';
import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import type { AssignableRole } from '../../value-objects/members/assignable-role.value-object.js';
import type { MemberDraft } from '../../value-objects/members/member-draft.value-object.js';
import type { MemberState } from '../../value-objects/members/member-state.value-object.js';
import type { Role } from '../../value-objects/members/role.value-object.js';

/**
 * Class Member
 *
 * @description
 * A membership: an account in an organization with a role. Rules, from decision 1 of P2b,
 * `openapi/public/members.yaml` and `asyncapi/organization-service.yaml`:
 *
 * - the creator of an organization is its one owner; every other member joins by an invitation,
 *   with its role;
 * - nobody changes the role of the owner or removes them, and nobody becomes owner by a change of
 *   role;
 * - giving the same role changes nothing; any change adds one to the version;
 * - a removed membership stays removed; a person who joins again gets a new membership.
 */
export class Member {
  // #region Properties
  /**
   * Property state
   *
   * @description
   * The state of the membership; a change returns a new `Member`.
   *
   * @type {MemberState}
   * @readonly
   */
  private readonly state: MemberState;

  /**
   * Property id
   *
   * @description
   * Id of the membership.
   *
   * @type {string}
   * @readonly
   */
  public get id(): string {
    return this.state.id;
  }

  /**
   * Property userId
   *
   * @description
   * Account of the member.
   *
   * @type {string}
   * @readonly
   */
  public get userId(): string {
    return this.state.userId;
  }

  /**
   * Property role
   *
   * @description
   * Role of the member.
   *
   * @type {Role}
   * @readonly
   */
  public get role(): Role {
    return this.state.role;
  }

  /**
   * Property snapshot
   *
   * @description
   * The state to store.
   *
   * @type {MemberState}
   * @readonly
   */
  public get snapshot(): MemberState {
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
   * @param {MemberState} state - The checked state.
   * @constructor
   */
  private constructor(state: MemberState) {
    this.state = state;
  }
  // #endregion

  // #region Methods
  /**
   * Method owner
   *
   * @description
   * The membership of the creator of an organization, its owner ("Vous en serez propriétaire."),
   * at version 1 and without invitation.
   *
   * @param {string} organizationId - The new organization.
   * @param {string} userId - The creator.
   * @param {Date} now - When the organization is created.
   * @returns {MemberDraft} The membership to store.
   */
  public static owner(organizationId: string, userId: string, now: Date): MemberDraft {
    return { organizationId, userId, role: 'owner', invitationId: null, joinedAt: now, version: 1 };
  }

  /**
   * Method joining
   *
   * @description
   * The membership of an account that accepts an invitation, with the role of the invitation, at
   * version 1.
   *
   * @param {string} organizationId - The organization of the invitation.
   * @param {string} userId - The account that accepts.
   * @param {AssignableRole} role - The role of the invitation.
   * @param {string} invitationId - The accepted invitation.
   * @param {Date} now - When it is accepted.
   * @returns {MemberDraft} The membership to store.
   */
  public static joining(
    organizationId: string,
    userId: string,
    role: AssignableRole,
    invitationId: string,
    now: Date,
  ): MemberDraft {
    return { organizationId, userId, role, invitationId, joinedAt: now, version: 1 };
  }

  /**
   * Method restore
   *
   * @description
   * Rebuilds a stored membership.
   *
   * @param {MemberState} state - The stored state.
   * @returns {Member} The membership.
   * @throws {InvalidStoredStateError} When the version is not a positive integer.
   */
  public static restore(state: MemberState): Member {
    if (!Number.isInteger(state.version) || state.version < 1) {
      throw new InvalidStoredStateError('member', 'the version is a positive integer');
    }
    return new Member(state);
  }

  /**
   * Method changeRole
   *
   * @description
   * Gives the member another role, at once and without a seat check ("Rôle modifié").
   *
   * @param {AssignableRole} role - The new role, never `owner`.
   * @returns {Member} The member after the change, or this one when the role is the same.
   * @throws {OwnerProtectedError} When the member is the owner.
   * @throws {MemberRemovedError} When the membership was removed.
   */
  public changeRole(role: AssignableRole): Member {
    this.assertChangeable();
    if (role === this.state.role) {
      return this;
    }
    return new Member({ ...this.state, role, version: this.state.version + 1 });
  }

  /**
   * Method remove
   *
   * @description
   * Removes the member from the organization ("Retirer le membre"), its last change.
   *
   * @param {Date} now - When it is removed.
   * @returns {Member} The removed membership.
   * @throws {OwnerProtectedError} When the member is the owner.
   * @throws {MemberRemovedError} When the membership was removed already.
   */
  public remove(now: Date): Member {
    this.assertChangeable();
    return new Member({ ...this.state, removedAt: now, version: this.state.version + 1 });
  }

  /**
   * Method assertChangeable
   *
   * @description
   * Refuses a change to the owner or to a removed membership.
   *
   * @throws {MemberRemovedError} When the membership was removed.
   * @throws {OwnerProtectedError} When the member is the owner.
   */
  private assertChangeable(): void {
    if (this.state.removedAt !== null) {
      throw new MemberRemovedError();
    }
    if (this.state.role === 'owner') {
      throw new OwnerProtectedError();
    }
  }
  // #endregion
}
