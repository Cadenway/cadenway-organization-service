import { OrganizationLogoError } from '../../../domain/errors/logo/organization-logo.error.js';
import { OrganizationLogoRefusal } from '../../models/logo/organization-logo-refusal.model.js';
import { toOrganizationRefusal } from './organization-refusal.mapper.js';

/** Translates only known domain refusals while preserving unexpected failures. */
export function toOrganizationLogoRefusal(error: unknown): unknown {
  const mapped = toOrganizationRefusal(error);
  if (!(mapped instanceof OrganizationLogoError)) return mapped;
  if (mapped.reason === 'version-mismatch') {
    return new Error('The logo version refusal must include the current profile version.');
  }
  return new OrganizationLogoRefusal(mapped.reason);
}
