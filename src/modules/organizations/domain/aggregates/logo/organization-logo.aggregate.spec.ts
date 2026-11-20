import { describe, expect, it } from 'vitest';

import { OrganizationLogoError } from '../../errors/logo/organization-logo.error.js';
import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import { OrganizationLogo } from './organization-logo.aggregate.js';
import { OrganizationLogoReservation } from './organization-logo-reservation.aggregate.js';

const atelierNord = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';
const camille = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const ines = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b31';
const firstUpload = '019a7003-4d5e-7f6a-8b9c-0d1e2f3a4b01';
const secondUpload = '019a7003-4d5e-7f6a-8b9c-0d1e2f3a4b02';
const openedAt = new Date('2026-11-08T08:00:00Z');
const expiresAt = new Date('2026-11-08T08:05:00Z');
const png = { contentType: 'image/png', sizeBytes: 184_320 } as const;

function binding(uploadId = firstUpload) {
  return { uploadId, organizationId: atelierNord, uploaderUserId: camille };
}

function emptyLogo(): OrganizationLogo {
  return OrganizationLogo.restore({
    organizationId: atelierNord,
    assetId: null,
    generation: 0,
    profileVersion: 7,
  });
}

function reserve(logo: OrganizationLogo = emptyLogo(), uploadId = firstUpload) {
  return logo.reserve(binding(uploadId), png, openedAt, expiresAt);
}

describe('organization logo reservation', () => {
  it('accepts PNG and SVG declarations through the inclusive 5 MiB limit', () => {
    const reservation = emptyLogo().reserve(
      binding(),
      { contentType: 'image/svg+xml', sizeBytes: 5_242_880 },
      openedAt,
      expiresAt,
    );

    expect(reservation.snapshot).toMatchObject({
      organizationId: atelierNord,
      uploaderUserId: camille,
      uploadId: firstUpload,
      generation: 0,
      state: 'pending',
      declaration: { contentType: 'image/svg+xml', sizeBytes: 5_242_880 },
    });
  });

  it.each([
    [{ contentType: 'image/jpeg', sizeBytes: 100 }, 'unsupported-type'],
    [{ contentType: 'image/png', sizeBytes: 5_242_881 }, 'file-too-large'],
    [{ contentType: 'image/png', sizeBytes: 0 }, 'invalid-declaration'],
    [{ contentType: 'image/png', sizeBytes: 4.5 }, 'invalid-declaration'],
  ])('refuses declaration %j with %s', (declaration, reason) => {
    expect(() => emptyLogo().reserve(binding(), declaration, openedAt, expiresAt)).toThrow(
      expect.objectContaining({ reason }),
    );
  });

  it('replays the same declaration and expiry independently of later publication state', () => {
    const reservation = reserve();
    const finished = emptyLogo().publish(reservation, binding(), binding(), openedAt);

    expect(finished.reservation.replay(binding(), png)).toEqual({
      uploadId: firstUpload,
      expiresAt,
    });
    expect(() => finished.reservation.replay(binding(), { ...png, sizeBytes: 1 })).toThrow(
      expect.objectContaining({ reason: 'idempotency-key-reused' }),
    );
  });

  it('conceals another uploader, organization or upload identifier', () => {
    const reservation = reserve();
    const unrelated = [
      { ...binding(), uploaderUserId: ines },
      { ...binding(), organizationId: ines },
      binding(secondUpload),
    ];

    for (const identity of unrelated) {
      expect(() => reservation.read(identity, 0, openedAt)).toThrow(
        expect.objectContaining({ reason: 'not-found' }),
      );
    }
    expect(reservation.read(binding(firstUpload.toUpperCase()), 0, openedAt)).toBe('pending');
  });

  it('expires exactly at the exclusive deadline and never extends it', () => {
    const deadline = new Date(expiresAt);
    const reservation = emptyLogo().reserve(binding(), png, openedAt, deadline);
    deadline.setTime(0);
    reservation.snapshot.expiresAt.setTime(0);

    expect(reservation.snapshot.expiresAt).toEqual(expiresAt);
    expect(reservation.read(binding(), 0, new Date(expiresAt.getTime() - 1))).toBe('pending');
    expect(() => reservation.read(binding(), 0, expiresAt)).toThrow(
      expect.objectContaining({ reason: 'upload-expired' }),
    );
  });

  it('emits one terminal abandonment fact for a superseded or expired reservation', () => {
    const reservation = reserve();
    expect(reservation.abandon(0, openedAt)).toEqual({ reservation, event: null });

    const expired = reservation.abandon(0, expiresAt);
    expect(expired.reservation.snapshot.state).toBe('expired');
    expect(expired.event).toEqual({ organizationId: atelierNord, uploadId: firstUpload });
    expect(expired.reservation.abandon(1, expiresAt).event).toBeNull();

    const superseded = reservation.abandon(1, openedAt);
    expect(superseded.reservation.snapshot.state).toBe('superseded');
    expect(superseded.event).toEqual(expired.event);
    expect(() => superseded.reservation.read(binding(), 1, openedAt)).toThrow(
      expect.objectContaining({ reason: 'upload-superseded' }),
    );
  });

  it('refuses malformed stored state and an invalid new expiry', () => {
    expect(() =>
      OrganizationLogoReservation.restore({ ...reserve().snapshot, generation: -1 }),
    ).toThrow(InvalidStoredStateError);
    expect(() => emptyLogo().reserve(binding(), png, openedAt, openedAt)).toThrow(
      InvalidStoredStateError,
    );
  });
});

