import { describe, expect, it, vi } from 'vitest';

import type { MemberNamesReader } from '../../../../ports/outbound/persistence/members/member-names-reader.port.js';
import type { MemberNamesUnitOfWork } from '../../../../ports/outbound/transactions/organizations/member-names-unit-of-work.port.js';
import { LookupMemberNames } from './lookup-member-names.use-case.js';

describe('LookupMemberNames', () => {
  const organizationId = '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const actorUserId = '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31';
  const camille = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';

  it('normalizes repeated account IDs and returns only names resolved for the tenant', async () => {
    const findActiveActor = vi.fn().mockResolvedValue(true);
    const findActiveNames = vi
      .fn()
      .mockResolvedValue([{ userId: camille, name: 'Camille Martin' }]);
    const reader: MemberNamesReader = { findActiveActor, findActiveNames };
    const unitOfWork: MemberNamesUnitOfWork = { read: async (work) => work(reader) };
    const lookup = new LookupMemberNames(unitOfWork);

    const result = await lookup.execute({
      organizationId,
      actorUserId,
      userIds: [camille.toUpperCase(), camille, actorUserId],
    });

    expect(findActiveActor).toHaveBeenCalledWith(organizationId, actorUserId);
    expect(findActiveNames).toHaveBeenCalledWith(organizationId, [camille, actorUserId]);
    expect(result).toEqual({ items: [{ userId: camille, name: 'Camille Martin' }] });
  });

  it('refuses a removed caller before looking up any requested name', async () => {
    const findActiveActor = vi.fn().mockResolvedValue(false);
    const findActiveNames = vi.fn();
    const reader: MemberNamesReader = { findActiveActor, findActiveNames };
    const unitOfWork: MemberNamesUnitOfWork = { read: async (work) => work(reader) };
    const lookup = new LookupMemberNames(unitOfWork);

    await expect(
      lookup.execute({ organizationId, actorUserId, userIds: [camille] }),
    ).rejects.toMatchObject({ refusal: { reason: 'organization-not-found' } });
    expect(findActiveNames).not.toHaveBeenCalled();
  });
});
