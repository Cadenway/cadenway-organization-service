import {
  assertNoActiveTransaction,
  ORGANIZATION_SETTING,
  SYSTEM_ACCESS_SETTING,
} from '@cadenway/nest-common/database';
import type { TransactionDatabase, TransactionOptions } from '@cadenway/nest-common/database';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';

/** The statement that opens a transaction, by isolation level, never assembled from input. */
const BEGIN_STATEMENTS: Readonly<
  Record<'default' | NonNullable<TransactionOptions['isolationLevel']>, string>
> = {
  default: 'begin',
  'read committed': 'begin isolation level read committed',
  'repeatable read': 'begin isolation level repeatable read',
  serializable: 'begin isolation level serializable',
};

/**
 * Class DiscardableSystemTransactions
 *
 * @description
 * Runs a system transaction, as the kit's `SystemTransactionRunner` does (the same row-level
 * security settings: no organization, system access on), on a pooled connection that its caller
 * can discard. When the `discard` signal aborts before the transaction ends, the connection is
 * released to the pool with an error, once, and its socket is destroyed on the client side,
 * whatever pg was doing: a statement in flight, a stalled commit or a rollback queued behind an
 * error whose `ReadyForQuery` never came, rejects at once with the connection terminated, the pool
 * never reuses the connection and frees its slot, and the server rolls the transaction back when
 * it notices the disconnection (or at its own timeouts). Nothing is retried, nothing joins an
 * ambient transaction: it is meant for a bounded maintenance call that gives up at its deadline,
 * where the kit's runner keeps its connection until the server answers.
 */
export class DiscardableSystemTransactions {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Binds the transactions to the pool of the service.
   *
   * @param {Pool} pool - The pool of the service.
   * @constructor
   */
  public constructor(private readonly pool: Pool) {}
  // #endregion

  // #region Methods
  /**
   * Method run
   *
   * @description
   * Checks a connection out, opens the transaction, runs `work`, then commits, or rolls back when
   * `work` fails. Once `discard` aborts, the connection is destroyed instead of being given back:
   * the call then rejects as soon as its pending statement does, with no rollback attempted. A
   * signal that aborts during the checkout gives the connection back unused.
   *
   * @param {(scope: { readonly db: TransactionDatabase }) => Promise<TResult>} work - The
   * statements, which must not keep `db` past their promise.
   * @param {TransactionOptions} options - The isolation level and the read-only flag.
   * @param {AbortSignal} discard - Aborts to destroy the connection.
   * @returns {Promise<TResult>} What `work` resolved with, once committed.
   * @throws {Error} Inside a live transaction, when discarded, or when a statement fails.
   */
  public async run<TResult>(
    work: (scope: { readonly db: TransactionDatabase }) => Promise<TResult>,
    options: TransactionOptions,
    discard: AbortSignal,
  ): Promise<TResult> {
    assertNoActiveTransaction();
    const connection: PoolClient = await this.pool.connect();
    if (discard.aborted) {
      connection.release();
      throw new Error('The system transaction was discarded before it began.');
    }
    const state: { discarded: boolean; broken: boolean } = { discarded: false, broken: false };
    // The pool removes its own error listener while a connection is checked out.
    const onConnectionError = (): void => {
      state.broken = true;
    };
    const destroy = (): void => {
      state.discarded = true;
      connection.removeListener('error', onConnectionError);
      // Evicts the client, once: the pool never reuses it and frees its slot.
      connection.release(new Error('The system transaction was discarded.'));
      // pg destroys the socket on eviction only while a statement is its active query. After an
      // `ErrorResponse` it has none until `ReadyForQuery`, the rollback only waits in its queue,
      // and eviction starts a graceful close that a peer keeping the socket open never completes.
      // Destroying the transport always closes it, and pg then fails every queued statement.
      connection.connection.stream.destroy();
    };
    connection.on('error', onConnectionError);
    discard.addEventListener('abort', destroy, { once: true });
    try {
      await connection.query(
        BEGIN_STATEMENTS[options.isolationLevel ?? 'default'] +
          (options.readOnly === true ? ' read only' : ''),
      );
      await connection.query('select set_config($1, $2, true), set_config($3, $4, true)', [
        ORGANIZATION_SETTING,
        '',
        SYSTEM_ACCESS_SETTING,
        'on',
      ]);
      const result: TResult = await work({ db: drizzle({ client: connection }) });
      const committed = await connection.query('commit');
      if (committed.command === 'ROLLBACK') {
        throw new Error('The system transaction was rolled back at commit.');
      }
      return result;
    } catch (error: unknown) {
      if (!state.discarded) {
        try {
          await connection.query('rollback');
        } catch {
          state.broken = true;
        }
      }
      throw error;
    } finally {
      discard.removeEventListener('abort', destroy);
      if (!state.discarded) {
        connection.removeListener('error', onConnectionError);
        connection.release(state.broken);
      }
    }
  }
  // #endregion
}
