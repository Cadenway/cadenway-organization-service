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

function setup(deletions: readonly number[], elapsedPerPurgeMs: number = 0) {
  const workers = { work: vi.fn<JobWorkerRegistry['work']>().mockResolvedValue(undefined) };
  const scheduler = {
    schedule: vi.fn<JobScheduler['schedule']>().mockResolvedValue(undefined),
    unschedule: vi.fn<JobScheduler['unschedule']>(),
  };
  let clock = 0;
  const remaining = [...deletions];
  const expired = {
    purge: vi.fn<(limit: number, timeoutMs: number) => Promise<number>>(() => {
      clock += elapsedPerPurgeMs;
      return Promise.resolve(remaining.shift() ?? 0);
    }),
    oldestExpiredAgeSeconds: vi
      .fn<(timeoutMs: number) => Promise<number | null>>()
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

  it('keeps deleting batches of 500 until one deletes fewer', async () => {
    const { handler, expired } = setup([500, 500, 120]);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);

    expect(INVITATION_BATCH_REPLAY_PURGE_LIMIT).toBe(500);
    expect(expired.purge.mock.calls).toEqual([
      [500, 4_500],
      [500, 4_500],
      [500, 4_500],
    ]);
    expect(expired.oldestExpiredAgeSeconds).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('gives each delete the time left, stops on its budget and reads the backlog in the rest', async () => {
    const { handler, expired } = setup(
      Array.from({ length: 100 }, () => 500),
      1_000,
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);

    expect(INVITATION_BATCH_REPLAY_PURGE_BUDGET_MS).toBe(5_000);
    expect(expired.purge.mock.calls).toEqual([
      [500, 4_500],
      [500, 3_500],
      [500, 2_500],
      [500, 1_500],
      [500, 500],
    ]);
    expect(expired.oldestExpiredAgeSeconds).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      { deleted: 2_500, oldestExpiredAgeSeconds: null },
      expect.any(String),
    );
  });

  it('reads the backlog within what remains of the budget when the deletes leave time', async () => {
    const { handler, expired } = setup(
      Array.from({ length: 100 }, () => 500),
      1_200,
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);

    expect(expired.purge.mock.calls).toEqual([
      [500, 4_500],
      [500, 3_300],
      [500, 2_100],
      [500, 900],
    ]);
    expect(expired.oldestExpiredAgeSeconds).toHaveBeenCalledExactlyOnceWith(200);
    expect(warn).toHaveBeenCalledWith(
      { deleted: 2_000, oldestExpiredAgeSeconds: 840 },
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
