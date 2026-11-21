import { ProblemException } from '@cadenway/nest-common';
import type { ProblemStatus } from '@cadenway/nest-common';

import { OrganizationRefusal } from '../../../../application/models/refusals/organization-refusal.model.js';
import type { Refusal } from '../../../../application/models/refusals/refusal.model.js';

/**
 * Interface ProblemShape
 *
 * @description
 * The status, code and details a refusal answers, as `openapi/internal/organization-service.yaml`
 * declares them. The titles stay the English reason phrases of the statuses: the gateway answers
 * the French titles of the public specs.
 */
interface ProblemShape {
  // #region Properties
  /**
   * Property status
   *
   * @description
   * HTTP status of the problem.
   *
   * @type {ProblemStatus}
   * @readonly
   */
  readonly status: ProblemStatus;

  /**
   * Property code
   *
   * @description
   * Stable machine code of the contract.
   *
   * @type {string}
   * @readonly
   */
  readonly code: string;

  /**
   * Property details
   *
   * @description
   * The values the gateway forwards, dates in ISO 8601.
   *
   * @type {Readonly<Record<string, unknown>> | undefined}
   * @readonly
   */
  readonly details?: Readonly<Record<string, unknown>>;

  /**
   * Property retryAt
   *
   * @description
   * When the request can succeed, for the `Retry-After` header of a 429.
   *
   * @type {Date | undefined}
   * @readonly
   */
  readonly retryAt?: Date;
  // #endregion
}

/**
 * Function shapeOf
 *
 * @description
 * Maps a refusal to its problem. An actor outside the organization of the token, and a member or
 * an invitation of another organization, answer 404, never 403 (decision 9 of P2b).
 *
 * @param {Refusal} refusal - The refusal.
 * @returns {ProblemShape} The problem of the contract.
 */
function shapeOf(refusal: Refusal): ProblemShape {
  switch (refusal.reason) {
    case 'invalid-field':
      return {
        status: 400,
        code: 'request.invalid',
        details: {
          issues: [
            { in: 'body', path: refusal.field, code: refusal.code, message: 'Invalid value' },
          ],
        },
      };
    case 'organization-not-found':
      return { status: 404, code: 'organization.not-found' };
    case 'role-forbidden':
      return { status: 403, code: 'organization.role-forbidden' };
    case 'seat-quota-exceeded':
      return { status: 409, code: 'organization.seat-quota-exceeded' };
    case 'slug-taken':
      return { status: 409, code: 'organization.slug-taken', details: { slug: refusal.slug } };
    case 'slug-invalid':
      return { status: 422, code: 'organization.slug-invalid', details: { slug: refusal.slug } };
    case 'version-mismatch':
      return {
        status: 412,
        code: 'request.version-mismatch',
        details: { version: refusal.version },
      };
    case 'member-not-found':
      return { status: 404, code: 'member.not-found' };
    case 'owner-protected':
      return { status: 422, code: 'member.owner-protected' };
    case 'invitation-not-found':
      return { status: 404, code: 'invitation.not-found' };
    case 'invitation-email-mismatch':
      return { status: 403, code: 'invitation.email-mismatch' };
    case 'invitation-revoked':
      return { status: 409, code: 'invitation.revoked' };
    case 'invitation-answered':
      return { status: 409, code: 'invitation.answered', details: { status: refusal.status } };
    case 'invitation-expired':
      return {
        status: 409,
        code: 'invitation.expired',
        details: { expiresAt: refusal.expiresAt.toISOString() },
      };
    case 'invitation-resend-throttled':
      return {
        status: 429,
        code: 'invitation.resend-throttled',
        details: { resendAvailableAt: refusal.resendAvailableAt.toISOString() },
        retryAt: refusal.resendAvailableAt,
      };
    case 'invitation-daily-limit-reached':
      return {
        status: 429,
        code: 'invitation.daily-limit-reached',
        details: {
          remaining: refusal.remaining,
          nextAvailableAt: refusal.nextAvailableAt.toISOString(),
        },
        retryAt: refusal.nextAvailableAt,
      };
    case 'user-not-found':
      return { status: 404, code: 'user.not-found' };
    case 'user-not-synchronized':
      return { status: 404, code: 'user.not-synchronized' };
  }
}

/**
 * Function answerRefusals
 *
 * @description
 * Runs a use case and turns its `OrganizationRefusal` into the problem of the contract; any other
 * error passes through to the `ProblemFilter` of the kit. A 429 also sets `Retry-After` on the
 * response, the seconds until the request can succeed, rounded up and 1 at least, as the contract
 * declares on `InvitationBatchLimited` and `InvitationResendLimited`: the routes that can answer
 * one pass their response.
 *
 * @param {() => Promise<TResult>} work - The call of the use case.
 * @param {{ readonly setHeader: (name: string, value: string) => unknown } | undefined} response -
 * The response, for `Retry-After`.
 * @returns {Promise<TResult>} What the use case resolved with.
 * @throws {ProblemException} For a refusal of the use case.
 */
export async function answerRefusals<TResult>(
  work: () => Promise<TResult>,
  response?: { readonly setHeader: (name: string, value: string) => unknown },
): Promise<TResult> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof OrganizationRefusal)) {
      throw error;
    }
    const shape: ProblemShape = shapeOf(error.refusal);
    if (shape.retryAt !== undefined && response !== undefined) {
      const seconds: number = Math.ceil((shape.retryAt.getTime() - Date.now()) / 1000);
      response.setHeader('Retry-After', String(Math.max(1, seconds)));
    }
    throw new ProblemException({
      status: shape.status,
      code: shape.code,
      ...(shape.details === undefined ? {} : { details: shape.details }),
    });
  }
}
