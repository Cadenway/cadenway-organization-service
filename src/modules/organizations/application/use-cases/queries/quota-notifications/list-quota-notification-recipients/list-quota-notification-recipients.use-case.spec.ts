import { describe, expect, it, vi } from 'vitest';

import type { QuotaNotificationRecipientsUnitOfWork } from '../../../../ports/outbound/transactions/quota-notifications/quota-notification-recipients-unit-of-work.port.js';
import { ListQuotaNotificationRecipients } from './list-quota-notification-recipients.use-case.js';

describe('ListQuotaNotificationRecipients', () => {
  const organizationId = '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const camille = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
  const marc = '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31';

  it('returns only the requested page and its last visible ID when another recipient exists', async () => {
    const organizationExists = vi.fn().mockResolvedValue(true);
    const listActive = vi.fn().mockResolvedValue([camille, marc]);
    const unitOfWork: QuotaNotificationRecipientsUnitOfWork = {
      read: async (tenantId, work) => {
        expect(tenantId).toBe(organizationId);
        return work({ organizationExists, recipients: { listActive, findActive: vi.fn() } });
      },
    };

    const result = await new ListQuotaNotificationRecipients(unitOfWork).execute({
      organizationId,
      afterUserId: null,
      limit: 1,
    });

    expect(organizationExists).toHaveBeenCalledOnce();
    expect(listActive).toHaveBeenCalledWith(organizationId, null, 2);
    expect(result).toEqual({ items: [camille], nextUserId: camille });
  });

  it('distinguishes a missing organization from an empty page', async () => {
    const organizationExists = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const listActive = vi.fn().mockResolvedValue([]);
    const unitOfWork: QuotaNotificationRecipientsUnitOfWork = {
      read: async (_tenantId, work) =>
        work({ organizationExists, recipients: { listActive, findActive: vi.fn() } }),
    };
    const query = new ListQuotaNotificationRecipients(unitOfWork);
    const input = { organizationId, afterUserId: marc, limit: 100 };

    expect(await query.execute(input)).toBeNull();
    expect(listActive).not.toHaveBeenCalled();
    expect(await query.execute(input)).toEqual({ items: [], nextUserId: null });
    expect(listActive).toHaveBeenCalledWith(organizationId, marc, 101);
  });

  it.each([0, 101, 1.5, Number.NaN])('rejects an invalid page size %s', async (limit) => {
    const read = vi.fn();
    const query = new ListQuotaNotificationRecipients({ read });

    await expect(query.execute({ organizationId, afterUserId: null, limit })).rejects.toThrow(
      RangeError,
    );
    expect(read).not.toHaveBeenCalled();
  });
});
