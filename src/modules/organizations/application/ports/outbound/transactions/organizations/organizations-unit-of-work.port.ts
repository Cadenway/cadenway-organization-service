import type { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { UnitOfWorkOptions } from '../../../../models/transactions/unit-of-work-options.model.js';

/**
 * Interface OrganizationsUnitOfWork
 *
 * @description
 * The transactions of the organizations module. A request with an organization runs in the tenant
 * transaction of that organization, under its row-level security. The work that has no
 * organization or crosses organizations runs in a system transaction, and every query of it names
 * the rows it means: these are the bounded exceptions listed in `MODULE.md`.
 */
export interface OrganizationsUnitOfWork {
  // #region Methods
  /**
   * Method runInRequestOrganization
   *
   * @description
   * Runs `work` in the tenant transaction of the organization of the verified request context.
   *
   * @param {(store: OrganizationsStore) => Promise<TResult>} work - The unit of work.
   * @param {UnitOfWorkOptions} options - How the transaction is opened.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   */
  runInRequestOrganization<TResult>(
    work: (store: OrganizationsStore) => Promise<TResult>,
    options?: UnitOfWorkOptions,
  ): Promise<TResult>;

  /**
   * Method runInOrganizationOf
   *
   * @description
   * Runs `work` in the tenant transaction of the organization of a stored invitation, for an actor
   * outside any organization: the invitee answering it, as the contract requires ("in the tenant
   * transaction of that organization"). It takes the invitation itself, never an id a request could
   * carry, so no other use case can open a tenant transaction of an organization of its choosing.
   *
   * @param {Invitation} invitation - The stored invitation, already checked as addressed to the actor.
   * @param {string} actorUserId - The verified actor of the request.
   * @param {(store: OrganizationsStore) => Promise<TResult>} work - The unit of work.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   */
  runInOrganizationOf<TResult>(
    invitation: Invitation,
    actorUserId: string,
    work: (store: OrganizationsStore) => Promise<TResult>,
  ): Promise<TResult>;

  /**
   * Method runAcrossOrganizations
   *
   * @description
   * Runs `work` in a system transaction, joining the current one when called inside it: the
   * creation of an organization, the reads across organizations of an actor, and the projection of
   * the user directory.
   *
   * @param {(store: OrganizationsStore) => Promise<TResult>} work - The unit of work.
   * @param {UnitOfWorkOptions} options - How the transaction is opened.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   */
  runAcrossOrganizations<TResult>(
    work: (store: OrganizationsStore) => Promise<TResult>,
    options?: UnitOfWorkOptions,
  ): Promise<TResult>;
  // #endregion
}
