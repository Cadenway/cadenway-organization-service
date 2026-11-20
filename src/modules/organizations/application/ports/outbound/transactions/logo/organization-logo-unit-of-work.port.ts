import type { OrganizationLogoStore } from '../../../../models/logo/organization-logo-store.model.js';

/** Owns request and trusted cleanup transactions without exposing a database client. */
export interface OrganizationLogoUnitOfWork {
  // #region Methods
  /** Uses the verified request organization with the shared tenant transaction runner. */
  run<TResult>(work: (store: OrganizationLogoStore) => Promise<TResult>): Promise<TResult>;

  /** Processes a stored reservation identity in its own tenant transaction. */
  runForCleanup<TResult>(
    organizationId: string,
    work: (store: OrganizationLogoStore) => Promise<TResult>,
  ): Promise<TResult>;
  // #endregion
}
