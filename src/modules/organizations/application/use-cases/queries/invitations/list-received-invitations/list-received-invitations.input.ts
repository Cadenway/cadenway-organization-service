import type { PagePosition } from '../../../../models/pagination/page-position.model.js';

/**
 * Interface ListReceivedInvitationsInput
 *
 * @description
 * One page of the invitations addressed to the actor ("Invitation en attente" of the picker).
 */
export interface ListReceivedInvitationsInput {
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
   * Property userId
   *
   * @description
   * The account of the path, which must be the actor.
   *
   * @type {string}
   * @readonly
   */
  readonly userId: string;

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
