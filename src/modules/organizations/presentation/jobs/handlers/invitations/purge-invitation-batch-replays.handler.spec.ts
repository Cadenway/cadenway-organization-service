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
    purge: vi.fn<(limit: number) => Promise<number>>(() => {
      clock += elapsedPerPurgeMs;
      return Promise.resolve(remaining.shift() ?? 0);
    }),
    oldestExpiredAgeSeconds: vi.fn<() => Promise<number | null>>().mockResolvedValue(840),
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
    expect(expired.purge.mock.calls).toEqual([[500], [500], [500]]);
    expect(expired.oldestExpiredAgeSeconds).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stops on its time budget and reports the age of the oldest expired record left', async () => {
    const { handler, expired } = setup(
      Array.from({ length: 100 }, () => 500),
      INVITATION_BATCH_REPLAY_PURGE_BUDGET_MS / 4,
    );
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await handler.handle(system);

    expect(expired.purge).toHaveBeenCalledTimes(4);
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
