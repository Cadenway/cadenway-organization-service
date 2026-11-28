import { InvalidEmailAddressError } from '../../../domain/errors/directory/invalid-email-address.error.js';
import { OrganizationLogoError } from '../../../domain/errors/logo/organization-logo.error.js';
import { InvitationAnsweredError } from '../../../domain/errors/invitations/invitation-answered.error.js';
import { InvitationBatchKeyReusedError } from '../../../domain/errors/invitations/invitation-batch-key-reused.error.js';
import { InvitationDailyLimitReachedError } from '../../../domain/errors/invitations/invitation-daily-limit-reached.error.js';
import { InvitationExpiredError } from '../../../domain/errors/invitations/invitation-expired.error.js';
import { InvitationResendThrottledError } from '../../../domain/errors/invitations/invitation-resend-throttled.error.js';
import { InvitationRevokedError } from '../../../domain/errors/invitations/invitation-revoked.error.js';
import { MemberRemovedError } from '../../../domain/errors/members/member-removed.error.js';
import { OwnerProtectedError } from '../../../domain/errors/members/owner-protected.error.js';
import { RoleForbiddenError } from '../../../domain/errors/members/role-forbidden.error.js';
import { InvalidDescriptionError } from '../../../domain/errors/organizations/invalid-description.error.js';
import { InvalidOrganizationNameError } from '../../../domain/errors/organizations/invalid-organization-name.error.js';
import { InvalidWebsiteError } from '../../../domain/errors/organizations/invalid-website.error.js';
import { SlugInvalidError } from '../../../domain/errors/organizations/slug-invalid.error.js';
import { SlugReservedError } from '../../../domain/errors/organizations/slug-reserved.error.js';
import { SlugTakenError } from '../../../domain/errors/organizations/slug-taken.error.js';
import { OrganizationRefusal } from '../../models/refusals/organization-refusal.model.js';
import type { Refusal } from '../../models/refusals/refusal.model.js';

/**
 * Function refusalOf
 *
 * @description
 * The refusal a domain error stands for, or `null` for any other error.
 *
 * @param {unknown} error - What a use case caught.
 * @returns {Refusal | null} The refusal.
 */
function refusalOf(error: unknown): Refusal | null {
  if (
    error instanceof OrganizationLogoError &&
    error.reason === 'version-mismatch' &&
    error.version !== undefined
  ) {
    return { reason: 'version-mismatch', version: error.version };
  }
  if (error instanceof InvalidOrganizationNameError) {
    return { reason: 'invalid-field', field: 'name', code: 'too_small' };
  }
  if (error instanceof InvalidDescriptionError) {
    return { reason: 'invalid-field', field: 'description', code: 'too_big' };
  }
  if (error instanceof InvalidWebsiteError) {
    return { reason: 'invalid-field', field: 'website', code: 'invalid_format' };
  }
  if (error instanceof InvalidEmailAddressError) {
    return { reason: 'invalid-field', field: 'emails', code: 'invalid_format' };
  }
  if (error instanceof SlugInvalidError) {
    return { reason: 'slug-invalid', slug: error.slug };
  }
  if (error instanceof SlugReservedError) {
    return { reason: 'slug-reserved', slug: error.slug };
  }
  if (error instanceof SlugTakenError) {
    return { reason: 'slug-taken', slug: error.slug };
  }
  if (error instanceof RoleForbiddenError) {
    return { reason: 'role-forbidden' };
  }
  if (error instanceof OwnerProtectedError) {
    return { reason: 'owner-protected' };
  }
  if (error instanceof MemberRemovedError) {
    return { reason: 'member-not-found' };
  }
  if (error instanceof InvitationRevokedError) {
    return { reason: 'invitation-revoked' };
  }
  if (error instanceof InvitationAnsweredError) {
    return { reason: 'invitation-answered', status: error.status };
  }
  if (error instanceof InvitationExpiredError) {
    return { reason: 'invitation-expired', expiresAt: error.expiresAt };
  }
  if (error instanceof InvitationResendThrottledError) {
    return { reason: 'invitation-resend-throttled', resendAvailableAt: error.resendAvailableAt };
  }
  if (error instanceof InvitationDailyLimitReachedError) {
    return {
      reason: 'invitation-daily-limit-reached',
      remaining: error.remaining,
      nextAvailableAt: error.nextAvailableAt,
    };
  }
  if (error instanceof InvitationBatchKeyReusedError) {
    return { reason: 'idempotency-key-reused' };
  }
  return null;
}

/**
 * Function toOrganizationRefusal
 *
 * @description
 * Turns a domain error a use case caught into the `OrganizationRefusal` the presentation answers;
 * an `OrganizationRefusal` and any unexpected error pass through unchanged.
 *
 * @param {unknown} error - What a use case caught.
 * @returns {unknown} The refusal, or the error itself.
 */
export function toOrganizationRefusal(error: unknown): unknown {
  const refusal: Refusal | null = refusalOf(error);
  return refusal === null ? error : new OrganizationRefusal(refusal);
}
