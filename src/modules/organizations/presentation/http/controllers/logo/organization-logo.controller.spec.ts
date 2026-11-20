import { runWithOrganizationContext } from '@cadenway/nest-common';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { PublishOrganizationLogo } from '../../../../application/use-cases/commands/logo/publish-organization-logo/publish-organization-logo.use-case.js';
import type { RemoveOrganizationLogo } from '../../../../application/use-cases/commands/logo/remove-organization-logo/remove-organization-logo.use-case.js';
import type { ReserveOrganizationLogoUpload } from '../../../../application/use-cases/commands/logo/reserve-organization-logo-upload/reserve-organization-logo-upload.use-case.js';
import type { GetOrganizationLogoUpload } from '../../../../application/use-cases/queries/logo/get-organization-logo-upload/get-organization-logo-upload.use-case.js';
import { OrganizationLogoController } from './organization-logo.controller.js';

const organizationId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b2f';
const actorUserId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const uploadId = '019a7003-4d5e-7f6a-8b9c-0d1e2f3a4b01';
const expiresAt = new Date('2026-11-20T12:05:00Z');

function fixture() {
  const reserve = vi.fn().mockResolvedValue({ uploadId, expiresAt });
  const lookup = vi.fn().mockResolvedValue({ uploadId, expiresAt, state: 'pending' });
  const publish = vi.fn().mockResolvedValue({ version: 8 });
  const remove = vi.fn().mockResolvedValue({ version: 9 });
  const setHeader = vi.fn();
  const response = { setHeader } as unknown as Response;
  const controller = new OrganizationLogoController(
    { execute: reserve } as unknown as ReserveOrganizationLogoUpload,
    { execute: lookup } as unknown as GetOrganizationLogoUpload,
    { execute: publish } as unknown as PublishOrganizationLogo,
    { execute: remove } as unknown as RemoveOrganizationLogo,
  );
  const context = {
    organizationId,
    actor: { type: 'user' as const, id: actorUserId },
    role: null,
    scopes: [],
  };
  return { controller, reserve, lookup, publish, remove, response, setHeader, context };
}

describe('OrganizationLogoController', () => {
  it('binds the owner reservation to the verified actor and returns its Location', async () => {
    const { controller, reserve, response, setHeader, context } = fixture();
    const result = await runWithOrganizationContext(context, () =>
      controller.start({ contentType: 'image/png', sizeBytes: 50 }, 'key-1', response),
    );

    expect(result).toEqual({ uploadId, expiresAt: expiresAt.toISOString() });
    expect(reserve).toHaveBeenCalledExactlyOnceWith({
      organizationId,
      actorUserId,
      contentType: 'image/png',
      sizeBytes: 50,
      idempotencyKey: 'key-1',
    });
    expect(setHeader).toHaveBeenCalledWith(
      'Location',
      `/internal/v1/organization/logo/uploads/${uploadId}`,
    );
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('returns only the current upload state and result version', async () => {
    const { controller, lookup, publish, remove, response, setHeader, context } = fixture();
    const headers = {
      'if-none-match': '*',
      'if-modified-since': 'Fri, 20 Nov 2026 12:00:00 GMT',
    };
    const request = { headers } as Request;
    const state = await runWithOrganizationContext(context, () =>
      controller.read({ uploadId }, request, response),
    );
    expect(headers).toEqual({});
    expect(state).toEqual({ uploadId, state: 'pending', expiresAt: expiresAt.toISOString() });
    expect(lookup).toHaveBeenCalledExactlyOnceWith({ organizationId, actorUserId, uploadId });
    await runWithOrganizationContext(context, () => controller.set({ uploadId }, '"7"', response));
    expect(publish).toHaveBeenCalledExactlyOnceWith({
      organizationId,
      actorUserId,
      uploadId,
      expectedVersion: 7,
    });
    expect(setHeader).toHaveBeenCalledWith('ETag', '"8"');
    await runWithOrganizationContext(context, () => controller.clear(undefined, response));
    expect(remove).toHaveBeenCalledExactlyOnceWith({ organizationId, actorUserId });
    expect(setHeader).toHaveBeenCalledWith('ETag', '"9"');
  });
});
