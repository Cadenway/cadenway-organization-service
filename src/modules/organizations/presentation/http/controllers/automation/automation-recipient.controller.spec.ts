import {
  InternalTokenGuard,
  runWithOrganizationContext,
  ZodValidationPipe,
} from '@cadenway/nest-common';
import type { InternalTokenVerifier } from '@cadenway/nest-common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

import { OrganizationRefusal } from '../../../../application/models/refusals/organization-refusal.model.js';
import type { CheckAutomationRecipient } from '../../../../application/use-cases/queries/automation/check-automation-recipient/check-automation-recipient.use-case.js';
import { AutomationRecipientCheckBody } from '../../dto/input/automation/automation-recipient-check-body.dto.js';
import { AutomationRecipientController } from './automation-recipient.controller.js';

const organizationId = '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12';
const actorUserId = '019a5f3c-9e1f-7b2a-8c3d-4e5f6a7b8c31';
const userId = '019a5f3c-8d2e-7c4a-9b1f-3e5d7a9c1b30';
const scope = {
  organizationId,
  actor: { type: 'user' as const, id: actorUserId },
  role: 'member' as const,
  scopes: [],
};

describe('AutomationRecipientController', () => {
  it('requires the gateway user and signed organization through the common guard', async () => {
    const principal = { issuer: 'api-gateway', actor: scope.actor, organizationId };
    const verifier = { verify: vi.fn().mockResolvedValue(principal) };
    const guard = new InternalTokenGuard(
      verifier as unknown as InternalTokenVerifier,
      new Reflector(),
    );
    const context = {
      getClass: () => AutomationRecipientController,
      getHandler: () => AutomationRecipientController,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer signed' } }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    verifier.verify.mockResolvedValueOnce({ ...principal, issuer: 'another-service' });
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

  it('returns only eligibility using the signed identity and tenant', async () => {
    const execute = vi.fn().mockResolvedValue({ eligible: true, role: 'admin' });
    const controller = new AutomationRecipientController({
      execute,
    } as unknown as CheckAutomationRecipient);
    const result = await runWithOrganizationContext(scope, () => controller.check({ userId }));
    expect(execute).toHaveBeenCalledWith({ organizationId, actorUserId, userId });
    expect(result).toEqual({ eligible: true });
  });

  it('maps authorization refusals and hides unexpected snapshot failures', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new OrganizationRefusal({ reason: 'role-forbidden' }))
      .mockRejectedValueOnce(new OrganizationRefusal({ reason: 'organization-not-found' }))
      .mockRejectedValueOnce(new Error('private database details'));
    const controller = new AutomationRecipientController({
      execute,
    } as unknown as CheckAutomationRecipient);
    await runWithOrganizationContext(scope, async () => {
      await expect(controller.check({ userId })).rejects.toMatchObject({
        problem: { status: 403, code: 'organization.role-forbidden' },
      });
      await expect(controller.check({ userId })).rejects.toMatchObject({
        problem: { status: 404, code: 'organization.not-found' },
      });
      await expect(controller.check({ userId })).rejects.toMatchObject({
        problem: { status: 503, code: 'organization.unavailable' },
      });
    });
  });

  it('accepts only the published strict UUIDv7 body', () => {
    const pipe = new ZodValidationPipe();
    const metadata = { type: 'body' as const, metatype: AutomationRecipientCheckBody };
    expect(pipe.transform({ userId: userId.toUpperCase() }, metadata)).toEqual({
      userId: userId.toUpperCase(),
    });
    for (const body of [undefined, {}, { userId: 'invalid' }, { userId, extra: true }]) {
      expect(() => pipe.transform(body, metadata)).toThrow();
    }
  });
});
