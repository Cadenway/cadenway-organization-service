/** Media-specific refusal exposed to the presentation boundary. */
export class OrganizationLogoRefusal extends Error {
  // #region Constructor
  /** Keeps the stable refusal reason without leaking domain exceptions. */
  public constructor(
    public readonly reason:
      | 'file-too-large'
      | 'unsupported-type'
      | 'invalid-declaration'
      | 'idempotency-key-reused'
      | 'not-found'
      | 'upload-expired'
      | 'upload-superseded'
      | 'upload-not-ready',
  ) {
    super(`The organization logo request was refused: ${reason}.`);
    this.name = 'OrganizationLogoRefusal';
  }
  // #endregion
}
