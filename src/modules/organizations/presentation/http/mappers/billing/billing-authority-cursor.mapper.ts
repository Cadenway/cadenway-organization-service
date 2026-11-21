import { createHmac, timingSafeEqual } from 'node:crypto';

import { decodeCursor, encodeCursor, ProblemException } from '@cadenway/nest-common';
import { z } from 'zod';

import { unavailableSearchAuthority } from '../../errors/search/search-authority.problem.js';

type CursorOperation = 'organizations' | 'memberships' | 'recipients';
interface CursorPosition {
  // #region Properties
  /** Exclusive lower ID. */
  readonly afterId: string;

  /** Inclusive upper ID, or null for recipient pagination. */
  readonly upperId: string | null;
  // #endregion
}

function invalidCursor(): ProblemException {
  return new ProblemException({
    status: 400,
    code: 'request.invalid',
    details: {
      issues: [{ in: 'query', path: 'cursor', code: 'invalid_cursor', message: 'Invalid cursor.' }],
    },
  });
}

/** Authenticates Billing and Notification continuation cursors against their operation and tenant. */
export class BillingAuthorityCursor {
  // #region Properties
  /** Deployment key shared by every instance of the service. */
  private readonly key: Buffer | undefined;
  // #endregion

  // #region Constructor
  /** Accepts the configured base64url-encoded 32-byte key. */
  public constructor(secret: string | undefined) {
    this.key = secret === undefined ? undefined : Buffer.from(secret, 'base64url');
  }
  // #endregion

  // #region Methods
  /** Decodes a continuation for exactly one operation and signed organization. */
  public read(
    cursor: string | undefined,
    operation: CursorOperation,
    organizationId: string | null,
  ): CursorPosition | null {
    const key = this.requireKey();
    if (cursor === undefined) return null;
    if (cursor.length < 1 || cursor.length > 1024) throw invalidCursor();
    const [body, signature, extra] = cursor.split('.', 3);
    const scope = this.scope(operation, organizationId);
    if (
      body === undefined ||
      signature === undefined ||
      extra !== undefined ||
      !/^[A-Za-z0-9_-]{43}$/u.test(signature) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(this.signature(key, scope, body)))
    )
      throw invalidCursor();
    const decoded = decodeCursor(body, scope);
    const upperId = decoded.sort[0];
    if (
      !z.uuid().safeParse(decoded.id).success ||
      (operation === 'recipients'
        ? decoded.sort.length !== 0
        : decoded.sort.length !== 1 ||
          typeof upperId !== 'string' ||
          !z.uuid().safeParse(upperId).success ||
          decoded.id.toLowerCase() >= upperId.toLowerCase())
    )
      throw invalidCursor();
    return { afterId: decoded.id, upperId: typeof upperId === 'string' ? upperId : null };
  }

  /** Encodes the last result and, for rebuilds, the immutable upper bound. */
  public write(
    position: CursorPosition | null,
    operation: CursorOperation,
    organizationId: string | null,
  ): string | null {
    if (position === null) return null;
    const scope = this.scope(operation, organizationId);
    const body = encodeCursor(
      { sort: position.upperId === null ? [] : [position.upperId], id: position.afterId },
      scope,
    );
    return `${body}.${this.signature(this.requireKey(), scope, body)}`;
  }

  private requireKey(): Buffer {
    if (this.key?.length !== 32) throw unavailableSearchAuthority();
    return this.key;
  }

  private scope(operation: CursorOperation, organizationId: string | null): string {
    return `organization-billing-${operation}-v1:${organizationId?.toLowerCase() ?? 'global'}`;
  }

  private signature(key: Buffer, scope: string, body: string): string {
    return createHmac('sha256', key).update(scope).update('.').update(body).digest('base64url');
  }
  // #endregion
}
