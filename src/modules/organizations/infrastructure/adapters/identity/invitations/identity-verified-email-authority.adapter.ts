import { GetVerifiedEmailInternalResponse } from '@cadenway/contracts/validators/internal/identity-service';
import { type InternalHttpClient, ProblemException } from '@cadenway/nest-common';
import { assertNoActiveTransaction } from '@cadenway/nest-common/database';

import type { VerifiedEmailAuthority } from '../../../../application/ports/outbound/identity/invitations/verified-email-authority.port.js';
import { EmailAddress } from '../../../../domain/value-objects/email/email-address.value-object.js';

/** Resolves just the actor's current verified email from the service that owns it. */
export class IdentityVerifiedEmailAuthority implements VerifiedEmailAuthority {
  // #region Constructor
  /** Binds the signed Identity client when the authority is configured. */
  public constructor(private readonly identity: InternalHttpClient | null) {}
  // #endregion

  // #region Methods
  /** Reads the verified email from Identity for the current operation. */
  public async find(userId: string): Promise<EmailAddress | null> {
    assertNoActiveTransaction();
    try {
      if (this.identity !== null) {
        const response = await this.identity.fetch(
          `/internal/v1/users/${encodeURIComponent(userId)}/verified-email`,
          {
            claims: {
              organizationId: null,
              actor: { type: 'system', id: 'organization-service' },
              scopes: [],
            },
            headers: { accept: 'application/json, application/problem+json' },
            signal: AbortSignal.timeout(1_000),
            cache: 'no-store',
          },
        );
        const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
        if (
          response.status === 200 &&
          mediaType === 'application/json' &&
          response.headers.get('cache-control')?.trim().toLowerCase() === 'no-store'
        ) {
          const account = GetVerifiedEmailInternalResponse.parse(await response.json());
          return EmailAddress.parse(account.email);
        }
        void response.body?.cancel().catch(() => undefined);
      }
    } catch (error) {
      if (
        error instanceof ProblemException &&
        error.getStatus() === 404 &&
        error.problem.code === 'user.not-found'
      ) {
        return null;
      }
      // A transport or parse failure must never fall back to the projected address.
    }
    throw new ProblemException({ status: 503, code: 'upstream.unavailable' });
  }
  // #endregion
}
