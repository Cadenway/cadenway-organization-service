import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvitationBatchReplayPurgeCutShortError } from '../../../../../application/models/invitations/invitation-batch-replay-purge-cut-short.model.js';
import type { DiscardableSystemTransactions } from '../../transactions/invitations/discardable-system.transaction.js';
import { ExpiredInvitationBatchReplays } from './expired-invitation-batch-replays.repository.js';

/** The steps the runner reports, as `DiscardableSystemTransactions` does. */
type Phase = 'setup' | 'work' | 'commit' | 'rollback';

/**
 * Builds the error of a call cut short, as the composition gives it.
 *
 * @param phase - The phase it stood in.
 * @param trigger - What cut it short.
 * @returns The error.
 */
function cutShort(
  phase: InvitationBatchReplayPurgeCutShortError['phase'],
  trigger: InvitationBatchReplayPurgeCutShortError['trigger'],
): InvitationBatchReplayPurgeCutShortError {
  return new InvitationBatchReplayPurgeCutShortError(phase, trigger);
}

/**
 * Asserts that a purge rejects as cut short in `phase` by `trigger`.
 *
 * @param purge - The purge.
 * @param phase - The phase it stood in.
 * @param trigger - What cut it short.
 * @returns Resolves once checked.
 */
async function cutShortIn(
  purge: Promise<number | null>,
  phase: InvitationBatchReplayPurgeCutShortError['phase'],
  trigger: InvitationBatchReplayPurgeCutShortError['trigger'] = 'deadline',
): Promise<void> {
  const error: unknown = await purge.then(
    () => undefined,
    (rejected: unknown) => rejected,
  );
  expect(error).toBeInstanceOf(InvitationBatchReplayPurgeCutShortError);
  expect(error).toMatchObject({ phase, trigger });
}

/**
 * A runner whose first transaction is stuck at the socket level: its `stuckOn` statement never
 * answers until the call discards its connection, which then rejects it, as pg does once it
 * destroys the socket. Later transactions answer at once.
 *
 * @param stuckOn - The statement that stalls: the setting of the timeouts or the delete.
 * @returns The repository, the runner and the discards it received.
 */
function stuckSocket(stuckOn: 'setting' | 'delete') {
  const dialect: PgDialect = new PgDialect();
  const discards: AbortSignal[] = [];
  const run = vi.fn(
    async <TResult>(
      work: (scope: {
        readonly db: { readonly execute: (statement: SQL) => Promise<unknown> };
      }) => Promise<TResult>,
      _options: unknown,
      discard: AbortSignal,
      onPhase: (phase: Phase) => void,
    ): Promise<TResult> => {
      discards.push(discard);
      const stuck: boolean = run.mock.calls.length === 1;
      const execute = (statement: SQL): Promise<unknown> => {
        const setting: boolean = dialect.sqlToQuery(statement).sql.includes('statement_timeout');
        if (stuck && setting === (stuckOn === 'setting')) {
          return new Promise((_resolve, reject) => {
            discard.addEventListener('abort', () => {
              reject(new Error('Connection terminated'));
            });
          });
        }
        return Promise.resolve({ rowCount: 3, rows: [{ age: 7 }] });
      };
      onPhase('setup');
      onPhase('work');
      return work({ db: { execute } });
    },
  );
  const replays = new ExpiredInvitationBatchReplays(
    {
      run,
    } as unknown as DiscardableSystemTransactions,
    cutShort,
  );
  return { replays, run, discards };
}

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
      _options: unknown,
      _discard: AbortSignal,
      onPhase: (phase: Phase) => void,
    ): Promise<TResult> => {
      await Promise.resolve();
      clock.now += checkoutMs;
      onPhase('setup');
      onPhase('work');
      return work({ db: { execute } });
    },
  } as unknown as DiscardableSystemTransactions;
  const replays = new ExpiredInvitationBatchReplays(system, cutShort, () => clock.now);
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
      _options: unknown,
      _discard: AbortSignal,
      onPhase: (phase: Phase) => void,
    ): Promise<TResult> => {
      await new Promise<void>((resolve) => {
        pool.handOver = resolve;
      });
      try {
        onPhase('setup');
        onPhase('work');
        return await work({ db: { execute } });
      } finally {
        pool.released += 1;
      }
    },
  } as unknown as DiscardableSystemTransactions;
  return { replays: new ExpiredInvitationBatchReplays(system, cutShort), execute, pool };
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
      _options: unknown,
      _discard: AbortSignal,
      onPhase: (phase: Phase) => void,
    ): Promise<TResult> => {
      onPhase('setup');
      onPhase('work');
      return work({ db: { execute } });
    },
  } as unknown as DiscardableSystemTransactions;
  return { replays: new ExpiredInvitationBatchReplays(system, cutShort, () => clock.now), others };
}

