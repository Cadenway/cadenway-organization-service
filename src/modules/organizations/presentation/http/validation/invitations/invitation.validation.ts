import {
  InviteMembersInternalHeader,
  InviteMembersKeyedInternalHeader,
} from '@cadenway/contracts/validators/internal/organization-service';

import { validateHeaders } from '../headers/header.validation.js';

/**
 * Function invitationBatchKey
 *
 * @description
 * Validates the optional `Idempotency-Key` of `POST /internal/v1/invitations` as the published
 * contract declares it (1 to 255 characters).
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

/**
 * Function requiredInvitationBatchKey
 *
 * @description
 * Validates the required `Idempotency-Key` of `POST /internal/v1/invitation-batches` as the
 * published contract declares it (present, 1 to 255 characters).
 *
 * @param {string | undefined} value - The header, if sent.
 * @returns {string} The key.
 * @throws {ProblemException} `400 request.invalid` for a missing key or one the contract refuses.
 */
export function requiredInvitationBatchKey(value: string | undefined): string {
  return validateHeaders(InviteMembersKeyedInternalHeader, { 'Idempotency-Key': value })[
    'Idempotency-Key'
  ];
}
