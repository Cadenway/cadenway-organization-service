import type { JobScheduler, JobWorkerRegistry } from '@cadenway/nest-jobs/runtime';
import { describe, expect, it, vi } from 'vitest';

import type { AbandonOrganizationLogoUpload } from '../../../../application/use-cases/commands/logo/abandon-organization-logo-upload/abandon-organization-logo-upload.use-case.js';
import { ExpireOrganizationLogoUploadsHandler } from './expire-organization-logo-uploads.handler.js';

const queue = 'organization.expire-logo-uploads';
const first = { organizationId: 'organization-a', uploaderUserId: 'user-a', uploadId: 'upload-a' };
const second = { organizationId: 'organization-b', uploaderUserId: 'user-b', uploadId: 'upload-b' };

function setup() {
  const workers = { work: vi.fn<JobWorkerRegistry['work']>().mockResolvedValue(undefined) };
  const scheduler = {
    schedule: vi.fn<JobScheduler['schedule']>().mockResolvedValue(undefined),
    unschedule: vi.fn<JobScheduler['unschedule']>(),
  };
  const listExpired = vi.fn().mockResolvedValue([first, second]);
  const abandon = {
    execute: vi
      .fn<AbandonOrganizationLogoUpload['execute']>()
      .mockResolvedValue({ abandoned: true }),
  };
  const handler = new ExpireOrganizationLogoUploadsHandler(
    workers,
    scheduler,
    listExpired,
    abandon,
    queue,
  );
  return { workers, scheduler, listExpired, abandon, handler };
}

describe('ExpireOrganizationLogoUploadsHandler', () => {
  it('registers a durable minute schedule and a worker on the declared system queue', async () => {
    const { handler, scheduler, workers } = setup();

    await handler.onApplicationBootstrap();

    expect(scheduler.schedule).toHaveBeenCalledWith(queue, '* * * * *', {
      key: 'minutely',
      timeZone: 'UTC',
    });
    expect(workers.work).toHaveBeenCalledWith(queue, expect.any(Function));
  });

  it('does not open a system scan for a tenant job', async () => {
    const { handler, listExpired } = setup();

    await expect(
      handler.handle({
        organizationId: first.organizationId,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('requires a system job');
    expect(listExpired).not.toHaveBeenCalled();
  });

  it('visits other tenants when one owner transaction fails and then retries the job', async () => {
    const { handler, abandon } = setup();
    abandon.execute.mockRejectedValueOnce(new Error('One transaction failed.'));

    await expect(
      handler.handle({ organizationId: null, signal: new AbortController().signal }),
    ).rejects.toThrow('Could not expire 1 logo upload reservations.');
    expect(abandon.execute.mock.calls).toEqual([[first], [second]]);
  });

  it('does not start another owner transaction after the attempt is cancelled', async () => {
    const { handler, abandon } = setup();
    const cancellation = new AbortController();
    abandon.execute.mockImplementationOnce(() => {
      cancellation.abort();
      return Promise.resolve({ abandoned: true });
    });

    await expect(
      handler.handle({ organizationId: null, signal: cancellation.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(abandon.execute.mock.calls).toEqual([[first]]);
  });
});
