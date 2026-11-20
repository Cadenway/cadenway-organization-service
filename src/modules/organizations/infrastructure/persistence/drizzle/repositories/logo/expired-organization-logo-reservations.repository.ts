import type { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { sql } from 'drizzle-orm';

import type { AbandonOrganizationLogoUploadInput } from '../../../../../application/use-cases/commands/logo/abandon-organization-logo-upload/abandon-organization-logo-upload.input.js';
import { organizationLogoReservations } from '../../schemas/logo/organization-logo-reservation.schema.js';

/** Reads a bounded set of due reservation identities before per-tenant cleanup transactions. */
export class ExpiredOrganizationLogoReservations {
  // #region Constructor
  /** Binds the read-only scan to the system runner because it spans organizations. */
  public constructor(private readonly system: SystemTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Lists the first 100 expired pending reservations in partial index order. */
  public list(): Promise<readonly AbandonOrganizationLogoUploadInput[]> {
    const reservation = organizationLogoReservations;
    return this.system.run(
      async ({ db }) =>
        db
          .select({
            organizationId: reservation.organizationId,
            uploaderUserId: reservation.uploaderUserId,
            uploadId: reservation.uploadId,
          })
          .from(reservation)
          .where(
            sql`${reservation.state} = 'pending' and ${reservation.expiresAt} <= statement_timestamp()`,
          )
          .orderBy(reservation.expiresAt, reservation.organizationId, reservation.uploadId)
          .limit(100),
      { readOnly: true },
    );
  }
  // #endregion
}
