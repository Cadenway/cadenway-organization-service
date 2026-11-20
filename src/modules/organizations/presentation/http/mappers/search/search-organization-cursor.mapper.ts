import { createHmac, timingSafeEqual } from 'node:crypto';

import { decodeCursor, encodeCursor, ProblemException } from '@cadenway/nest-common';
import { z } from 'zod';

import type { SearchOrganizationPosition } from '../../../../application/models/search/search-organization-position.model.js';
import { unavailableSearchAuthority } from '../../errors/search/search-authority.problem.js';

const cursorScope = 'organization-search-export-v1';
const uuid = z.uuid();

/** Reports a malformed or tampered rebuild position. */
function invalidCursor(): ProblemException {
  return new ProblemException({
    status: 400,
    code: 'request.invalid',
    details: {
      issues: [
        {
          in: 'query',
          path: 'cursor',
          code: 'invalid_cursor',
          message: 'Expected the nextCursor of a previous page of this export.',
        },
      ],
    },
  });
}

/** Signs the export fence and position with the stable deployment key. */
export class SearchOrganizationCursor {
  // #region Properties
  /** Deployment key decoded from its configured base64url form. */
  private readonly key: Buffer | undefined;
  // #endregion

  // #region Constructor
  /** Reads configuration without generating a process-local fallback key. */
  public constructor(secret: string | undefined) {
    this.key = secret === undefined ? undefined : Buffer.from(secret, 'base64url');
  }
  // #endregion

  // #region Methods
  /** Verifies the signature and the ascending UUID bounds before either reaches PostgreSQL. */
  public read(cursor: string | undefined): SearchOrganizationPosition | null {
    const key = this.requireKey();
    if (cursor === undefined) {
      return null;
    }
    if (cursor.length > 2048) {
      throw invalidCursor();
    }
    const [body, signature, extra] = cursor.split('.', 3);
    if (
      body === undefined ||
      signature === undefined ||
      extra !== undefined ||
      !/^[A-Za-z0-9_-]{43}$/u.test(signature) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(this.signature(key, body)))
    ) {
      throw invalidCursor();
    }
    const { sort, id: afterId } = decodeCursor(body, cursorScope);
    const [upperId] = sort;
    if (
      sort.length !== 1 ||
      typeof upperId !== 'string' ||
      !uuid.safeParse(upperId).success ||
      !uuid.safeParse(afterId).success ||
      afterId.toLowerCase() >= upperId.toLowerCase()
    ) {
      throw invalidCursor();
    }
    return { upperId, afterId };
  }

  /** Carries the same scan fence in each continuation. */
  public write(position: SearchOrganizationPosition | null): string | null {
    if (position === null) {
      return null;
    }
    const key = this.requireKey();
    const body = encodeCursor({ sort: [position.upperId], id: position.afterId }, cursorScope);
    return `${body}.${this.signature(key, body)}`;
  }

  /** Refuses the export when the deployment cannot issue stable continuations. */
  private requireKey(): Buffer {
    if (this.key?.length !== 32) {
      throw unavailableSearchAuthority();
    }
    return this.key;
  }

  /** Computes a deterministic signature scoped to the rebuild operation. */
  private signature(key: Buffer, body: string): string {
    return createHmac('sha256', key)
      .update(cursorScope)
      .update('.')
      .update(body)
      .digest('base64url');
  }
  // #endregion
}
