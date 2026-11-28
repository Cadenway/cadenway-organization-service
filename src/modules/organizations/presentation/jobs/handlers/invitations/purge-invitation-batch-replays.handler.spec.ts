import type { JobScheduler, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
