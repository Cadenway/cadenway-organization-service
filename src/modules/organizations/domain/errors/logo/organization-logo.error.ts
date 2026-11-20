import { DomainError } from '../organizations/domain.error.js';

/** Domain refusal for an organization logo operation in the published profile-media contract. */
export class OrganizationLogoError extends DomainError {
  // #region Constructor
  /** Keeps the stable reason for mapping to the contract's problem response. */
  public constructor(
    public readonly reason:
      | 'file-too-large'
      | 'unsupported-type'
      | 'invalid-declaration'
      | 'idempotency-key-reused'
      | 'not-found'
      | 'upload-expired'
      | 'upload-superseded'
      | 'upload-not-ready'
      | 'version-mismatch',
    public readonly version?: number,
  ) {
    super(`Organization logo operation refused: ${reason}.`);
  }
  // #endregion
}
