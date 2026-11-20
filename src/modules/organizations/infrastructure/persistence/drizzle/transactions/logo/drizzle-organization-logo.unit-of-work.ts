import { runWithOrganizationContext } from '@cadenway/nest-common';
import type { TenantTransactionRunner } from '@cadenway/nest-common/database';
import type { OutboxRelay, OutboxWriter } from '@cadenway/nest-messaging/outbox';

import type { OrganizationLogoStore } from '../../../../../application/models/logo/organization-logo-store.model.js';
import type { OrganizationLogoUnitOfWork } from '../../../../../application/ports/outbound/transactions/logo/organization-logo-unit-of-work.port.js';
import { OutboxOrganizationLogoEvents } from '../../../../messaging/outbox/logo/outbox-organization-logo-events.adapter.js';
import { DrizzleOrganizationLogoRepository } from '../../repositories/logo/drizzle-organization-logo.repository.js';

/** Binds the owner repository and outbox to the same tenant scope. */
export class DrizzleOrganizationLogoUnitOfWork implements OrganizationLogoUnitOfWork {
  // #region Constructor
  /** Uses the shared tenant transaction runner and committed outbox relay. */
  public constructor(
    private readonly tenant: TenantTransactionRunner,
    private readonly outbox: OutboxWriter,
    private readonly relay: OutboxRelay,
  ) {}
  // #endregion

  // #region Methods
  /** Runs one operation in the verified tenant and wakes the relay after commit. */
  public async run<TResult>(
    work: (store: OrganizationLogoStore) => Promise<TResult>,
  ): Promise<TResult> {
    const { result, appended } = await this.tenant.run(async (scope) => {
      if (scope.organizationId === null) throw new Error('An organization is required.');
      const repository = new DrizzleOrganizationLogoRepository(scope.db, scope.organizationId);
      let appended = false;
      const outbox = new OutboxOrganizationLogoEvents(scope, this.outbox, () => {
        appended = true;
      });
      const result = await work({
        lockMember: repository.lockMember.bind(repository),
        lockLogo: repository.lockLogo.bind(repository),
        findByKey: repository.findByKey.bind(repository),
        lockReservation: repository.lockReservation.bind(repository),
        newUploadId: repository.newUploadId.bind(repository),
        insertReservation: repository.insertReservation.bind(repository),
        saveReservation: repository.saveReservation.bind(repository),
        saveLogo: repository.saveLogo.bind(repository),
        appendLogoChanged: outbox.appendLogoChanged.bind(outbox),
        appendUploadAbandoned: outbox.appendUploadAbandoned.bind(outbox),
      });
      return { result, appended };
    });
    if (appended) this.relay.wake();
    return result;
  }

  /** Enters one tenant selected by the trusted system expiry scan. */
  public runForCleanup<TResult>(
    organizationId: string,
    work: (store: OrganizationLogoStore) => Promise<TResult>,
  ): Promise<TResult> {
    return runWithOrganizationContext(
      {
        organizationId,
        actor: { type: 'system', id: 'organization-service' },
        role: null,
        scopes: [],
      },
      () => this.run(work),
    );
  }
  // #endregion
}
