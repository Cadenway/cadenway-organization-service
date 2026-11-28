/**
 * Class InvitationBatchReplayPurgeCutShortError
 *
 * @description
 * A call of the replay purge cut short after it started, so its outcome is not confirmed, by its
 * deadline or the abort of its job (`trigger`: `deadline`, `abort`), or by the loss of its
 * connection after its `COMMIT` was sent and before the answer came (`transport`, always in
 * `commit`, with the transport error as `cause`). While it waited for a pooled connection
 * (`checkout`), opened its transaction and set its timeouts (`setup`), ran its delete (`delete`)
 * or rolled back after a failed statement (`rollback`), it made no progress; while it committed
 * (`commit`), the commit may have taken effect on the server without its answer coming back, so
 * whether it deleted its rows is unknown. A commit the server answered, refused or turned into a
 * rollback, is a confirmed failure and never this error. The transaction was discarded with its
 * connection. A tick that meets it fails, so its queue retries it with its normal backoff, which
 * is safe whatever the commit did: the retry deletes whatever expired rows are left. A deadline
 * reached before another call starts is the normal end of a tick instead. Its message names the
 * phase and the trigger, the only parts of an error the job runtime logs.
 */
export class InvitationBatchReplayPurgeCutShortError extends Error {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Names the phase the call was cut short in and what cut it short.
   *
   * @param {'checkout' | 'setup' | 'delete' | 'commit' | 'rollback'} phase - Where the call stood.
   * @param {'deadline' | 'abort' | 'transport'} trigger - What cut it short.
   * @param {unknown} cause - The transport error, for `transport`.
   * @constructor
   */
  public constructor(
    public readonly phase: 'checkout' | 'setup' | 'delete' | 'commit' | 'rollback',
    public readonly trigger: 'deadline' | 'abort' | 'transport',
    cause?: unknown,
  ) {
    super(
      trigger === 'transport'
        ? `The connection of the invitation batch replay purge failed during its ${phase}, ` +
            'before the answer of the server: whether it committed is unknown.'
        : `The ${trigger} of the invitation batch replay purge came during its ${phase}.`,
      cause === undefined ? undefined : { cause },
    );
    this.name = 'InvitationBatchReplayPurgeCutShortError';
  }
  // #endregion
}
