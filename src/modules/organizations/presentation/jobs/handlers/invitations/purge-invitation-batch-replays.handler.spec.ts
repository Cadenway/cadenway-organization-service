import type { JobScheduler, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  INVITATION_BATCH_REPLAY_PURGE_LIMIT,
  PurgeInvitationBatchReplaysHandler,
} from './purge-invitation-batch-replays.handler.js';

const queue = 'organization.purge-invitation-batch-replays';

function setup() {
  const workers = { work: vi.fn<JobWorkerRegistry['work']>().mockResolvedValue(undefined) };
  const scheduler = {
    schedule: vi.fn<JobScheduler['schedule']>().mockResolvedValue(undefined),
    unschedule: vi.fn<JobScheduler['unschedule']>(),
  };
  const purge = vi.fn<(limit: number) => Promise<number>>().mockResolvedValue(500);
  const handler = new PurgeInvitationBatchReplaysHandler(workers, scheduler, purge, queue);
  return { workers, scheduler, purge, handler };
}

describe('PurgeInvitationBatchReplaysHandler', () => {
  it('registers a durable minute schedule and a worker on the declared system queue', async () => {
    const { handler, scheduler, workers } = setup();

    await handler.onApplicationBootstrap();

    expect(scheduler.schedule).toHaveBeenCalledWith(queue, '* * * * *', {
      key: 'minutely',
      timeZone: 'UTC',
    });
    expect(workers.work).toHaveBeenCalledWith(queue, expect.any(Function));
  });

  it('deletes one bounded batch of 500 records per tick', async () => {
    const { handler, purge } = setup();

    await handler.handle({ organizationId: null, signal: new AbortController().signal });

    expect(INVITATION_BATCH_REPLAY_PURGE_LIMIT).toBe(500);
    expect(purge).toHaveBeenCalledExactlyOnceWith(500);
  });

  it('opens no system purge for a tenant job or an aborted one', async () => {
    const { handler, purge } = setup();
    const aborted = new AbortController();
    aborted.abort();

    await expect(
      handler.handle({ organizationId: 'organization-a', signal: new AbortController().signal }),
    ).rejects.toThrow('requires a system job');
    await expect(
      handler.handle({ organizationId: null, signal: aborted.signal }),
    ).rejects.toThrow();
    expect(purge).not.toHaveBeenCalled();
  });
});
