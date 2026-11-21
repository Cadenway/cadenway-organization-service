import type { InternalPrincipal, InternalTokenVerifier } from '@cadenway/nest-common';
import {
  InternalTokenGuard,
  runWithOrganizationContext,
  ZodValidationPipe,
} from '@cadenway/nest-common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { SearchMembershipReader } from '../../../../application/ports/outbound/persistence/search/search-membership-reader.port.js';
import type { SearchOrganizationsReader } from '../../../../application/ports/outbound/persistence/search/search-organizations-reader.port.js';
import { GetSearchMembership } from '../../../../application/use-cases/queries/search/get-search-membership/get-search-membership.use-case.js';
import { ListSearchOrganizations } from '../../../../application/use-cases/queries/search/list-search-organizations/list-search-organizations.use-case.js';
import { Member } from '../../../../domain/aggregates/member/member.aggregate.js';
import { GetSearchMembershipQuery } from '../../dto/input/search/get-search-membership-query.dto.js';
import { ListSearchOrganizationsQuery } from '../../dto/input/search/list-search-organizations-query.dto.js';
import { SearchOrganizationCursor } from '../../mappers/search/search-organization-cursor.mapper.js';
import { SearchAuthorityController } from './search-authority.controller.js';

const organizationId = '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12';
const upperId = '019a7002-2b3c-7d4e-8f5a-6b7c8d9e0f12';
const userId = '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31';
const memberId = '019a5f3d-1a2b-7c3d-8e4f-5a6b7c8d9e41';
const system = {
  actor: { type: 'system' as const, id: 'search-service' },
  organizationId: null,
  role: null,
  scopes: [],
};
const user = {
  actor: { type: 'user' as const, id: userId },
  organizationId,
  role: 'guest' as const,
  scopes: [],
};

