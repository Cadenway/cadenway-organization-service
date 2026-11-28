import {
  assertNoActiveTransaction,
  ORGANIZATION_SETTING,
  SYSTEM_ACCESS_SETTING,
} from '@cadenway/nest-common/database';
import type { TransactionDatabase, TransactionOptions } from '@cadenway/nest-common/database';
import { metrics } from '@opentelemetry/api';
import type { Histogram, MeterProvider } from '@opentelemetry/api';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DatabaseError } from 'pg';
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
 * The instruments of the database metrics, cached for the meter provider they were made with, so
 * an SDK started after this module was imported gets its own.
 */
let instruments:
  | {
      readonly provider: MeterProvider;
      readonly poolAcquireDuration: Histogram;
      readonly transactionDuration: Histogram;
    }
  | undefined;

/**
 * The two histograms the transaction runners of `@cadenway/nest-common` record, under the same
 * meter, names, units and descriptions, so the purge's transactions land in the same series of
 * every dashboard. The kit does not export its instruments (0.8.1); replace this with its export
 * once it has one.
 *
 * @returns The pool acquisition and transaction duration histograms of the current provider.
 */
function databaseMetrics(): {
  readonly poolAcquireDuration: Histogram;
  readonly transactionDuration: Histogram;
} {
  const provider: MeterProvider = metrics.getMeterProvider();
  if (instruments?.provider !== provider) {
    const meter = provider.getMeter('@cadenway/nest-common');
    instruments = {
      provider,
      poolAcquireDuration: meter.createHistogram('cadenway.postgres.pool.acquire.duration', {
        description: 'Elapsed time waiting to acquire a PostgreSQL connection from the pool.',
        unit: 'ms',
      }),
      transactionDuration: meter.createHistogram('cadenway.postgres.transaction.duration', {
        description: 'Time a PostgreSQL connection is held by the transaction executor.',
        unit: 'ms',
      }),
    };
  }
  return instruments;
}

/**
 * Class DiscardableSystemTransactions
 *
 * @description
 * Runs a system transaction, as the kit's `SystemTransactionRunner` does (the same row-level
 * security settings: no organization, system access on, and the same pool acquisition and
 * transaction duration metrics, `kind: system`), on a pooled connection that its caller can
 * discard. When the `discard` signal aborts before the transaction ends, the connection is
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
   * signal that aborts during the checkout gives the connection back unused. `onPhase` learns
   * each step as it starts, after the checkout: `setup` (the opening statements), `work`,
   * `commit`, `rollback`; and `commit-unconfirmed` when the `COMMIT` was sent but its answer never
   * came (the connection failed meanwhile): the server may have committed, so no rollback is
   * attempted and the call rejects with the transport error. A commit the server answered stays
   * distinct: refused (a `DatabaseError`) or turned into a rollback (`ROLLBACK`), it committed
   * nothing and rejects as any failed statement.
   *
   * @param {(scope: { readonly db: TransactionDatabase }) => Promise<TResult>} work - The
   * statements, which must not keep `db` past their promise.
   * @param {TransactionOptions} options - The isolation level and the read-only flag.
   * @param {AbortSignal} discard - Aborts to destroy the connection.
   * @param {(phase: 'setup' | 'work' | 'commit' | 'commit-unconfirmed' | 'rollback') => void} onPhase -
   * Learns the step the transaction starts.
   * @returns {Promise<TResult>} What `work` resolved with, once committed.
   * @throws {Error} Inside a live transaction, when discarded, or when a statement fails.
   */
  public async run<TResult>(
    work: (scope: { readonly db: TransactionDatabase }) => Promise<TResult>,
    options: TransactionOptions,
    discard: AbortSignal,
    onPhase: (
      phase: 'setup' | 'work' | 'commit' | 'commit-unconfirmed' | 'rollback',
    ) => void = (): void => undefined,
  ): Promise<TResult> {
    assertNoActiveTransaction();
    const { poolAcquireDuration, transactionDuration } = databaseMetrics();
    const connection: PoolClient = await this.checkout(poolAcquireDuration);
    const started: number = performance.now();
    const state: {
      discarded: boolean;
      broken: boolean;
      unconfirmed: boolean;
      outcome: 'success' | 'error';
    } = { discarded: false, broken: false, unconfirmed: false, outcome: 'error' };
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
    try {
      if (discard.aborted) {
        throw new Error('The system transaction was discarded before it began.');
      }
      connection.on('error', onConnectionError);
      discard.addEventListener('abort', destroy, { once: true });
      try {
        onPhase('setup');
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
        onPhase('work');
        const result: TResult = await work({ db: drizzle({ client: connection }) });
        onPhase('commit');
        const committed = await connection.query('commit').catch((error: unknown) => {
          // The server answers a refused commit with an `ErrorResponse`, a `DatabaseError`. Any
          // other failure, short of a discard, lost the answer: the commit may have taken effect.
          if (!state.discarded && !(error instanceof DatabaseError)) {
            state.unconfirmed = true;
            state.broken = true;
            onPhase('commit-unconfirmed');
          }
          throw error;
        });
        if (committed.command === 'ROLLBACK') {
          throw new Error('The system transaction was rolled back at commit.');
        }
        state.outcome = 'success';
        return result;
      } catch (error: unknown) {
        if (!state.discarded && !state.unconfirmed) {
          onPhase('rollback');
          try {
            await connection.query('rollback');
          } catch {
            state.broken = true;
          }
        }
        throw error;
      }
    } finally {
      discard.removeEventListener('abort', destroy);
      connection.removeListener('error', onConnectionError);
      if (!state.discarded) {
        connection.release(state.broken);
      }
      transactionDuration.record(performance.now() - started, {
        kind: 'system',
        outcome: state.outcome,
      });
    }
  }

  /**
   * Method checkout
   *
   * @description
   * Checks a connection out of the pool and records how long it took, whether it succeeded or not.
   *
   * @param {Histogram} poolAcquireDuration - The histogram of the acquisitions.
   * @returns {Promise<PoolClient>} The connection, which the caller must release.
   */
  private async checkout(poolAcquireDuration: Histogram): Promise<PoolClient> {
    const started: number = performance.now();
    let outcome: 'success' | 'error' = 'error';
    try {
      const connection: PoolClient = await this.pool.connect();
      outcome = 'success';
      return connection;
    } finally {
      poolAcquireDuration.record(performance.now() - started, { kind: 'system', outcome });
    }
  }
  // #endregion
}
