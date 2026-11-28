import { runWithOrganizationContext } from '@cadenway/nest-common';
import type {
  SystemTransactionRunner,
  TenantTransactionRunner,
  TransactionOptions,
  TransactionScope,
} from '@cadenway/nest-common/database';
import type { OutboxRelay, OutboxWriter } from '@cadenway/nest-messaging/outbox';

import type { OrganizationsStore } from '../../../../../application/models/transactions/organizations-store.model.js';
import type { UnitOfWorkOptions } from '../../../../../application/models/transactions/unit-of-work-options.model.js';
import type { OrganizationsUnitOfWork } from '../../../../../application/ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import { OutboxOrganizationEvents } from '../../../../messaging/outbox/organizations/outbox-organization-events.adapter.js';
import { DrizzleSeatEntitlementRepository } from '../../repositories/billing/drizzle-seat-entitlement.repository.js';
import { DrizzleDirectoryRepository } from '../../repositories/directory/drizzle-directory.repository.js';
import { DrizzleInvitationBatchReplayRepository } from '../../repositories/invitations/drizzle-invitation-batch-replay.repository.js';
import { DrizzleInvitationEmailRepository } from '../../repositories/invitations/drizzle-invitation-email.repository.js';
import { DrizzleInvitationRepository } from '../../repositories/invitations/drizzle-invitation.repository.js';
import { DrizzleMemberRepository } from '../../repositories/members/drizzle-member.repository.js';
import { DrizzleOrganizationRepository } from '../../repositories/organizations/drizzle-organization.repository.js';

/**
 * Interface TransactionRunner
 *
 * @description
 * What the tenant and the system runners of the kit share.
 */
interface TransactionRunner {
  // #region Methods
  /**
   * Method run
   *
   * @description
   * Runs work in a transaction of the runner, joining a compatible one.
   *
   * @param {(scope: TransactionScope) => Promise<TResult>} work - The work.
   * @param {TransactionOptions} options - How the transaction is opened.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   */
  run<TResult>(
    work: (scope: TransactionScope) => Promise<TResult>,
    options?: TransactionOptions,
  ): Promise<TResult>;
  // #endregion
}

/**
 * Class DrizzleOrganizationsUnitOfWork
 *
 * @description
 * `OrganizationsUnitOfWork` on the transaction runners of `@cadenway/nest-common/database`:
 *
 * - `runInRequestOrganization`: the tenant runner, which sets `app.organization_id` from the
 *   verified context of the request, so row-level security keeps every row of another organization
 *   out of reach;
 * - `runInOrganizationOf`: the tenant runner of the organization of a stored invitation the use
 *   case checked as addressed to the verified address of the actor, the one case of the module where
 *   the organization of the transaction is not the one of the request (the invitee belongs to none
 *   of the invitation yet); the context carries the actor of the request and that organization;
 * - `runAcrossOrganizations`: the system runner, for the bounded exceptions of `MODULE.md`, whose
 *   queries name their rows.
 *
 * Once a run that appended events resolves, the relay is woken so they leave now instead of at its
 * next poll; a run joined to an outer transaction (the deduplicator of a handler) resolves before it
 * commits, and the next poll publishes them.
 */
export class DrizzleOrganizationsUnitOfWork implements OrganizationsUnitOfWork {
  // #region Properties
  /**
   * Property tenant
   *
   * @description
   * The tenant transaction runner of the kit.
   *
   * @type {TenantTransactionRunner}
   * @readonly
   */
  private readonly tenant: TenantTransactionRunner;

  /**
   * Property system
   *
   * @description
   * The system transaction runner of the kit.
   *
   * @type {SystemTransactionRunner}
   * @readonly
   */
  private readonly system: SystemTransactionRunner;

  /**
   * Property outbox
   *
   * @description
   * The outbox writer of the kit.
   *
   * @type {OutboxWriter}
   * @readonly
   */
  private readonly outbox: OutboxWriter;

