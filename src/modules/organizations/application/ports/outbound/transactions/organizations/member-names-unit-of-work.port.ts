import type { MemberNamesReader } from '../../persistence/members/member-names-reader.port.js';

/** Opens a read-only, repeatable-read tenant transaction for a member-name lookup. */
export interface MemberNamesUnitOfWork {
  // #region Methods
  /** Executes both the actor check and name lookup in the same snapshot. */
  read<TResult>(work: (reader: MemberNamesReader) => Promise<TResult>): Promise<TResult>;
  // #endregion
}
