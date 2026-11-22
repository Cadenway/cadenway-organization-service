import type { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';

/** The account's current verified address, resolved by identity-service. */
export interface VerifiedEmailAuthority {
  // #region Methods
  /** Returns null for an unknown or unverified account, and rejects on authority failure. */
  find(userId: string): Promise<EmailAddress | null>;
  // #endregion
}