  /**
   * Property relay
   *
   * @description
   * The outbox relay, woken after a commit that appended events.
   *
   * @type {OutboxRelay}
   * @readonly
   */
  private readonly relay: OutboxRelay;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the runners and the outbox of the kit.
   *
   * @param {TenantTransactionRunner} tenant - The tenant transaction runner.
   * @param {SystemTransactionRunner} system - The system transaction runner.
   * @param {OutboxWriter} outbox - The outbox writer.
   * @param {OutboxRelay} relay - The outbox relay.
   * @constructor
   */
  public constructor(
    tenant: TenantTransactionRunner,
    system: SystemTransactionRunner,
    outbox: OutboxWriter,
    relay: OutboxRelay,
  ) {
    this.tenant = tenant;
    this.system = system;
    this.outbox = outbox;
    this.relay = relay;
  }
  // #endregion

  // #region Methods
  /**
   * Method runInRequestOrganization
   *
   * @description
   * Runs `work` in the tenant transaction of the organization of the request.
   *
   * @param {(store: OrganizationsStore) => Promise<TResult>} work - The unit of work.
   * @param {UnitOfWorkOptions} options - How the transaction is opened.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   */
  public runInRequestOrganization<TResult>(
    work: (store: OrganizationsStore) => Promise<TResult>,
    options: UnitOfWorkOptions = {},
  ): Promise<TResult> {
    return this.runWith(this.tenant, work, options);
  }

  /**
   * Method runInOrganizationOf
   *
   * @description
   * Runs `work` in the tenant transaction of the organization of a stored invitation, for the
   * actor of the request.
   *
   * @param {Invitation} invitation - The stored invitation.
   * @param {string} actorUserId - The verified actor of the request.
   * @param {(store: OrganizationsStore) => Promise<TResult>} work - The unit of work.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   */
  public runInOrganizationOf<TResult>(
    invitation: Invitation,
    actorUserId: string,
    work: (store: OrganizationsStore) => Promise<TResult>,
  ): Promise<TResult> {
    return runWithOrganizationContext(
      {
        organizationId: invitation.snapshot.organizationId,
        actor: { type: 'user', id: actorUserId },
        role: null,
        scopes: [],
      },
      (): Promise<TResult> => this.runWith(this.tenant, work, {}),
    );
  }

  /**
   * Method runAcrossOrganizations
   *
   * @description
   * Runs `work` in a system transaction, joining the current one when called inside it.
   *
   * @param {(store: OrganizationsStore) => Promise<TResult>} work - The unit of work.
   * @param {UnitOfWorkOptions} options - How the transaction is opened.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   */
  public runAcrossOrganizations<TResult>(
    work: (store: OrganizationsStore) => Promise<TResult>,
    options: UnitOfWorkOptions = {},
  ): Promise<TResult> {
    return this.runWith(this.system, work, options);
  }

  /**
   * Method runWith
   *
   * @description
   * Runs `work` with the store of one transaction of a runner, then wakes the relay when the work
   * appended events.
   *
   * @param {TransactionRunner} runner - The runner.
   * @param {(store: OrganizationsStore) => Promise<TResult>} work - The unit of work.
   * @param {UnitOfWorkOptions} options - How the transaction is opened.
   * @returns {Promise<TResult>} What the work resolved with, once committed.
   */
  private async runWith<TResult>(
    runner: TransactionRunner,
    work: (store: OrganizationsStore) => Promise<TResult>,
    options: UnitOfWorkOptions,
  ): Promise<TResult> {
    const appends: { count: number } = { count: 0 };
    const result: TResult = await runner.run(
      (transaction: TransactionScope): Promise<TResult> =>
        work({
          organizations: new DrizzleOrganizationRepository(transaction.db),
          members: new DrizzleMemberRepository(transaction.db),
          seatEntitlements: new DrizzleSeatEntitlementRepository(transaction.db),
          invitations: new DrizzleInvitationRepository(transaction.db),
          invitationEmails: new DrizzleInvitationEmailRepository(transaction.db),
          invitationBatchReplays: new DrizzleInvitationBatchReplayRepository(transaction.db),
          directory: new DrizzleDirectoryRepository(transaction.db),
          events: new OutboxOrganizationEvents(transaction, this.outbox, (): void => {
            appends.count += 1;
          }),
        }),
      options,
    );
    if (appends.count > 0) {
      this.relay.wake();
    }
    return result;
  }
  // #endregion
}
