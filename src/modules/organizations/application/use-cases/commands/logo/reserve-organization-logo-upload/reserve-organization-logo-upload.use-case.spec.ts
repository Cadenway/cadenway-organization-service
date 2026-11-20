import { describe, expect, it, vi } from 'vitest';

import { OrganizationLogo } from '../../../../../domain/aggregates/logo/organization-logo.aggregate.js';
import { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { OrganizationLogoRefusal } from '../../../../models/logo/organization-logo-refusal.model.js';
import type { OrganizationLogoStore } from '../../../../models/logo/organization-logo-store.model.js';
import type { OrganizationLogoUnitOfWork } from '../../../../ports/outbound/transactions/logo/organization-logo-unit-of-work.port.js';
import { GetOrganizationLogoUpload } from '../../../queries/logo/get-organization-logo-upload/get-organization-logo-upload.use-case.js';
import { AbandonOrganizationLogoUpload } from '../abandon-organization-logo-upload/abandon-organization-logo-upload.use-case.js';
import { PublishOrganizationLogo } from '../publish-organization-logo/publish-organization-logo.use-case.js';
import { RemoveOrganizationLogo } from '../remove-organization-logo/remove-organization-logo.use-case.js';
import { ReserveOrganizationLogoUpload } from './reserve-organization-logo-upload.use-case.js';

const organizationId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';
const actorUserId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const uploadId = '019a7003-4d5e-7f6a-8b9c-0d1e2f3a4b01';
const now = new Date('2026-11-08T08:00:00Z');
const actor = { organizationId, actorUserId };

function fixture() {
  const member = Member.restore({
    ...Member.owner(organizationId, actorUserId, now),
    id: '019a7003-4d5e-7f6a-8b9c-0d1e2f3a4b02',
    removedAt: null,
  });
  const logo = OrganizationLogo.restore({
    organizationId,
    assetId: null,
    generation: 0,
    profileVersion: 7,
  });
  const reservation = logo.reserve(
    { organizationId, uploaderUserId: actorUserId, uploadId },
    { contentType: 'image/png', sizeBytes: 10 },
    now,
    new Date(now.getTime() + 300_000),
  );
  const store = {
    lockMember: vi.fn().mockResolvedValue(member),
    lockLogo: vi.fn().mockResolvedValue(logo),
    findByKey: vi.fn().mockResolvedValue(null),
    lockReservation: vi.fn().mockResolvedValue(reservation),
    newUploadId: vi.fn().mockResolvedValue(uploadId),
    insertReservation: vi.fn().mockResolvedValue(undefined),
    saveReservation: vi.fn().mockResolvedValue(undefined),
    saveLogo: vi.fn<(logo: OrganizationLogo) => Promise<void>>().mockResolvedValue(undefined),
    appendLogoChanged: vi.fn().mockResolvedValue(undefined),
    appendUploadAbandoned: vi.fn().mockResolvedValue(undefined),
  } satisfies OrganizationLogoStore;
  const work: OrganizationLogoUnitOfWork = {
    run: (operation) => operation(store),
    runForCleanup: (_tenant, operation) => operation(store),
  };
  const clock = { now: () => now };
  return { store, work, clock, logo, reservation };
}

describe('organization logo use cases', () => {
  it('locks current membership before allocation and replays the same original reservation', async () => {
    const { store, work, reservation } = fixture();
    const clock = { now: () => new Date(now.getTime() + 789) };
    const reserve = new ReserveOrganizationLogoUpload(work, clock, 300_000);
    const input = {
      ...actor,
      contentType: 'image/png',
      sizeBytes: 10,
      idempotencyKey: 'same-request',
    };
    const first = await reserve.execute(input);
    expect(first).toEqual({ uploadId, expiresAt: new Date(now.getTime() + 300_000) });
    expect(store.lockMember.mock.invocationCallOrder[0]).toBeLessThan(
      store.lockLogo.mock.invocationCallOrder[0] ?? 0,
    );
    store.findByKey.mockResolvedValue(reservation);
    expect(await reserve.execute(input)).toEqual(first);
    expect(store.insertReservation).toHaveBeenCalledOnce();
    await expect(reserve.execute({ ...input, sizeBytes: 11 })).rejects.toMatchObject({
      reason: 'idempotency-key-reused',
    });
  });

  it('checks the current role before disclosing an idempotent receipt or reservation', async () => {
    const { store, work, clock } = fixture();
    store.lockMember.mockResolvedValue(null);
    await expect(
      new ReserveOrganizationLogoUpload(work, clock, 300_000).execute({
        ...actor,
        contentType: 'image/png',
        sizeBytes: 10,
        idempotencyKey: 'key',
      }),
    ).rejects.toMatchObject({ refusal: { reason: 'organization-not-found' } });
    expect(store.findByKey).not.toHaveBeenCalled();
    expect(store.newUploadId).not.toHaveBeenCalled();
  });

  it('exposes media refusals through the application boundary', async () => {
    const { work, clock } = fixture();
    const reserve = new ReserveOrganizationLogoUpload(work, clock, 300_000);
    await expect(
      reserve.execute({ ...actor, contentType: 'image/jpeg', sizeBytes: 10 }),
    ).rejects.toBeInstanceOf(OrganizationLogoRefusal);
  });

  it('replays the original allocation after expiry or supersession while refusing its use', async () => {
    const { store, work, logo, reservation } = fixture();
    const lateClock = { now: () => new Date(now.getTime() + 300_000) };
    const reserve = new ReserveOrganizationLogoUpload(work, lateClock, 300_000);
    const input = {
      ...actor,
      contentType: 'image/png',
      sizeBytes: 10,
      idempotencyKey: 'retained-key',
    };
    store.findByKey.mockResolvedValue(reservation);
    const original = { uploadId, expiresAt: new Date(now.getTime() + 300_000) };

    expect(await reserve.execute(input)).toEqual(original);
    await expect(
      new GetOrganizationLogoUpload(work, lateClock).execute({ ...actor, uploadId }),
    ).rejects.toMatchObject({ reason: 'upload-expired' });
    await expect(
      new PublishOrganizationLogo(work, lateClock).execute({ ...actor, uploadId }),
    ).rejects.toMatchObject({ reason: 'upload-expired' });

    store.lockLogo.mockResolvedValue(logo.remove(actorUserId).logo);
    expect(await reserve.execute(input)).toEqual(original);
    await expect(
      new GetOrganizationLogoUpload(work, { now: () => now }).execute({ ...actor, uploadId }),
    ).rejects.toMatchObject({ reason: 'upload-superseded' });
    await expect(
      new PublishOrganizationLogo(work, { now: () => now }).execute({ ...actor, uploadId }),
    ).rejects.toMatchObject({ reason: 'upload-superseded' });

    store.lockMember.mockResolvedValue(null);
    await expect(reserve.execute(input)).rejects.toMatchObject({
      refusal: { reason: 'organization-not-found' },
    });
    expect(store.insertReservation).not.toHaveBeenCalled();
  });

  it('publishes a reservation once and a committed retry returns the current version', async () => {
    const { store, work, clock, logo, reservation } = fixture();
    const publish = new PublishOrganizationLogo(work, clock);
    expect(await publish.execute({ ...actor, uploadId, expectedVersion: 7 })).toEqual({
      version: 8,
    });
    expect(store.saveLogo).toHaveBeenCalledOnce();
    expect(store.saveReservation).toHaveBeenCalledOnce();
    expect(store.appendLogoChanged).toHaveBeenCalledOnce();
    const committed = logo.publish(
      reservation,
      { ...actor, uploaderUserId: actorUserId, uploadId },
      { ...actor, uploaderUserId: actorUserId, uploadId },
      now,
      7,
    );
    store.lockLogo.mockResolvedValue(committed.logo);
    store.lockReservation.mockResolvedValue(committed.reservation);
    expect(await publish.execute({ ...actor, uploadId, expectedVersion: 7 })).toEqual({
      version: 8,
    });
    expect(store.appendLogoChanged).toHaveBeenCalledOnce();
  });

  it('refuses stale versions before saving and fences pending uploads on absent deletion', async () => {
    const { store, work, clock } = fixture();
    await expect(
      new PublishOrganizationLogo(work, clock).execute({ ...actor, uploadId, expectedVersion: 6 }),
    ).rejects.toMatchObject({ refusal: { reason: 'version-mismatch', version: 7 } });
    expect(store.saveLogo).not.toHaveBeenCalled();
    await expect(
      new RemoveOrganizationLogo(work).execute({ ...actor, expectedVersion: 6 }),
    ).rejects.toMatchObject({ refusal: { reason: 'version-mismatch', version: 7 } });
    expect(
      await new RemoveOrganizationLogo(work).execute({ ...actor, expectedVersion: 7 }),
    ).toEqual({ version: 7 });
    expect(store.saveLogo.mock.calls[0]?.[0].snapshot.generation).toBe(1);
    expect(store.appendLogoChanged).not.toHaveBeenCalled();
  });

  it('records a terminal expiry once and refuses reading an expired pending upload', async () => {
    const { store, work } = fixture();
    const clock = { now: () => new Date(now.getTime() + 300_000) };
    await expect(
      new GetOrganizationLogoUpload(work, clock).execute({ ...actor, uploadId }),
    ).rejects.toMatchObject({ reason: 'upload-expired' });
    const abandon = new AbandonOrganizationLogoUpload(work, clock);
    expect(
      await abandon.execute({ organizationId, uploaderUserId: actorUserId, uploadId }),
    ).toEqual({ abandoned: true });
    expect(store.appendUploadAbandoned).toHaveBeenCalledOnce();
    store.lockReservation.mockResolvedValue(store.saveReservation.mock.calls[0]?.[0]);
    expect(
      await abandon.execute({ organizationId, uploaderUserId: actorUserId, uploadId }),
    ).toEqual({ abandoned: false });
    expect(store.appendUploadAbandoned).toHaveBeenCalledOnce();
  });
});
