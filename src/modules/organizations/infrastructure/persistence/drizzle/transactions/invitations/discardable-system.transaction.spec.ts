import { sql } from 'drizzle-orm';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { DiscardableSystemTransactions } from './discardable-system.transaction.js';

/** What the fake connection recorded. */
interface Recorded {
  // #region Properties
  /** The statements, in order. */
  readonly statements: string[];

  /** What each release was given. */
  readonly releases: unknown[];
  // #endregion
}

/**
 * A pool with one connection whose statements answer at once, except `hang`, which waits until the
 * connection is released with an error and then rejects, as pg does when it destroys a socket with
 * a statement in flight.
 *
 * @param hang - The text of the statement that hangs, if any.
 * @returns The pool and what its connection recorded.
 */
function poolWith(hang?: string): { readonly pool: Pool; readonly recorded: Recorded } {
  const recorded: Recorded = { statements: [], releases: [] };
  const destroyed: { reject?: (error: Error) => void } = {};
  const connection = {
    on: vi.fn(),
    removeListener: vi.fn(),
    query: vi.fn((text: string | { readonly text: string }) => {
      const statement: string = typeof text === 'string' ? text : text.text;
      recorded.statements.push(statement);
      if (hang !== undefined && statement.startsWith(hang)) {
        return new Promise((_resolve, reject) => {
          destroyed.reject = reject;
        });
      }
      return Promise.resolve({
        command: statement.toUpperCase(),
        rowCount: 2,
        rows: [],
        fields: [],
      });
    }),
    release: vi.fn((error?: Error | boolean) => {
      recorded.releases.push(error);
      if (error instanceof Error) {
        destroyed.reject?.(new Error('Connection terminated'));
      }
    }),
  };
  const pool = {
    connect: vi.fn(() => Promise.resolve(connection as unknown as PoolClient)),
  } as unknown as Pool;
  return { pool, recorded };
}

describe('DiscardableSystemTransactions', () => {
  it('runs the work in a system transaction, commits it and gives the connection back', async () => {
    const { pool, recorded } = poolWith();
    const transactions = new DiscardableSystemTransactions(pool);

    const deleted: number = await transactions.run(
      async ({ db }) => (await db.execute(sql`delete from invitation_batch_replays`)).rowCount ?? 0,
      { readOnly: true },
      new AbortController().signal,
    );

    expect(deleted).toBe(2);
    expect(recorded.statements[0]).toBe('begin read only');
    expect(recorded.statements[1]).toContain('set_config');
    expect(recorded.statements.at(-1)).toBe('commit');
    expect(recorded.releases).toEqual([false]);
  });

  it('rolls a failed work back and gives the connection back', async () => {
    const { pool, recorded } = poolWith();
    const transactions = new DiscardableSystemTransactions(pool);

    await expect(
      transactions.run(
        () => Promise.reject(new Error('refused')),
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow('refused');

    expect(recorded.statements.at(-1)).toBe('rollback');
    expect(recorded.releases).toEqual([false]);
  });

  it('destroys the connection of a stuck statement once discarded, settling at once without a rollback', async () => {
    const { pool, recorded } = poolWith('delete');
    const transactions = new DiscardableSystemTransactions(pool);
    const discard = new AbortController();

    const pending: Promise<unknown> = transactions.run(
      ({ db }) => db.execute(sql`delete from invitation_batch_replays`),
      {},
      discard.signal,
    );
    await vi.waitFor(() => {
      expect(recorded.statements.at(-1)).toContain('delete');
    });
    discard.abort();

    // Drizzle wraps the error of the terminated connection in its own failed-query error.
    await expect(pending).rejects.toThrow('Failed query');
    expect(recorded.releases).toHaveLength(1);
    expect(recorded.releases[0]).toBeInstanceOf(Error);
    expect(recorded.statements).not.toContain('rollback');
  });

  it('destroys the connection of a stalled commit once discarded', async () => {
    const { pool, recorded } = poolWith('commit');
    const transactions = new DiscardableSystemTransactions(pool);
    const discard = new AbortController();

    const pending: Promise<unknown> = transactions.run(
      () => Promise.resolve(1),
      {},
      discard.signal,
    );
    await vi.waitFor(() => {
      expect(recorded.statements.at(-1)).toBe('commit');
    });
    discard.abort();

    await expect(pending).rejects.toThrow('Connection terminated');
    expect(recorded.releases).toHaveLength(1);
    expect(recorded.releases[0]).toBeInstanceOf(Error);
  });

  it('gives a connection back unused when discarded during the checkout', async () => {
    const { pool, recorded } = poolWith();
    const transactions = new DiscardableSystemTransactions(pool);
    const discard = new AbortController();
    discard.abort();

    await expect(transactions.run(() => Promise.resolve(1), {}, discard.signal)).rejects.toThrow(
      'discarded before it began',
    );
    expect(recorded.statements).toEqual([]);
    expect(recorded.releases).toEqual([undefined]);
  });

  it('never releases a connection twice when discarded after it committed', async () => {
    const { pool, recorded } = poolWith();
    const transactions = new DiscardableSystemTransactions(pool);
    const discard = new AbortController();

    await expect(transactions.run(() => Promise.resolve(1), {}, discard.signal)).resolves.toBe(1);
    discard.abort();

    expect(recorded.releases).toEqual([false]);
  });
});
