import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';

import type { ReserveAccountDeletionOutput } from './reserve-account-deletion.output.js';

const maximumOwnershipProofs = 100;

/** Reserves an attempt against the same locked directory entry used by membership grants. */
export class ReserveAccountDeletion {
  // #region Constructor
  /** Binds the Organization-owned directory and membership transactions. */
  public constructor(private readonly work: OrganizationsUnitOfWork) {}
  // #endregion

  // #region Methods
  /** Confirms one stable attempt only if Organization currently verifies that the account owns none. */
  public execute(userId: string, attemptId: string): Promise<ReserveAccountDeletionOutput> {
    return this.work.runAcrossOrganizations(
      async (store): Promise<ReserveAccountDeletionOutput> => {
        const user = await store.directory.findForUpdate(userId);
        if (user === null || user.isDeleted) return { status: 'not-found' };

        const previous = await store.directory.findDeletionAttempt(userId);
        if (previous !== null) {
          return { status: previous === attemptId.toLowerCase() ? 'reused' : 'conflict' };
        }

        const organizationIds = await store.members.listOwnedOrganizationIds(
          userId,
          maximumOwnershipProofs,
        );
        if (organizationIds.length > 0) return { status: 'owner', organizationIds };
        await store.directory.reserveDeletion(userId, attemptId);
        return { status: 'created' };
      },
    );
  }
  // #endregion
}
