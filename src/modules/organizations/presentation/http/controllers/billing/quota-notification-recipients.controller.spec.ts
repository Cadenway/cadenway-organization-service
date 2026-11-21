import { runWithOrganizationContext } from '@cadenway/nest-common';
import { describe, expect, it, vi } from 'vitest';

import type { QuotaNotificationRecipientsUnitOfWork } from '../../../../application/ports/outbound/transactions/quota-notifications/quota-notification-recipients-unit-of-work.port.js';
import { ListQuotaNotificationRecipients } from '../../../../application/use-cases/queries/quota-notifications/list-quota-notification-recipients/list-quota-notification-recipients.use-case.js';
import { LookupQuotaNotificationRecipients } from '../../../../application/use-cases/queries/quota-notifications/lookup-quota-notification-recipients/lookup-quota-notification-recipients.use-case.js';
import { BillingAuthorityCursor } from '../../mappers/billing/billing-authority-cursor.mapper.js';
import { QuotaNotificationRecipientsController } from './quota-notification-recipients.controller.js';

const organizationId = '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12';
const firstUser = '019a7002-2b3c-7d4e-8f5a-6b7c8d9e0f12';
const secondUser = '019a7003-2b3c-7d4e-8f5a-6b7c8d9e0f12';
const context = {
  actor: { type: 'system' as const, id: 'notification-service' },
  organizationId,
  role: null,
  scopes: [],
};

describe('QuotaNotificationRecipientsController', () => {
  it('paginates current recipients and rechecks the submitted IDs', async () => {
    const findActive = vi.fn().mockResolvedValue([firstUser]);
    const unitOfWork: QuotaNotificationRecipientsUnitOfWork = {
      read: async (_id, work) =>
        work({
          organizationExists: vi.fn().mockResolvedValue(true),
          recipients: {
            listActive: vi.fn().mockResolvedValue([firstUser, secondUser]),
            findActive,
          },
        }),
    };
    const controller = new QuotaNotificationRecipientsController(
      new ListQuotaNotificationRecipients(unitOfWork),
      new LookupQuotaNotificationRecipients(unitOfWork),
      new BillingAuthorityCursor(Buffer.alloc(32, 8).toString('base64url')),
    );
    const page = await runWithOrganizationContext(context, () => controller.list({ limit: 1 }));
    expect(page.items).toEqual([firstUser]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const lookup = await runWithOrganizationContext(context, () =>
      controller.lookup({ userIds: [firstUser, secondUser] }),
    );
    expect(lookup.items).toEqual([firstUser]);
    await expect(
      runWithOrganizationContext({ ...context, actor: { type: 'system', id: 'wrong' } }, () =>
        controller.lookup({ userIds: [firstUser] }),
      ),
    ).rejects.toMatchObject({ problem: { code: 'auth.actor-not-allowed' } });
  });
});
