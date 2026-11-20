import {
  InternalTokenGuard,
  runWithOrganizationContext,
  ZodValidationPipe,
} from '@cadenway/nest-common';
import type { InternalTokenVerifier } from '@cadenway/nest-common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import type { LookupMemberNames } from '../../../../application/use-cases/queries/members/lookup-member-names/lookup-member-names.use-case.js';
import { MemberNameLookupBody } from '../../dto/input/members/member-name-lookup-body.dto.js';
import { MemberNamesController } from './member-names.controller.js';

describe('MemberNamesController', () => {
  const organizationId = '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12';
  const actorUserId = '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31';
  const userId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';

  it('restricts its internal access to gateway user actors and the required organization', () => {
    expect(Reflect.getMetadata('cadenway:internal-access', MemberNamesController)).toEqual({
      issuers: ['api-gateway'],
      actors: ['user'],
    });
  });

  it('enforces issuer, actor and organization on the shared token guard', async () => {
    const principal = {
      issuer: 'api-gateway',
      actor: { type: 'user', id: actorUserId },
      organizationId,
    };
    const verifier = { verify: vi.fn().mockResolvedValue(principal) };
    const guard = new InternalTokenGuard(
      verifier as unknown as InternalTokenVerifier,
      new Reflector(),
    );
    const context = {
      getClass: () => MemberNamesController,
      getHandler: () => MemberNamesController,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer signed' } }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    verifier.verify.mockResolvedValueOnce({ ...principal, issuer: 'other-service' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      problem: { status: 403, code: 'auth.issuer-not-allowed' },
    });
    verifier.verify.mockResolvedValueOnce({ ...principal, actor: { type: 'system', id: null } });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      problem: { status: 403, code: 'auth.actor-not-allowed' },
    });
    verifier.verify.mockResolvedValueOnce({ ...principal, organizationId: null });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      problem: { status: 403, code: 'auth.organization-required' },
    });
  });

  it('maps the verified caller and exposes only account IDs and names', async () => {
    const execute = vi.fn().mockResolvedValue({
      items: [{ userId, name: 'Camille Martin', email: 'private@example.test' }],
    });
    const controller = new MemberNamesController({ execute } as unknown as LookupMemberNames);
    const result = await runWithOrganizationContext(
      { organizationId, actor: { type: 'user', id: actorUserId }, role: 'guest', scopes: [] },
      () => controller.lookup({ userIds: [userId] }),
    );
    expect(execute).toHaveBeenCalledWith({ organizationId, actorUserId, userIds: [userId] });
    expect(result).toEqual({ items: [{ userId, name: 'Camille Martin' }] });
  });

  it('refuses a missing actor or organization before invoking the use case', async () => {
    const execute = vi.fn();
    const controller = new MemberNamesController({ execute } as unknown as LookupMemberNames);
    await expect(controller.lookup({ userIds: [userId] })).rejects.toMatchObject({
      problem: { status: 403, code: 'auth.actor-not-allowed' },
    });
    await expect(
      runWithOrganizationContext(
        { organizationId: null, actor: { type: 'user', id: actorUserId }, role: null, scopes: [] },
        () => controller.lookup({ userIds: [userId] }),
      ),
    ).rejects.toMatchObject({ problem: { status: 403, code: 'auth.organization-required' } });
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires the published JSON body with one to 5,000 valid UUIDs', () => {
    const pipe = new ZodValidationPipe();
    const metadata = { type: 'body' as const, metatype: MemberNameLookupBody };
    expect(pipe.transform({ userIds: [userId] }, metadata)).toEqual({ userIds: [userId] });
    for (const body of [undefined, {}, { userIds: [] }, { userIds: ['invalid'] }]) {
      expect(() => pipe.transform(body, metadata)).toThrow();
    }
    expect(
      MemberNameLookupBody.schema.safeParse({ userIds: Array(5000).fill(userId) }).success,
    ).toBe(true);
    expect(
      MemberNameLookupBody.schema.safeParse({ userIds: Array(5001).fill(userId) }).success,
    ).toBe(false);
  });
});
