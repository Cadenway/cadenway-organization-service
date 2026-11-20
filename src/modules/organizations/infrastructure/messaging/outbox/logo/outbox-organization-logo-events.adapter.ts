import { eventSchemas } from '@cadenway/contracts/events/organization-service';
import type { TransactionScope } from '@cadenway/nest-common/database';
import type { OutboxWriter } from '@cadenway/nest-messaging/outbox';

import type { OrganizationLogoChanged } from '../../../../domain/events/logo/organization-logo-changed.event.js';
import type { OrganizationLogoUploadAbandoned } from '../../../../domain/events/logo/organization-logo-upload-abandoned.event.js';

/** Records owner decisions in the same transaction as the reference or reservation. */
export class OutboxOrganizationLogoEvents {
  // #region Constructor
  /** Binds event writes and the relay wake marker to one owner transaction. */
  public constructor(
    private readonly transaction: TransactionScope,
    private readonly outbox: OutboxWriter,
    private readonly onAppend: () => void,
  ) {}
  // #endregion

  // #region Methods
  /** Appends only the generation and opaque references Storage needs to reconcile assets. */
  public async appendLogoChanged(event: OrganizationLogoChanged): Promise<void> {
    await this.outbox.append(this.transaction, eventSchemas, 'organization.logo-changed.v1', {
      organizationId: this.organizationOf(event.organizationId),
      actor: { type: 'user', id: event.actorUserId },
      version: event.generation,
      assetId: event.assetId,
      oldAssetId: event.oldAssetId,
    });
    this.onAppend();
  }

  /** Appends the terminal disposition of an unused reservation. */
  public async appendUploadAbandoned(event: OrganizationLogoUploadAbandoned): Promise<void> {
    await this.outbox.append(
      this.transaction,
      eventSchemas,
      'organization.logo-upload-abandoned.v1',
      {
        organizationId: this.organizationOf(event.organizationId),
        actor: { type: 'system', id: 'organization-service' },
        version: 1,
        uploadId: event.uploadId,
      },
    );
    this.onAppend();
  }

  private organizationOf(eventOrganizationId: string): string {
    const { kind, organizationId } = this.transaction;
    if (kind !== 'tenant' || organizationId?.toLowerCase() !== eventOrganizationId.toLowerCase()) {
      throw new Error('The logo event does not match its tenant transaction.');
    }
    return organizationId;
  }
  // #endregion
}
