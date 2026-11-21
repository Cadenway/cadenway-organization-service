import { describe, expect, it, vi } from 'vitest';

import type { QuotaNotificationRecipientsUnitOfWork } from '../../../../ports/outbound/transactions/quota-notifications/quota-notification-recipients-unit-of-work.port.js';
import { LookupQuotaNotificationRecipients } from './lookup-quota-notification-recipients.use-case.js';

describe('LookupQuotaNotificationRecipients', () => {
  const organizationId = '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const camille = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
  const marc = '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31';

  it('normalizes repeated IDs and uses the latest eligibility result on each invocation', async () => {
    const organizationExists = vi.fn().mockResolvedValue(true);
    const findActive = vi
      .fn()
      .mockResolvedValueOnce([camille, marc])
      .mockResolvedValueOnce([camille]);
    const unitOfWork: QuotaNotificationRecipientsUnitOfWork = {
      read: async (tenantId, work) => {
        expect(tenantId).toBe(organizationId);
        return work({ organizationExists, recipients: { listActive: vi.fn(), findActive } });
      },
    };
    const query = new LookupQuotaNotificationRecipients(unitOfWork);
    const input = { organizationId, userIds: [camille.toUpperCase(), camille, marc] };

    expect(await query.execute(input)).toEqual({ items: [camille, marc] });
    expect(await query.execute(input)).toEqual({ items: [camille] });
    expect(findActive).toHaveBeenCalledWith(organizationId, [camille, marc]);
    expect(organizationExists).toHaveBeenCalledTimes(2);
  });

  it('returns null without querying recipients when the organization is absent', async () => {
    const findActive = vi.fn();
    const unitOfWork: QuotaNotificationRecipientsUnitOfWork = {
      read: async (_tenantId, work) =>
        work({
          organizationExists: vi.fn().mockResolvedValue(false),
          recipients: { listActive: vi.fn(), findActive },
        }),
    };

    expect(
      await new LookupQuotaNotificationRecipients(unitOfWork).execute({
        organizationId,
        userIds: [camille],
      }),
    ).toBeNull();
    expect(findActive).not.toHaveBeenCalled();
  });

  it.each([0, 101])('rejects an invalid lookup batch of %s IDs', async (count) => {
    const read = vi.fn();
    const query = new LookupQuotaNotificationRecipients({ read });

    await expect(
      query.execute({ organizationId, userIds: Array(count).fill(camille) }),
    ).rejects.toThrow(RangeError);
    expect(read).not.toHaveBeenCalled();
  });
});
