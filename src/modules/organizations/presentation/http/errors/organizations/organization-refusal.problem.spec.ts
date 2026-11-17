import { ProblemException } from '@cadenway/nest-common';
import { describe, expect, it } from 'vitest';

import { OrganizationRefusal } from '../../../../application/models/refusals/organization-refusal.model.js';
import type { Refusal } from '../../../../application/models/refusals/refusal.model.js';
import { answerRefusals } from './organization-refusal.problem.js';

/**
 * The problem a refusal answers.
 *
 * @param refusal - The refusal.
 * @returns The problem of the exception.
 */
async function problemOf(refusal: Refusal): Promise<unknown> {
  try {
    await answerRefusals(() => Promise.reject(new OrganizationRefusal(refusal)));
  } catch (error) {
    expect(error).toBeInstanceOf(ProblemException);
    return (error as ProblemException).getResponse();
  }
  throw new Error('The refusal was not answered.');
}

describe('answerRefusals', () => {
  it('answers each refusal with the status, code and details of the contract', async () => {
    const cases: readonly [Refusal, number, string, object | undefined][] = [
      [{ reason: 'organization-not-found' }, 404, 'organization.not-found', undefined],
      [{ reason: 'role-forbidden' }, 403, 'organization.role-forbidden', undefined],
      [{ reason: 'slug-taken', slug: 'lumen' }, 409, 'organization.slug-taken', { slug: 'lumen' }],
      [{ reason: 'slug-invalid', slug: 'e' }, 422, 'organization.slug-invalid', { slug: 'e' }],
      [{ reason: 'version-mismatch', version: 4 }, 412, 'request.version-mismatch', { version: 4 }],
      [{ reason: 'member-not-found' }, 404, 'member.not-found', undefined],
      [{ reason: 'owner-protected' }, 422, 'member.owner-protected', undefined],
      [{ reason: 'invitation-not-found' }, 404, 'invitation.not-found', undefined],
      [{ reason: 'invitation-email-mismatch' }, 403, 'invitation.email-mismatch', undefined],
      [{ reason: 'invitation-revoked' }, 409, 'invitation.revoked', undefined],
      [
        { reason: 'invitation-answered', status: 'refused' },
        409,
        'invitation.answered',
        { status: 'refused' },
      ],
      [
        { reason: 'invitation-expired', expiresAt: new Date('2026-11-02T15:00:00Z') },
        409,
        'invitation.expired',
        { expiresAt: '2026-11-02T15:00:00.000Z' },
      ],
      [{ reason: 'user-not-found' }, 404, 'user.not-found', undefined],
      [{ reason: 'user-not-synchronized' }, 404, 'user.not-synchronized', undefined],
      [
        { reason: 'invalid-field', field: 'website', code: 'invalid_format' },
        400,
        'request.invalid',
        {
          issues: [
            { in: 'body', path: 'website', code: 'invalid_format', message: 'Invalid value' },
          ],
        },
      ],
    ];

    for (const [refusal, status, code, details] of cases) {
      const problem: unknown = await problemOf(refusal);
      expect(problem).toMatchObject({ status, code });
      expect((problem as { details?: unknown }).details).toEqual(details);
    }
  });

  it('lets any other error through', async () => {
    const defect: Error = new Error('defect');

    await expect(answerRefusals(() => Promise.reject(defect))).rejects.toBe(defect);
    await expect(answerRefusals(() => Promise.resolve('done'))).resolves.toBe('done');
  });
});
