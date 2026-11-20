import type { SystemTransactionRunner } from '@cadenway/nest-common/database';
import { and, asc, desc, gt, lte } from 'drizzle-orm';

import type { SearchOrganizationPosition } from '../../../../../application/models/search/search-organization-position.model.js';
import type { SearchOrganizationsReader } from '../../../../../application/ports/outbound/persistence/search/search-organizations-reader.port.js';
import { organizations } from '../../schemas/organizations/organization.schema.js';

/** Reads just the indexed organization IDs in a read-only system snapshot. */
export class DrizzleSearchOrganizationsReader implements SearchOrganizationsReader {
  // #region Constructor
  /** Binds the system runner for the authenticated global export. */
  public constructor(private readonly system: SystemTransactionRunner) {}
  // #endregion

  // #region Methods
  /** Keeps the original inclusive upper bound across pages and reads at most one lookahead row. */
  public read(
    position: SearchOrganizationPosition | null,
    maximum: number,
  ): ReturnType<SearchOrganizationsReader['read']> {
    return this.system.run(
      async ({ db }) => {
        const upperId =
          position?.upperId ??
          (
            await db
              .select({ id: organizations.id })
              .from(organizations)
              .orderBy(desc(organizations.id))
              .limit(1)
          )[0]?.id ??
          null;
        if (upperId === null) {
          return { upperId, items: [] };
        }
        const rows = await db
          .select({ id: organizations.id })
          .from(organizations)
          .where(
            and(
              lte(organizations.id, upperId),
              position === null ? undefined : gt(organizations.id, position.afterId),
            ),
          )
          .orderBy(asc(organizations.id))
          .limit(maximum);
        return { upperId, items: rows.map(({ id }) => id) };
      },
      { readOnly: true, isolationLevel: 'repeatable read' },
    );
  }
  // #endregion
}
