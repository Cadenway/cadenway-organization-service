import type { PagePosition } from '../../../../models/pagination/page-position.model.js';

/**
 * Interface ListInvitationsInput
 *
 * @description
 * One page of the pending invitations of the organization of the request ("Invitations en
 * attente").
 */
export interface ListInvitationsInput {
  // #region Properties
  /**
   * Property actorUserId
   *
   * @description
   * The user of the verified internal token.
   *
   * @type {string}
   * @readonly
   */
  readonly actorUserId: string;

  /**
   * Property organizationId
   *
   * @description
   * The organization of the verified internal token.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationId: string;

  /**
   * Property after
   *
   * @description
   * Where the previous page ended, or `null` for the first page.
   *
   * @type {PagePosition | null}
   * @readonly
   */
  readonly after: PagePosition | null;

  /**
   * Property limit
   *
   * @description
   * Page size, 1 to 100.
   *
   * @type {number}
   * @readonly
   */
  readonly limit: number;
  // #endregion
}
