import type { AutomationRecipientSnapshot } from '../../../../models/automation/automation-recipient-snapshot.model.js';

/** Reads both membership decisions from one tenant-scoped database snapshot. */
export interface AutomationRecipientReader {
  // #region Methods
  /** Reads the caller and recipient in one statement for the verified organization. */
  read(
    organizationId: string,
    actorUserId: string,
    userId: string,
  ): Promise<AutomationRecipientSnapshot>;
  // #endregion
}
