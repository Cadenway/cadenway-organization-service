import type { TenantTransactionRunner } from '@cadenway/nest-common/database';

import type { MemberNamesReader } from '../../../../../application/ports/outbound/persistence/members/member-names-reader.port.js';
import type { MemberNamesUnitOfWork } from '../../../../../application/ports/outbound/transactions/organizations/member-names-unit-of-work.port.js';
import { DrizzleMemberNamesReader } from '../../repositories/members/drizzle-member-names.repository.js';

/** Runs the actor and member-name reads in one consistent tenant snapshot. */
export class DrizzleMemberNamesUnitOfWork implements MemberNamesUnitOfWork {
  // #region Constructor
  /** Binds lookups to the request's organization. */
  public constructor(private readonly tenant: TenantTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Opens a read-only repeatable-read transaction, joining a compatible existing transaction. */
  public read<TResult>(work: (reader: MemberNamesReader) => Promise<TResult>): Promise<TResult> {
    return this.tenant.run(({ db }) => work(new DrizzleMemberNamesReader(db)), {
      isolationLevel: 'repeatable read',
      readOnly: true,
    });
  }
  // #endregion
}
