import type { EmailAddress } from '../email/email-address.value-object.js';
import type { AssignableRole } from '../members/assignable-role.value-object.js';

/**
 * Interface InvitationBatchRequestState
 *
 * @description
 * The canonical form of an invitation batch: its distinct addresses, trimmed and lowercased, in
 * the order of their first appearance, and its role.
 */
export interface InvitationBatchRequestState {
  // #region Properties
  /**
   * Property emails
   *
   * @description
   * The distinct addresses, in order.
   *
   * @type {readonly string[]}
   * @readonly
   */
  readonly emails: readonly string[];

  /**
   * Property role
   *
   * @description
   * The role of every address of the batch.
   *
   * @type {AssignableRole}
   * @readonly
   */
  readonly role: AssignableRole;
  // #endregion
}

/**
 * Class InvitationBatchRequest
 *
 * @description
 * What an invitation batch asks for, the equivalence the `Idempotency-Key` of `inviteMembers`
 * replays on (`openapi/internal/organization-service.yaml`): two batches are equivalent when their
 * distinct addresses, compared without regard to case or surrounding spaces, come in the same order
 * with the same role. A repeated address or a change of case is the same batch, since the batch
 * answers each distinct address once in its order; another order, address or role is not.
 */
export class InvitationBatchRequest {
  // #region Properties
  /**
   * Property state
   *
   * @description
   * The canonical form.
   *
   * @type {InvitationBatchRequestState}
   * @readonly
   */
  private readonly state: InvitationBatchRequestState;

  /**
   * Property snapshot
   *
   * @description
   * The canonical form, to store with a replay.
   *
   * @type {InvitationBatchRequestState}
   */
  public get snapshot(): InvitationBatchRequestState {
    return this.state;
  }
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps a copy of a canonical form.
   *
   * @param {InvitationBatchRequestState} state - The canonical form.
   * @constructor
   */
  private constructor(state: InvitationBatchRequestState) {
    this.state = { emails: [...state.emails], role: state.role };
  }
  // #endregion

  // #region Methods
  /**
   * Method of
   *
   * @description
   * The request of a batch from its distinct addresses (`distinctAddresses`) and its role.
   *
   * @param {readonly EmailAddress[]} addresses - The distinct addresses, in order.
   * @param {AssignableRole} role - The role.
   * @returns {InvitationBatchRequest} The request.
   */
  public static of(
    addresses: readonly EmailAddress[],
    role: AssignableRole,
  ): InvitationBatchRequest {
    return new InvitationBatchRequest({
      emails: addresses.map((address: EmailAddress): string => address.value),
      role,
    });
  }

  /**
   * Method restore
   *
   * @description
   * The request a stored replay was committed for.
   *
   * @param {InvitationBatchRequestState} state - The stored canonical form.
   * @returns {InvitationBatchRequest} The request.
   */
  public static restore(state: InvitationBatchRequestState): InvitationBatchRequest {
    return new InvitationBatchRequest(state);
  }

  /**
   * Method equals
   *
   * @description
   * Whether two batches are equivalent: the same addresses in the same order, the same role.
   *
   * @param {InvitationBatchRequest} other - The other batch.
   * @returns {boolean} `true` when equivalent.
   */
  public equals(other: InvitationBatchRequest): boolean {
    return (
      this.state.role === other.state.role &&
      this.state.emails.length === other.state.emails.length &&
      this.state.emails.every(
        (email: string, index: number): boolean => email === other.state.emails[index],
      )
    );
  }
  // #endregion
}
