import type { PagePosition } from './page-position.model.js';

/**
 * Interface Page
 *
 * @description
 * One page of a list and where the next one starts.
 */
export interface Page<TItem> {
  // #region Properties
  /**
   * Property items
   *
   * @description
   * The items of the page, at most the requested limit.
   *
   * @type {readonly TItem[]}
   * @readonly
   */
  readonly items: readonly TItem[];

  /**
   * Property next
   *
   * @description
   * Where the next page starts, or `null` on the last page.
   *
   * @type {PagePosition | null}
   * @readonly
   */
  readonly next: PagePosition | null;
  // #endregion
}
