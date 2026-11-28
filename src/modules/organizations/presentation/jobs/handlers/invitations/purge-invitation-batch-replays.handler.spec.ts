import type { JobScheduler, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvitationBatchReplayPurgeCutShortError } from '../../../../application/models/invitations/invitation-batch-replay-purge-cut-short.model.js';
import {
  INVITATION_BATCH_REPLAY_PURGE_BUDGET_MS,
  INVITATION_BATCH_REPLAY_PURGE_LIMIT,
  PurgeInvitationBatchReplaysHandler,
} from './purge-invitation-batch-replays.handler.js';

const queue = 'organization.purge-invitation-batch-replays';
const system = { organizationId: null, signal: new AbortController().signal };

/** What the handler gives each call of the store. */
interface Window {
  // #region Properties
  /** The absolute deadline. */
  readonly deadline: number;

  /** The abort signal of the job. */
  readonly signal: AbortSignal;
  // #endregion
}

function setup(deletions: readonly (number | null)[], elapsedPerPurgeMs: number = 0) {
  const workers = { work: vi.fn<JobWorkerRegistry['work']>().mockResolvedValue(undefined) };
  const scheduler = {
    schedule: vi.fn<JobScheduler['schedule']>().mockResolvedValue(undefined),
    unschedule: vi.fn<JobScheduler['unschedule']>(),
  };
  let clock = 0;
  const remaining = [...deletions];
  const expired = {
    stalled: false,
    purge: vi.fn<(limit: number, window: Window) => Promise<number | null>>(() => {
      clock += elapsedPerPurgeMs;
      const next = remaining.shift();
      return Promise.resolve(next === undefined ? 0 : next);
    }),
    oldestExpiredAgeSeconds: vi
      .fn<(window: Window) => Promise<number | null>>()
      .mockResolvedValue(840),
  };
  const handler = new PurgeInvitationBatchReplaysHandler(
    workers,
    scheduler,
    expired,
    queue,
    () => clock,
  );
  return { workers, scheduler, expired, handler };
}

/** The deadlines the handler gave to the deletes. */
function deadlinesOf(calls: readonly (readonly [number, Window])[]): number[] {
  return calls.map(([limit, window]) => {
    expect(limit).toBe(INVITATION_BATCH_REPLAY_PURGE_LIMIT);
    expect(window.signal).toBe(system.signal);
    return window.deadline;
  });
}

describe('PurgeInvitationBatchReplaysHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers a durable minute schedule and a worker on the declared system queue', async () => {
    const { handler, scheduler, workers } = setup([]);

    await handler.onApplicationBootstrap();

    expect(scheduler.schedule).toHaveBeenCalledWith(queue, '* * * * *', {
      key: 'minutely',
      timeZone: 'UTC',
    });
    expect(workers.work).toHaveBeenCalledWith(queue, expect.any(Function));
  });

  it('keeps deleting batches of 500 until one deletes fewer, all within one absolute deadline', async () => {
    const { handler, expired } = setup([500, 500, 120]);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);

    expect(INVITATION_BATCH_REPLAY_PURGE_LIMIT).toBe(500);
    expect(deadlinesOf(expired.purge.mock.calls)).toEqual([4_500, 4_500, 4_500]);
    expect(expired.oldestExpiredAgeSeconds).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stops on its budget, without reading the backlog once no time is left', async () => {
    const { handler, expired } = setup(
      Array.from({ length: 100 }, () => 500),
      1_000,
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);

    expect(INVITATION_BATCH_REPLAY_PURGE_BUDGET_MS).toBe(5_000);
    expect(expired.purge).toHaveBeenCalledTimes(5);
    expect(expired.oldestExpiredAgeSeconds).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { deleted: 2_500, oldestExpiredAgeSeconds: null },
      expect.any(String),
    );
  });

  it('reads the backlog by the end of the budget when the deletes leave time', async () => {
    const { handler, expired } = setup(
      Array.from({ length: 100 }, () => 500),
      1_200,
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);

    expect(expired.purge).toHaveBeenCalledTimes(4);
    expect(expired.oldestExpiredAgeSeconds).toHaveBeenCalledExactlyOnceWith({
      deadline: 5_000,
      signal: system.signal,
    });
    expect(warn).toHaveBeenCalledWith(
      { deleted: 2_000, oldestExpiredAgeSeconds: 840 },
      expect.any(String),
    );
  });

  it('stops when the store found no time left after waiting for its connection', async () => {
    const { handler, expired } = setup([500, null, 500]);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);

    expect(expired.purge).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      { deleted: 500, oldestExpiredAgeSeconds: 840 },
      expect.any(String),
    );
  });

  it('skips a tick while a call an earlier tick gave up on still runs', async () => {
    const { handler, expired } = setup([500]);
    expired.stalled = true;
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);

    expect(expired.purge).not.toHaveBeenCalled();
    expect(expired.oldestExpiredAgeSeconds).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith({ skippedTicks: 1 }, expect.any(String));
  });

  it('runs the next tick once the call an earlier tick gave up on has settled', async () => {
    const { handler, expired } = setup([120]);
    expired.stalled = true;
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);
    expired.stalled = false;
    await handler.handle(system);

    expect(warn).toHaveBeenCalledOnce();
    expect(expired.purge).toHaveBeenCalledOnce();
  });

  it('measures its budget on a monotonic clock, whatever steps the wall clock takes', async () => {
    vi.useFakeTimers();
    try {
      const workers = { work: vi.fn<JobWorkerRegistry['work']>() };
      const scheduler = {
        schedule: vi.fn<JobScheduler['schedule']>(),
        unschedule: vi.fn<JobScheduler['unschedule']>(),
      };
      const remaining: number[] = [500, 500, 500, 120];
      const deadlines: number[] = [];
      const expired = {
        stalled: false,
        purge: vi.fn((_limit: number, window: Window): Promise<number | null> => {
          deadlines.push(window.deadline);
          // The wall clock jumps a minute forward at each delete, as a time synchronization would.
          vi.setSystemTime(Date.now() + 60_000);
          return Promise.resolve(remaining.shift() ?? 0);
        }),
        oldestExpiredAgeSeconds: vi.fn<(window: Window) => Promise<number | null>>(),
      };
      const handler = new PurgeInvitationBatchReplaysHandler(workers, scheduler, expired, queue);
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const started: number = performance.now();

      await handler.handle(system);

      expect(expired.purge).toHaveBeenCalledTimes(4);
      expect(deadlines).toEqual(Array.from({ length: 4 }, () => started + 4_500));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails the tick when a delete is cut short once started, warning with its phase and backlog, never at error', async () => {
    const { handler, expired } = setup([500]);
    const cutShort = new InvitationBatchReplayPurgeCutShortError('setup', 'deadline');
    expired.purge.mockResolvedValueOnce(500).mockRejectedValueOnce(cutShort);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(handler.handle(system)).rejects.toBe(cutShort);

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { phase: 'setup', trigger: 'deadline', deleted: 500, oldestExpiredAgeSeconds: 840 },
      expect.any(String),
    );
    // The job runtime writes the one error-level event, for the last attempt only.
    expect(error).not.toHaveBeenCalled();
    expect(cutShort.message).toContain('deadline');
    expect(cutShort.message).toContain('setup');
  });

  it('keeps the phase and rethrows the original error when the backlog read fails after a cut short', async () => {
    const { handler, expired } = setup([]);
    const cutShort = new InvitationBatchReplayPurgeCutShortError('delete', 'deadline');
    expired.purge.mockRejectedValueOnce(cutShort);
    expired.oldestExpiredAgeSeconds.mockRejectedValueOnce(new Error('connection refused'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(handler.handle(system)).rejects.toBe(cutShort);

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      { phase: 'delete', trigger: 'deadline', deleted: 0, oldestExpiredAgeSeconds: null },
      expect.any(String),
    );
  });

  it('reports a commit cut short as unconfirmed, the tick still failing for a retry', async () => {
    const { handler, expired } = setup([]);
    const cutShort = new InvitationBatchReplayPurgeCutShortError('commit', 'abort');
    expired.purge.mockRejectedValueOnce(cutShort);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(handler.handle(system)).rejects.toBe(cutShort);

    expect(warn).toHaveBeenCalledWith(
      {
        phase: 'commit',
        trigger: 'abort',
        committed: 'unknown',
        deleted: 0,
        oldestExpiredAgeSeconds: 840,
      },
      expect.any(String),
    );
  });

  it('reports a commit whose connection failed before its answer as unconfirmed, with its cause', async () => {
    const { handler, expired } = setup([]);
    const lost = new Error('Connection terminated unexpectedly');
    const cutShort = new InvitationBatchReplayPurgeCutShortError('commit', 'transport', lost);
    expired.purge.mockRejectedValueOnce(cutShort);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(handler.handle(system)).rejects.toBe(cutShort);

    expect(cutShort.cause).toBe(lost);
    expect(cutShort.message).toContain('whether it committed is unknown');
    expect(warn).toHaveBeenCalledWith(
      {
        phase: 'commit',
        trigger: 'transport',
        committed: 'unknown',
        deleted: 0,
        oldestExpiredAgeSeconds: 840,
      },
      expect.any(String),
    );
  });

  it('ends a tick on its budget with a null backlog when its read fails', async () => {
    const { handler, expired } = setup(
      Array.from({ length: 100 }, () => 500),
      1_200,
    );
    expired.oldestExpiredAgeSeconds.mockRejectedValueOnce(new Error('connection refused'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);

    expect(warn).toHaveBeenCalledWith(
      { deleted: 2_000, oldestExpiredAgeSeconds: null },
      expect.any(String),
    );
  });

  it('fails the tick on any other failure of a delete, without reporting it as cut short', async () => {
    const { handler, expired } = setup([]);
    const refused = new Error('canceling statement due to statement timeout');
    expired.purge.mockRejectedValueOnce(refused);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(handler.handle(system)).rejects.toBe(refused);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('starts no delete with less than its minimum window left, ending the tick on its budget', async () => {
    const { handler, expired } = setup(
      Array.from({ length: 100 }, () => 500),
      4_300,
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);

    // 200 ms left after the first delete: too little to start another one.
    expect(expired.purge).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      { deleted: 500, oldestExpiredAgeSeconds: 840 },
      expect.any(String),
    );
  });

  it('opens no system purge for a tenant job or an aborted one', async () => {
    const { handler, expired } = setup([500]);
    const aborted = new AbortController();
    aborted.abort();

    await expect(
      handler.handle({ organizationId: 'organization-a', signal: new AbortController().signal }),
    ).rejects.toThrow('requires a system job');
    await expect(
      handler.handle({ organizationId: null, signal: aborted.signal }),
    ).rejects.toThrow();
    expect(expired.purge).not.toHaveBeenCalled();
  });
});
