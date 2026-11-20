import { ProblemException } from '@cadenway/nest-common';
import { describe, expect, it } from 'vitest';

import { OrganizationRefusal } from '../../../../application/models/refusals/organization-refusal.model.js';
import { OrganizationLogoRefusal } from '../../../../application/models/logo/organization-logo-refusal.model.js';
import { answerLogoRefusals } from './logo-refusal.problem.js';

describe('answerLogoRefusals', () => {
  it.each([
    ['file-too-large', 422, 'media.file-too-large'],
    ['unsupported-type', 422, 'media.unsupported-type'],
    ['idempotency-key-reused', 422, 'idempotency.key-reused'],
    ['not-found', 404, 'media.not-found'],
    ['upload-expired', 409, 'media.upload-expired'],
    ['upload-superseded', 409, 'media.upload-superseded'],
    ['upload-not-ready', 409, 'media.upload-not-ready'],
  ] as const)('maps %s to the published problem', async (reason, status, code) => {
    const promise = answerLogoRefusals(() => Promise.reject(new OrganizationLogoRefusal(reason)));
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({ status, code }) as unknown,
    });
  });

  it('preserves the organization mismatch version for 412 responses', async () => {
    const promise = answerLogoRefusals(() =>
      Promise.reject(new OrganizationRefusal({ reason: 'version-mismatch', version: 4 })),
    );
    await expect(promise).rejects.toMatchObject({
      response: expect.objectContaining({
        status: 412,
        code: 'request.version-mismatch',
        details: { version: 4 },
      }) as unknown,
    });
  });

  it('propagates unknown errors for the common exception filter', async () => {
    const failure = new Error('unexpected');
    await expect(answerLogoRefusals(() => Promise.reject(failure))).rejects.toBe(failure);
    expect(failure).not.toBeInstanceOf(ProblemException);
  });
});
