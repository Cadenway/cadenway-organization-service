import { loadConfig, runApplication } from '@cadenway/nest-common';
import { databaseConfigShape, SystemTransactionRunner } from '@cadenway/nest-common/database';
import pg from 'pg';
import { z } from 'zod';

import { DrizzleMembershipExport } from '../../persistence/drizzle/repositories/members/drizzle-membership-export.repository.js';

/** Writes one bounded page to stdout, respecting backpressure from the import spool. */
function write(chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(chunk, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// This one-shot command uses the Organization application role and does not start network servers
// or event workers. The final record is sent only after PostgreSQL has released the snapshot.
await runApplication({ service: 'organization-service' }, async () => {
  const config = loadConfig(z.object(databaseConfigShape));
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    application_name: 'organization-membership-export',
    max: 1,
  });
  try {
    const snapshot = new DrizzleMembershipExport(new SystemTransactionRunner(pool));
    await write(`${JSON.stringify({ kind: 'header', version: 1 })}\n`);
    const count = await snapshot.export((page) =>
      write(
        page.map((membership) => JSON.stringify({ kind: 'membership', ...membership })).join('\n') +
          '\n',
      ),
    );
    await write(`${JSON.stringify({ kind: 'footer', count })}\n`);
  } finally {
    await pool.end();
  }
});