describe('ExpiredInvitationBatchReplays', () => {
  const signal: AbortSignal = new AbortController().signal;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails a delete whose setup outlasts the deadline, without running it, and a read answers null', async () => {
    const { replays, others } = slowSetting((clock) => {
      clock.now += 2_000;
    });

    await cutShortIn(replays.purge(500, { deadline: 1_000, signal }), 'setup');
    await expect(replays.oldestExpiredAgeSeconds({ deadline: 1_000, signal })).resolves.toBeNull();
    expect(others).not.toHaveBeenCalled();
  });

  it('fails a delete whose job is aborted during its setup, without running it', async () => {
    const job = new AbortController();
    const { replays, others } = slowSetting(() => {
      job.abort();
    });

    await cutShortIn(
      replays.purge(500, { deadline: 60_000, signal: job.signal }),
      'setup',
      'abort',
    );
    expect(others).not.toHaveBeenCalled();
  });

  it('fails a call stuck in its setup, discards its connection, and the next call runs at once', async () => {
    vi.useFakeTimers();
    const { replays, run, discards } = stuckSocket('setting');

    const abandoned = cutShortIn(
      replays.purge(500, { deadline: performance.now() + 200, signal }),
      'setup',
    );
    await vi.advanceTimersByTimeAsync(200);

    await abandoned;
    expect(discards[0]?.aborted).toBe(true);
    expect(replays.stalled).toBe(false);
    await expect(replays.purge(500, { deadline: performance.now() + 5_000, signal })).resolves.toBe(
      3,
    );
    expect(run).toHaveBeenCalledTimes(2);
    expect(discards[1]?.aborted).toBe(false);
  });

  it('fails a delete stuck past its deadline, discarding its connection, and lets the next call delete', async () => {
    vi.useFakeTimers();
    const { replays, discards } = stuckSocket('delete');

    const failed = cutShortIn(
      replays.purge(500, { deadline: performance.now() + 300, signal }),
      'delete',
    );
    await vi.advanceTimersByTimeAsync(300);

    await failed;
    expect(discards[0]?.aborted).toBe(true);
    expect(replays.stalled).toBe(false);
    await expect(
      replays.oldestExpiredAgeSeconds({ deadline: performance.now() + 5_000, signal }),
    ).resolves.toBe(7);
    await expect(replays.purge(500, { deadline: performance.now() + 5_000, signal })).resolves.toBe(
      3,
    );
  });

  it('discards the connection when the job is aborted while a statement is stuck', async () => {
    const { replays, discards } = stuckSocket('setting');
    const job = new AbortController();

    const abandoned = cutShortIn(
      replays.purge(500, { deadline: performance.now() + 60_000, signal: job.signal }),
      'setup',
      'abort',
    );
    await Promise.resolve();
    job.abort();

    await abandoned;
    expect(discards[0]?.aborted).toBe(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(replays.stalled).toBe(false);
  });

  it('checks out no connection while a call it gave up on has not settled, and again once it ends', async () => {
    vi.useFakeTimers();
    const execute = vi.fn(() => Promise.resolve({ rowCount: 3, rows: [{ age: 7 }] }));
    const stuck = { release: (): void => undefined };
    const run = vi.fn(
      async <TResult>(
        work: (scope: { readonly db: { readonly execute: typeof execute } }) => Promise<TResult>,
      ): Promise<TResult> => {
        if (run.mock.calls.length === 1) {
          // A call that ignores its discard (still waiting for a pooled connection, say): the
          // first call never ends until the test lets it.
          await new Promise<void>((resolve) => {
            stuck.release = resolve;
          });
        }
        return work({ db: { execute } });
      },
    );
    const replays = new ExpiredInvitationBatchReplays(
      {
        run,
      } as unknown as DiscardableSystemTransactions,
      cutShort,
    );

    const abandoned = cutShortIn(
      replays.purge(500, { deadline: performance.now() + 200, signal }),
      'checkout',
    );
    await vi.advanceTimersByTimeAsync(200);
    await abandoned;
    expect(replays.stalled).toBe(true);

    // A later call waits for it, up to its own deadline, and checks nothing out meanwhile.
    const waiting = replays.purge(500, { deadline: performance.now() + 5_000, signal });
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(waiting).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(1);

    const read = replays.oldestExpiredAgeSeconds({ deadline: performance.now() + 5_000, signal });
    await vi.advanceTimersByTimeAsync(100);
    stuck.release();
    await vi.advanceTimersByTimeAsync(0);
    // Once it settled, the read waiting for it runs.
    await expect(read).resolves.toBe(7);
    expect(replays.stalled).toBe(false);
    await expect(replays.purge(500, { deadline: performance.now() + 5_000, signal })).resolves.toBe(
      3,
    );
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('fails by its deadline while the pool has no connection, and gives a late one back unused', async () => {
    vi.useFakeTimers();
    const { replays, execute, pool } = saturatedPool();
    const started: number = performance.now();
    let answeredAt: number | undefined;

    const purge: Promise<void> = cutShortIn(
      replays.purge(500, { deadline: started + 200, signal }).finally(() => {
        answeredAt = performance.now();
      }),
      'checkout',
    );
    await vi.advanceTimersByTimeAsync(200);

    await purge;
    expect((answeredAt ?? Number.POSITIVE_INFINITY) - started).toBeLessThanOrEqual(210);
    pool.handOver();
    await vi.advanceTimersByTimeAsync(0);
    expect(execute).not.toHaveBeenCalled();
    expect(pool.released).toBe(1);
  });

  it('fails by its deadline when the setting stalls, and runs nothing after it', async () => {
    vi.useFakeTimers();
    const stalled = { finish: (): void => undefined };
    const dialect: PgDialect = new PgDialect();
    const statements: string[] = [];
    const execute = vi.fn((statement: SQL) => {
      const text: string = dialect.sqlToQuery(statement).sql;
      statements.push(text);
      return text.includes('statement_timeout')
        ? new Promise((resolve) => {
            stalled.finish = (): void => {
              resolve({ rowCount: 0, rows: [] });
            };
          })
        : Promise.resolve({ rowCount: 42, rows: [] });
    });
    const system = {
      run: <TResult>(
        work: (scope: { readonly db: { readonly execute: typeof execute } }) => Promise<TResult>,
        _options: unknown,
        _discard: AbortSignal,
        onPhase: (phase: Phase) => void,
      ): Promise<TResult> => {
        onPhase('setup');
        onPhase('work');
        return work({ db: { execute } });
      },
    } as unknown as DiscardableSystemTransactions;
    const replays = new ExpiredInvitationBatchReplays(system, cutShort);
    const started: number = performance.now();

    const purge: Promise<void> = cutShortIn(
      replays.purge(500, { deadline: started + 300, signal }),
      'setup',
    );
    await vi.advanceTimersByTimeAsync(300);
    await purge;
    expect(performance.now() - started).toBeLessThanOrEqual(310);

    stalled.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('idle_in_transaction_session_timeout');
  });

  /**
   * A runner whose commit waits until the test lets it go.
   *
   * @returns The repository, the statements and the commit.
   */
  function stalledCommit() {
    const commit = { finish: (): void => undefined };
    const execute = vi.fn(() => Promise.resolve({ rowCount: 42, rows: [{ age: 7 }] }));
    const system = {
      run: async <TResult>(
        work: (scope: { readonly db: { readonly execute: typeof execute } }) => Promise<TResult>,
        _options: unknown,
        _discard: AbortSignal,
        onPhase: (phase: Phase) => void,
      ): Promise<TResult> => {
        onPhase('setup');
        onPhase('work');
        const result: TResult = await work({ db: { execute } });
        onPhase('commit');
        await new Promise<void>((resolve) => {
          commit.finish = resolve;
        });
        return result;
      },
    } as unknown as DiscardableSystemTransactions;
    return { replays: new ExpiredInvitationBatchReplays(system, cutShort), execute, commit };
  }

  it('fails the purge by its deadline when its commit stalls, without waiting', async () => {
    vi.useFakeTimers();
    const { replays, execute, commit } = stalledCommit();
    const started: number = performance.now();

    const failed = cutShortIn(replays.purge(500, { deadline: started + 300, signal }), 'commit');
    await vi.advanceTimersByTimeAsync(300);

    await failed;
    expect(performance.now() - started).toBeLessThanOrEqual(310);
    expect(execute).toHaveBeenCalledTimes(2);
    commit.finish();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('answers null by its deadline when a backlog read is cut short, a read failing nothing', async () => {
    vi.useFakeTimers();
    const { replays, commit } = stalledCommit();
    const started: number = performance.now();

    const read: Promise<number | null> = replays.oldestExpiredAgeSeconds({
      deadline: started + 300,
      signal,
    });
    await vi.advanceTimersByTimeAsync(300);

    await expect(read).resolves.toBeNull();
    commit.finish();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('answers at once when the job is aborted during the checkout of a backlog read', async () => {
    const { replays, execute, pool } = saturatedPool();
    const job = new AbortController();

    const read: Promise<number | null> = replays.oldestExpiredAgeSeconds({
      deadline: performance.now() + 60_000,
      signal: job.signal,
    });
    job.abort();

    await expect(read).resolves.toBeNull();
    pool.handOver();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(execute).not.toHaveBeenCalled();
    expect(pool.released).toBe(1);
  });

  it('fails a delete once the wait for a connection used the time left, without running it', async () => {
    const { replays, execute } = slowCheckout(3_000);

    await cutShortIn(replays.purge(500, { deadline: 2_000, signal }), 'setup');
    await expect(replays.oldestExpiredAgeSeconds({ deadline: 2_000, signal })).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('starts nothing for an aborted job or a passed deadline, the normal end of a tick', async () => {
    const { replays, execute } = slowCheckout(0);
    const aborted = new AbortController();
    aborted.abort();

    await expect(
      replays.purge(500, { deadline: 5_000, signal: aborted.signal }),
    ).resolves.toBeNull();
    await expect(replays.purge(500, { deadline: 0, signal })).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('caps the statements on the server at the time left after the checkout, plus its grace', async () => {
    const { replays, execute } = slowCheckout(1_250);

    await expect(replays.purge(500, { deadline: 5_000, signal })).resolves.toBe(42);
    await expect(replays.oldestExpiredAgeSeconds({ deadline: 5_000, signal })).resolves.toBe(7);

    expect(execute).toHaveBeenCalledTimes(4);
    const dialect: PgDialect = new PgDialect();
    const timeouts: unknown[] = execute.mock.calls
      .map((call: unknown[]) => dialect.sqlToQuery(call[0] as SQL))
      .filter((query) => query.sql.includes('statement_timeout'))
      .map((query) => query.params[0]);
    expect(timeouts).toEqual(['4750ms', '3500ms']);
  });
});
