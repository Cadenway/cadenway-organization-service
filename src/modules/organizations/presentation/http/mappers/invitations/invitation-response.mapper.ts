import type {
  Invitation,
  InvitationResult,
  InvitationState,
  ReceivedInvitation,
} from '@cadenway/contracts/types/internal/organization-service';

import type { InvitationOutcome } from '../../../../application/projections/invitations/invitation-outcome.projection.js';
import type { InvitationStateView } from '../../../../application/projections/invitations/invitation-state-view.projection.js';
import type { InvitationView } from '../../../../application/projections/invitations/invitation-view.projection.js';
import type { ReceivedInvitationView } from '../../../../application/projections/invitations/received-invitation-view.projection.js';

/**
 * Function toInvitationResponse
 *
 * @description
 * The `Invitation` of the contract. Its `version` gives the `ETag` of a resend.
 *
 * @param {InvitationView} view - The pending invitation.
 * @returns {Invitation} The body.
 */
export function toInvitationResponse(view: InvitationView): Invitation {
  return {
    id: view.id,
    email: view.email,
    role: view.role,
    invitedBy: { userId: view.invitedBy.userId, name: view.invitedBy.name },
    status: view.status,
    sentAt: view.sentAt.toISOString(),
    expiresAt: view.expiresAt.toISOString(),
    version: view.version,
  };
}

/**
 * Function toInvitationStateResponse
 *
 * @description
 * The `InvitationState` of the contract, dates in ISO 8601.
 *
 * @param {InvitationStateView} view - The invitation and its state.
 * @returns {InvitationState} The body.
 */
export function toInvitationStateResponse(view: InvitationStateView): InvitationState {
  return {
    id: view.id,
    email: view.email,
    role: view.role,
    invitedBy: { userId: view.invitedBy.userId, name: view.invitedBy.name },
    status: view.status,
    sentAt: view.sentAt.toISOString(),
    expiresAt: view.expiresAt.toISOString(),
    answeredAt: view.answeredAt?.toISOString() ?? null,
    revokedAt: view.revokedAt?.toISOString() ?? null,
    version: view.version,
  };
}

/**
 * Function toReceivedInvitationResponse
 *
 * @description
 * The `ReceivedInvitation` of the contract.
 *
 * @param {ReceivedInvitationView} view - The invitation addressed to the actor.
 * @returns {ReceivedInvitation} The item.
 */
export function toReceivedInvitationResponse(view: ReceivedInvitationView): ReceivedInvitation {
  return {
    id: view.id,
    organization: {
      id: view.organization.id,
      name: view.organization.name,
      slug: view.organization.slug,
      description: view.organization.description,
      memberCount: view.organization.memberCount,
    },
    role: view.role,
    invitedBy: { userId: view.invitedBy.userId, name: view.invitedBy.name },
    expiresAt: view.expiresAt.toISOString(),
  };
}

/**
 * Function toInvitationResultResponse
 *
 * @description
 * The `InvitationResult` of the contract.
 *
 * @param {InvitationOutcome} outcome - What became of one address.
 * @returns {InvitationResult} The entry.
 */
export function toInvitationResultResponse(outcome: InvitationOutcome): InvitationResult {
  return { email: outcome.email, outcome: outcome.outcome, invitationId: outcome.invitationId };
}
