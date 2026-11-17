/**
 * Interface PagePosition
 *
 * @description
 * Where a page of a list ends: the sort key and the id of its last item. The next page starts after
 * it; the id breaks the ties of the key, so the order is total.
 */
export interface PagePosition {
  // #region Properties
  /**
   * Property key
   *
   * @description
   * Sort key of the last item: a search key of a name, or an instant in ISO 8601.
   *
   * @type {string}
   * @readonly
   */
  readonly key: string;

  /**
   * Property id
   *
   * @description
   * Id of the last item.
   *
   * @type {string}
   * @readonly
   */
  readonly id: string;
  // #endregion
}
