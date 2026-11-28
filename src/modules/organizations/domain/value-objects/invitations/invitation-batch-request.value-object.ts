import type { EmailAddress } from '../email/email-address.value-object.js';
import type { AssignableRole } from '../members/assignable-role.value-object.js';

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
   * Property canonical
   *
   * @description
   * The canonical form of the batch, one string per equivalence class: the role, then the distinct
   * addresses, trimmed and lowercased, in order, as a JSON array. Persistence keeps a digest of it,
   * never the string itself.
   *
   * @type {string}
   * @readonly
   */
  public readonly canonical: string;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps the canonical form.
   *
   * @param {string} canonical - The canonical form.
   * @constructor
   */
  private constructor(canonical: string) {
    this.canonical = canonical;
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
    return new InvitationBatchRequest(
      JSON.stringify([role, ...addresses.map((address: EmailAddress): string => address.value)]),
    );
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
    return this.canonical === other.canonical;
  }
  // #endregion
}