/** Returns the execution context that lets the kit attach a verified principal to a request. */
function context(
  handler: 'list' | 'membership',
  request = { headers: { authorization: 'Bearer signed' } },
) {
  return {
    getClass: () => SearchAuthorityController,
    getHandler: () =>
      Object.getOwnPropertyDescriptor(SearchAuthorityController.prototype, handler)
        ?.value as unknown,
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** Gives direct controller tests the request state established by the shared token guard. */
async function verifiedRequest(
  handler: 'list' | 'membership',
  principal: Pick<InternalPrincipal, 'actor' | 'organizationId' | 'role' | 'scopes' | 'issuer'>,
) {
  const request = { headers: { authorization: 'Bearer signed' } };
  const verifier = { verify: vi.fn().mockResolvedValue(principal) };
  const guard = new InternalTokenGuard(
    verifier as unknown as InternalTokenVerifier,
    new Reflector(),
  );
  await guard.canActivate(context(handler, request));
  return request;
}

/** Builds the real use cases over controlled snapshot results. */
function fixture(cursor = new SearchOrganizationCursor(Buffer.alloc(32, 7).toString('base64url'))) {
  const read = vi.fn<SearchOrganizationsReader['read']>();
  const findActive = vi.fn<SearchMembershipReader['findActive']>();
  const controller = new SearchAuthorityController(
    new ListSearchOrganizations({ read }),
    new GetSearchMembership({ findActive }),
    cursor,
  );
  return { controller, cursor, read, findActive };
}

describe('SearchAuthorityController', () => {
  it.each(['search-service', 'identity-service'])(
    'requires the expected actor and tenant for issuer %s',
    async (issuer) => {
      const verifier = { verify: vi.fn() };
      const guard = new InternalTokenGuard(
        verifier as unknown as InternalTokenVerifier,
        new Reflector(),
      );
      verifier.verify.mockResolvedValue({ ...system, issuer });
      await expect(guard.canActivate(context('list'))).resolves.toBe(true);
      await expect(guard.canActivate(context('membership'))).rejects.toMatchObject({
        problem: { status: 403, code: 'auth.actor-not-allowed' },
      });
      verifier.verify.mockResolvedValue({ ...user, issuer });
      await expect(guard.canActivate(context('membership'))).resolves.toBe(true);
      await expect(guard.canActivate(context('list'))).rejects.toMatchObject({
        problem: { status: 403, code: 'auth.actor-not-allowed' },
      });
      verifier.verify.mockResolvedValueOnce({
        ...user,
        organizationId: null,
        issuer,
      });
      await expect(guard.canActivate(context('membership'))).rejects.toMatchObject({
        problem: { status: 403, code: 'auth.organization-required' },
      });
      verifier.verify.mockResolvedValueOnce({ ...system, issuer: 'api-gateway' });
      await expect(guard.canActivate(context('list'))).rejects.toMatchObject({
        problem: { status: 403, code: 'auth.issuer-not-allowed' },
      });
      verifier.verify.mockResolvedValueOnce({ ...user, issuer: 'api-gateway' });
      await expect(guard.canActivate(context('membership'))).rejects.toMatchObject({
        problem: { status: 403, code: 'auth.issuer-not-allowed' },
      });
    },
  );

  it('refuses a tenant claim or different actor ID before opening the global snapshot', async () => {
    const { controller, read } = fixture();
    const scoped = await verifiedRequest('list', {
      ...system,
      issuer: 'search-service',
      organizationId,
    });
    await expect(controller.list({ limit: 1 }, scoped)).rejects.toMatchObject({
      problem: { status: 403, code: 'auth.organization-not-allowed' },
    });
    const wrongActor = await verifiedRequest('list', { ...system, issuer: 'identity-service' });
    await expect(controller.list({ limit: 1 }, wrongActor)).rejects.toMatchObject({
      problem: { status: 403, code: 'auth.actor-not-allowed' },
    });
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    { role: 'admin', scopes: [] },
    { role: null, scopes: ['organizations:read'] },
  ])(
    'rejects delegated Identity privileges before reading membership',
    async ({ role, scopes }) => {
      const { controller, findActive } = fixture();
      const request = await verifiedRequest('membership', {
        ...user,
        issuer: 'identity-service',
        role,
        scopes,
      });
      await expect(controller.membership({}, request)).rejects.toMatchObject({
        problem: { status: 403, code: 'auth.actor-not-allowed' },
      });
      expect(findActive).not.toHaveBeenCalled();
    },
  );

  it('opens the bounded snapshot with one lookahead ID and signs its original fence', async () => {
    const { controller, cursor, read } = fixture();
    const request = await verifiedRequest('list', { ...system, issuer: 'search-service' });
    read.mockResolvedValueOnce({ upperId, items: [organizationId, upperId] });
    const first = await controller.list({ limit: 1 }, request);
    const position = { upperId, afterId: organizationId };

    expect(read).toHaveBeenCalledWith(null, 2);
    expect(first).toEqual({ items: [organizationId], nextCursor: cursor.write(position) });

    read.mockResolvedValueOnce({ upperId, items: [upperId] });
    const next = await controller.list(
      { limit: 1, cursor: first.nextCursor ?? undefined },
      request,
    );
    expect(read).toHaveBeenLastCalledWith(position, 2);
    expect(next).toEqual({ items: [upperId], nextCursor: null });
  });

  it('returns the live membership stamp independently of the export key and token role', async () => {
    const { controller, findActive, read } = fixture(new SearchOrganizationCursor(undefined));
    const listRequest = await verifiedRequest('list', { ...system, issuer: 'search-service' });
    await expect(controller.list({ limit: 1 }, listRequest)).rejects.toMatchObject({
      problem: { status: 503, code: 'organization.unavailable' },
    });
    expect(read).not.toHaveBeenCalled();

    findActive.mockResolvedValueOnce(
      Member.restore({
        id: memberId,
        organizationId,
        userId,
        role: 'admin',
        version: 2,
        joinedAt: new Date('2026-01-02T00:00:00.000Z'),
        invitationId: null,
        removedAt: null,
      }),
    );
    const memberRequest = await verifiedRequest('membership', {
      ...user,
      issuer: 'search-service',
    });
    await expect(
      runWithOrganizationContext(user, () => controller.membership({}, memberRequest)),
    ).resolves.toEqual({
      memberId,
      role: 'admin',
      version: 2,
    });
    expect(findActive).toHaveBeenCalledWith(organizationId, userId);
  });

  it('distinguishes absence from failure to read the membership snapshot', async () => {
    const { controller, findActive } = fixture();
    const scope = { ...user, role: null };
    const request = await verifiedRequest('membership', { ...scope, issuer: 'identity-service' });
    findActive.mockResolvedValueOnce(null);
    await expect(
      runWithOrganizationContext(scope, () => controller.membership({}, request)),
    ).rejects.toMatchObject({ problem: { status: 404, code: 'organization.not-found' } });
    findActive.mockRejectedValueOnce(new Error('Database error'));
    await expect(
      runWithOrganizationContext(scope, () => controller.membership({}, request)),
    ).rejects.toMatchObject({ problem: { status: 503, code: 'organization.unavailable' } });
  });

  it('applies the published limit and rejects query overrides of the signed scope', () => {
    const pipe = new ZodValidationPipe();
    const list = { type: 'query' as const, metatype: ListSearchOrganizationsQuery };
    const membership = { type: 'query' as const, metatype: GetSearchMembershipQuery };
    expect(pipe.transform({}, list)).toEqual({ limit: 50 });
    expect(pipe.transform({ limit: '100' }, list)).toEqual({ limit: 100 });
    expect(pipe.transform({}, membership)).toEqual({});
    expect(() => pipe.transform({ limit: '101' }, list)).toThrow();
    expect(() => pipe.transform({ organizationId }, list)).toThrow();
    expect(() => pipe.transform({ organizationId, userId }, membership)).toThrow();
  });
});
