/**
 * Class InvitationBatchReplayPurgeCutShortError
 *
 * @description
 * A call of the replay purge that its deadline or the abort of its job cut short after it started,
 * so it made no progress: while it waited for a pooled connection (`checkout`), opened its
 * transaction and set its timeouts (`setup`), ran its delete (`delete`), committed (`commit`) or
 * rolled back after a failed statement (`rollback`). The transaction was discarded with its
 * connection. A tick that meets it fails, so its queue retries it with its normal backoff; a
 * deadline reached before another call starts is the normal end of a tick instead.
 */
export class InvitationBatchReplayPurgeCutShortError extends Error {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Names the phase the call was cut short in.
   *
   * @param {'checkout' | 'setup' | 'delete' | 'commit' | 'rollback'} phase - Where the call stood.
   * @param {'deadline' | 'abort'} trigger - What cut it short.
   * @constructor
   */
  public constructor(
    public readonly phase: 'checkout' | 'setup' | 'delete' | 'commit' | 'rollback',
    public readonly trigger: 'deadline' | 'abort',
  ) {
    super(`The ${trigger} of the invitation batch replay purge came during its ${phase}.`);
    this.name = 'InvitationBatchReplayPurgeCutShortError';
  }
  // #endregion
}
