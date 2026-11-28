import type { SystemTransactionRunner } from '@cadenway/nest-common/database';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { ExpiredInvitationBatchReplays } from './expired-invitation-batch-replays.repository.js';

/**
 * A system runner whose connection checkout takes `checkoutMs` on a fake clock, with a database
 * that records its statements.
 *
 * @param checkoutMs - How long the checkout waits.
 * @returns The runner, the recorded statements and the clock.
 */
function slowCheckout(checkoutMs: number) {
  const clock = { now: 0 };
  const execute = vi.fn(() => Promise.resolve({ rowCount: 42, rows: [{ age: 7 }] }));
  const system = {
    run: async <TResult>(
      work: (scope: { readonly db: { readonly execute: typeof execute } }) => Promise<TResult>,
    ): Promise<TResult> => {
      await Promise.resolve();
      clock.now += checkoutMs;
      return work({ db: { execute } });
    },
  } as unknown as SystemTransactionRunner;
  const replays = new ExpiredInvitationBatchReplays(system, () => clock.now);
  return { replays, execute };
}

describe('ExpiredInvitationBatchReplays', () => {
  const signal: AbortSignal = new AbortController().signal;

  it('runs nothing once the wait for a connection used the time left', async () => {
    const { replays, execute } = slowCheckout(3_000);

    await expect(replays.purge(500, { deadline: 2_000, signal })).resolves.toBeNull();
    await expect(replays.oldestExpiredAgeSeconds({ deadline: 2_000, signal })).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs nothing for an aborted job, whatever the time left', async () => {
    const { replays, execute } = slowCheckout(0);
    const aborted = new AbortController();
    aborted.abort();

    await expect(
      replays.purge(500, { deadline: 5_000, signal: aborted.signal }),
    ).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('caps the statements at the time left after the checkout', async () => {
    const { replays, execute } = slowCheckout(1_250);

    await expect(replays.purge(500, { deadline: 5_000, signal })).resolves.toBe(42);
    await expect(replays.oldestExpiredAgeSeconds({ deadline: 5_000, signal })).resolves.toBe(7);

    expect(execute).toHaveBeenCalledTimes(4);
    const dialect: PgDialect = new PgDialect();
    const timeouts: unknown[] = execute.mock.calls
      .map((call: unknown[]) => dialect.sqlToQuery(call[0] as SQL))
      .filter((query) => query.sql.includes('statement_timeout'))
      .map((query) => query.params[0]);
    expect(timeouts).toEqual(['3750ms', '2500ms']);
  });
});
