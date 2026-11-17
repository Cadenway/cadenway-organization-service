import { getOrganizationContext, ProblemException } from '@cadenway/nest-common';
import type { OrganizationContext } from '@cadenway/nest-common';

/**
 * Function toActorUserId
 *
 * @description
 * The user the verified internal token acts for. The guard has already refused any other actor,
 * so a missing user here is a defect of the wiring, answered like the guard would.
 *
 * @returns {string} The id of the user.
 * @throws {ProblemException} `403 auth.actor-not-allowed` without a user actor.
 */
export function toActorUserId(): string {
  const context: OrganizationContext | undefined = getOrganizationContext();
  if (context?.actor.type !== 'user' || context.actor.id === null) {
    throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
  }
  return context.actor.id;
}

/**
 * Function toOrganizationId
 *
 * @description
 * The organization of the verified internal token, the only source of the organization of a
 * request: never a path, a query string or a body. The guard has already refused a token without
 * one on a route that requires it.
 *
 * @returns {string} The id of the organization.
 * @throws {ProblemException} `403 auth.organization-required` without an organization.
 */
export function toOrganizationId(): string {
  const organizationId: string | null = getOrganizationContext()?.organizationId ?? null;
  if (organizationId === null) {
    throw new ProblemException({ status: 403, code: 'auth.organization-required' });
  }
  return organizationId;
}
