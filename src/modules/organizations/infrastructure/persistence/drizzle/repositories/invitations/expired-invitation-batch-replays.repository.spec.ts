import type { SystemTransactionRunner } from '@cadenway/nest-common/database';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

/**
 * A saturated pool: a checkout waits until the test hands a connection over, and the runner
 * records when the transaction gives it back.
 *
 * @returns The repository on the real (faked) timers, the statements and the pool.
 */
function saturatedPool() {
  const execute = vi.fn(() => Promise.resolve({ rowCount: 42, rows: [{ age: 7 }] }));
  const pool = { handOver: (): void => undefined, released: 0 };
  const system = {
    run: async <TResult>(
      work: (scope: { readonly db: { readonly execute: typeof execute } }) => Promise<TResult>,
    ): Promise<TResult> => {
      await new Promise<void>((resolve) => {
        pool.handOver = resolve;
      });
      try {
        return await work({ db: { execute } });
      } finally {
        pool.released += 1;
      }
    },
  } as unknown as SystemTransactionRunner;
  return { replays: new ExpiredInvitationBatchReplays(system), execute, pool };
}

/**
 * A runner whose `statement_timeout` setting takes its time on a fake clock, or aborts the job,
 * while the deletes and reads are recorded.
 *
 * @param duringSetting - What happens while the setting runs.
 * @returns The repository and the statements other than the setting.
 */
function slowSetting(duringSetting: (clock: { now: number }) => void) {
  const clock = { now: 0 };
  const dialect: PgDialect = new PgDialect();
  const others = vi.fn();
  const execute = vi.fn((statement: SQL) => {
    if (dialect.sqlToQuery(statement).sql.includes('statement_timeout')) {
      duringSetting(clock);
    } else {
      others(statement);
    }
    return Promise.resolve({ rowCount: 42, rows: [{ age: 7 }] });
  });
  const system = {
    run: <TResult>(
      work: (scope: { readonly db: { readonly execute: typeof execute } }) => Promise<TResult>,
    ): Promise<TResult> => work({ db: { execute } }),
  } as unknown as SystemTransactionRunner;
  return { replays: new ExpiredInvitationBatchReplays(system, () => clock.now), others };
}

describe('ExpiredInvitationBatchReplays', () => {
  const signal: AbortSignal = new AbortController().signal;

  it('runs no delete when the deadline passes while the statement timeout is being set', async () => {
    const { replays, others } = slowSetting((clock) => {
      clock.now += 2_000;
    });

    await expect(replays.purge(500, { deadline: 1_000, signal })).resolves.toBeNull();
    await expect(replays.oldestExpiredAgeSeconds({ deadline: 1_000, signal })).resolves.toBeNull();
    expect(others).not.toHaveBeenCalled();
  });

  it('runs no delete when the job is aborted while the statement timeout is being set', async () => {
    const job = new AbortController();
    const { replays, others } = slowSetting(() => {
      job.abort();
    });

    await expect(replays.purge(500, { deadline: 60_000, signal: job.signal })).resolves.toBeNull();
    expect(others).not.toHaveBeenCalled();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers by its deadline while the pool has no connection, and gives a late one back unused', async () => {
    vi.useFakeTimers();
    const { replays, execute, pool } = saturatedPool();
    const started: number = Date.now();
    let answeredAt: number | undefined;

    const purge: Promise<number | null> = replays
      .purge(500, { deadline: started + 200, signal })
      .finally(() => {
        answeredAt = Date.now();
      });
    await vi.advanceTimersByTimeAsync(200);

    await expect(purge).resolves.toBeNull();
    expect((answeredAt ?? Number.POSITIVE_INFINITY) - started).toBeLessThanOrEqual(210);
    pool.handOver();
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).not.toHaveBeenCalled();
    expect(pool.released).toBe(1);
  });

  it('answers at once when the job is aborted during the checkout, for the backlog read too', async () => {
    const { replays, execute, pool } = saturatedPool();
    const job = new AbortController();

    const read: Promise<number | null> = replays.oldestExpiredAgeSeconds({
      deadline: Date.now() + 60_000,
      signal: job.signal,
    });
    job.abort();

    await expect(read).resolves.toBeNull();
    pool.handOver();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(execute).not.toHaveBeenCalled();
    expect(pool.released).toBe(1);
  });

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
