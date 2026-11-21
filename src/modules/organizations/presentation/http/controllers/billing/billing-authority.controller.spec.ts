import { runWithOrganizationContext } from '@cadenway/nest-common';
import { describe, expect, it, vi } from 'vitest';

import { ListBillingMemberships } from '../../../../application/use-cases/queries/billing/list-billing-memberships/list-billing-memberships.use-case.js';
import { ListSearchOrganizations } from '../../../../application/use-cases/queries/search/list-search-organizations/list-search-organizations.use-case.js';
import { BillingAuthorityCursor } from '../../mappers/billing/billing-authority-cursor.mapper.js';
import { BillingAuthorityController } from './billing-authority.controller.js';

const organizationId = '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12';
const memberId = '019a7002-2b3c-7d4e-8f5a-6b7c8d9e0f12';
const upperId = '019a7003-2b3c-7d4e-8f5a-6b7c8d9e0f12';
const context = {
  actor: { type: 'system' as const, id: 'billing-service' },
  organizationId,
  role: null,
  scopes: [],
};

describe('BillingAuthorityController', () => {
  it('returns only the authorized tenant membership page and signs its continuation', async () => {
    const read = vi.fn().mockResolvedValue({
      upperId,
      items: [
        { memberId, version: 1, state: 'active', role: 'member' },
        { memberId: upperId, version: 2, state: 'removed' },
      ],
    });
    const controller = new BillingAuthorityController(
      new ListSearchOrganizations({ read: vi.fn() }),
      new ListBillingMemberships({ read }),
      new BillingAuthorityCursor(Buffer.alloc(32, 7).toString('base64url')),
    );

    const response = await runWithOrganizationContext(context, () =>
      controller.listMemberships({ limit: 1 }),
    );
    expect(response.items).toEqual([{ memberId, version: 1, state: 'active', role: 'member' }]);
    expect(response.nextCursor).toEqual(expect.any(String));
    expect(read).toHaveBeenCalledWith(organizationId, null, 2);
    await expect(
      runWithOrganizationContext({ ...context, actor: { type: 'system', id: 'wrong' } }, () =>
        controller.listMemberships({ limit: 1 }),
      ),
    ).rejects.toMatchObject({ problem: { code: 'auth.actor-not-allowed' } });
  });

  it('returns 404 for a missing tenant', async () => {
    const controller = new BillingAuthorityController(
      new ListSearchOrganizations({ read: vi.fn() }),
      new ListBillingMemberships({ read: vi.fn().mockResolvedValue(null) }),
      new BillingAuthorityCursor(Buffer.alloc(32, 7).toString('base64url')),
    );
    await expect(
      runWithOrganizationContext(context, () => controller.listMemberships({ limit: 10 })),
    ).rejects.toMatchObject({ problem: { code: 'organization.not-found' } });
  });
});
