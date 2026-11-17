import type { PagePosition } from '../../../../models/pagination/page-position.model.js';

/**
 * Interface ListMyOrganizationsInput
 *
 * @description
 * One page of the organizations of the actor ("Vos organisations" of the picker).
 */
export interface ListMyOrganizationsInput {
  // #region Properties
  /**
   * Property actorUserId
   *
   * @description
   * The user of the verified internal token, whose organizations are listed.
   *
   * @type {string}
   * @readonly
   */
  readonly actorUserId: string;

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
