import { describe, expect, it, vi } from 'vitest';

import { ListBillingMemberships } from './list-billing-memberships.use-case.js';

describe('ListBillingMemberships', () => {
  const organizationId = '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const owner = {
    memberId: '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30',
    state: 'active',
    role: 'owner',
    version: 1,
  } as const;
  const removed = {
    memberId: '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31',
    state: 'removed',
    version: 2,
  } as const;

  it('preserves the upper bound and returns a continuation only with a lookahead', async () => {
    const read = vi.fn().mockResolvedValue({ upperId: removed.memberId, items: [owner, removed] });
    const query = new ListBillingMemberships({ read });

    expect(await query.execute({ organizationId, position: null, limit: 1 })).toEqual({
      items: [owner],
      nextPosition: { upperId: removed.memberId, afterId: owner.memberId },
    });
    expect(read).toHaveBeenCalledWith(organizationId, null, 2);
  });

  it('passes the signed organization and scan position through to the reader', async () => {
    const position = { upperId: removed.memberId, afterId: owner.memberId };
    const read = vi.fn().mockResolvedValue({ upperId: removed.memberId, items: [removed] });
    const query = new ListBillingMemberships({ read });

    expect(await query.execute({ organizationId, position, limit: 100 })).toEqual({
      items: [removed],
      nextPosition: null,
    });
    expect(read).toHaveBeenCalledWith(organizationId, position, 101);
  });

  it('distinguishes a missing organization from an empty final page', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ upperId: null, items: [] });
    const query = new ListBillingMemberships({ read });
    const input = { organizationId, position: null, limit: 10 };

    expect(await query.execute(input)).toBeNull();
    expect(await query.execute(input)).toEqual({ items: [], nextPosition: null });
  });

  it.each([0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid page size %s before reading',
    async (limit) => {
      const read = vi.fn();
      const query = new ListBillingMemberships({ read });

      await expect(query.execute({ organizationId, position: null, limit })).rejects.toThrow(
        RangeError,
      );
      expect(read).not.toHaveBeenCalled();
    },
  );
});
