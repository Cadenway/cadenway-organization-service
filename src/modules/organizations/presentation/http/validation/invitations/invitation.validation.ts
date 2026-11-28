import { InviteMembersInternalHeader } from '@cadenway/contracts/validators/internal/organization-service';

import { validateHeaders } from '../headers/header.validation.js';

/**
 * Function invitationBatchKey
 *
 * @description
 * Validates the optional `Idempotency-Key` of an invitation batch as the published contract
 * declares it (1 to 255 characters).
 *
 * @param {string | undefined} value - The header, if sent.
 * @returns {string | undefined} The key, or `undefined` without one.
 * @throws {ProblemException} `400 request.invalid` for a key the contract refuses.
 */
export function invitationBatchKey(value: string | undefined): string | undefined {
  return validateHeaders(InviteMembersInternalHeader, { 'Idempotency-Key': value })[
    'Idempotency-Key'
  ];
}
