import { DomainError } from '../organizations/domain.error.js';

/**
 * Class RoleForbiddenError
 *
 * @description
 * The role of the actor in the organization does not allow the request (decision 1 of P2b,
 * `organization.role-forbidden`).
 */
export class RoleForbiddenError extends DomainError {
  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Refuses the request.
   *
   * @constructor
   */
  public constructor() {
    super('The role of the actor does not allow this request.');
  }
  // #endregion
}
