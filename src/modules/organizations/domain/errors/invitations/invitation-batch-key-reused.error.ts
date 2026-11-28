import { DomainError } from '../organizations/domain.error.js';

/**
 * Class InvitationBatchKeyReusedError
 *
 * @description
 * An `Idempotency-Key` of an invitation batch sent again with a batch that is not equivalent to
 * the one it first committed (`422 idempotency.key-reused` of `inviteMembers` in
 * `openapi/internal/organization-service.yaml`).
 */
export class InvitationBatchKeyReusedError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the replay.
   *
   * @constructor
   */
  public constructor() {
    super('The idempotency key was already used with a different invitation batch.');
  }
  // #endregion
}
