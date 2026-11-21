import { describe, expect, it, vi } from 'vitest';

import { CheckAutomationRecipient } from './check-automation-recipient.use-case.js';

const input = {
  organizationId: '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12',
  actorUserId: '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f13',
  userId: '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f14',
};

describe('CheckAutomationRecipient', () => {
  it.each(['owner', 'admin'] as const)(
    'returns the current recipient decision for an active %s',
    async (actorRole) => {
      const read = vi.fn().mockResolvedValue({ actorRole, eligible: true });
      const query = new CheckAutomationRecipient({ read });
      await expect(query.execute(input)).resolves.toEqual({ eligible: true });
      expect(read).toHaveBeenCalledExactlyOnceWith(
        input.organizationId,
        input.actorUserId,
        input.userId,
      );
    },
  );

  it('returns the same negative result for an absent recipient', async () => {
    const query = new CheckAutomationRecipient({
      read: vi.fn().mockResolvedValue({ actorRole: 'admin', eligible: false }),
    });
    await expect(query.execute(input)).resolves.toEqual({ eligible: false });
  });

  it.each(['member', 'guest'] as const)('refuses a caller with role %s', async (actorRole) => {
    const query = new CheckAutomationRecipient({
      read: vi.fn().mockResolvedValue({ actorRole, eligible: true }),
    });
    await expect(query.execute(input)).rejects.toMatchObject({
      refusal: { reason: 'role-forbidden' },
    });
  });

  it('hides the organization when the caller has no active membership', async () => {
    const query = new CheckAutomationRecipient({
      read: vi.fn().mockResolvedValue({ actorRole: null, eligible: false }),
    });
    await expect(query.execute(input)).rejects.toMatchObject({
      refusal: { reason: 'organization-not-found' },
    });
  });

  it('propagates storage failures rather than treating them as ineligibility', async () => {
    const failure = new Error('read failed');
    const query = new CheckAutomationRecipient({ read: vi.fn().mockRejectedValue(failure) });
    await expect(query.execute(input)).rejects.toBe(failure);
  });
});