describe('organization logo reference', () => {
  it('requires Storage confirmation bound to the exact pending upload, tenant and uploader', () => {
    const logo = emptyLogo();
    const reservation = reserve();
    const mismatches = [
      null,
      binding(secondUpload),
      { ...binding(), organizationId: ines },
      { ...binding(), uploaderUserId: ines },
    ];

    for (const preparation of mismatches) {
      expect(() => logo.publish(reservation, binding(), preparation, openedAt)).toThrow(
        expect.objectContaining({ reason: 'upload-not-ready' }),
      );
    }
    expect(logo.snapshot.assetId).toBeNull();
    expect(reservation.snapshot.state).toBe('pending');
  });

  it('changes the opaque reference and both versions only when publication succeeds', () => {
    const start = emptyLogo();
    const first = start.publish(reserve(), binding(), binding(), openedAt, 7);
    const second = first.logo.publish(
      reserve(first.logo, secondUpload),
      binding(secondUpload),
      binding(secondUpload),
      openedAt,
      8,
    );

    expect(first.logo.snapshot).toMatchObject({
      assetId: firstUpload,
      profileVersion: 8,
      generation: 1,
    });
    expect(first.reservation.snapshot.state).toBe('committed');
    expect(first.event).toEqual({
      organizationId: atelierNord,
      actorUserId: camille,
      assetId: firstUpload,
      oldAssetId: null,
      generation: 1,
    });
    expect(second.logo.snapshot).toMatchObject({
      assetId: secondUpload,
      profileVersion: 9,
      generation: 2,
    });
    expect(second.event).toMatchObject({ assetId: secondUpload, oldAssetId: firstUpload });
  });

  it('returns the current ETag on an old committed replay after replacement, with no Storage call', () => {
    const first = emptyLogo().publish(reserve(), binding(), binding(), openedAt);
    const second = first.logo.publish(
      reserve(first.logo, secondUpload),
      binding(secondUpload),
      binding(secondUpload),
      openedAt,
    );

    const replay = second.logo.publish(first.reservation, binding(), null, expiresAt, 7);
    expect(replay).toEqual({ logo: second.logo, reservation: first.reservation, event: null });
    expect(replay.logo.snapshot.profileVersion).toBe(9);
    expect(first.reservation.abandon(2, expiresAt).event).toBeNull();
  });

  it('refuses a stale If-Match on first publication and on removal', () => {
    const logo = emptyLogo();
    expect(() => logo.publish(reserve(), binding(), binding(), openedAt, 6)).toThrow(
      expect.objectContaining({ reason: 'version-mismatch' }),
    );
    expect(() => logo.remove(camille, 6)).toThrow(OrganizationLogoError);
  });

  it('invalidates older pending uploads when removing even an absent logo', () => {
    const empty = emptyLogo();
    const reservation = reserve();
    const cleared = empty.remove(camille, 7);
    expect(cleared.logo.snapshot).toMatchObject({
      assetId: null,
      generation: 1,
      profileVersion: 7,
    });
    expect(cleared.event).toBeNull();
    expect(() => cleared.logo.publish(reservation, binding(), binding(), openedAt)).toThrow(
      expect.objectContaining({ reason: 'upload-superseded' }),
    );
  });

  it('retires a visible logo once and does not reinstate it on replay', () => {
    const first = emptyLogo().publish(reserve(), binding(), binding(), openedAt);
    const removed = first.logo.remove(ines, 8);

    expect(removed.logo.snapshot).toMatchObject({
      assetId: null,
      generation: 2,
      profileVersion: 9,
    });
    expect(removed.event).toEqual({
      organizationId: atelierNord,
      actorUserId: ines,
      assetId: null,
      oldAssetId: firstUpload,
      generation: 2,
    });
    expect(removed.logo.remove(ines, 9).event).toBeNull();
    expect(removed.logo.publish(first.reservation, binding(), null, expiresAt).event).toBeNull();
  });
});
