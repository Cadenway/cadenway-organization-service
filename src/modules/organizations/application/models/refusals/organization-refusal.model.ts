import type { Refusal } from './refusal.model.js';

/**
 * Class OrganizationRefusal
 *
 * @description
 * Thrown by a use case of the organizations module when it refuses a request; the presentation
 * turns it into the problem of the contract. Its message names the reason only, never a value of
 * the request.
 */
export class OrganizationRefusal extends Error {
  // #region Properties
  /**
   * Property refusal
   *
   * @description
   * Why the request was refused.
   *
   * @type {Refusal}
   * @readonly
   */
  public readonly refusal: Refusal;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Builds the refusal.
   *
   * @param {Refusal} refusal - Why the request was refused.
   * @constructor
   */
  public constructor(refusal: Refusal) {
    super(`The request was refused: ${refusal.reason}.`);
    this.name = 'OrganizationRefusal';
    this.refusal = refusal;
  }
  // #endregion
}
