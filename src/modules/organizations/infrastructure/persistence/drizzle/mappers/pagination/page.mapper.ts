import type { Page } from '../../../../../application/models/pagination/page.model.js';
import type { PagePosition } from '../../../../../application/models/pagination/page-position.model.js';

/**
 * Function toPage
 *
 * @description
 * Builds a page from the `limit + 1` rows a list query read: the extra row only tells that a next
 * page exists, which then starts after the last item kept.
 *
 * @param {readonly TRow[]} rows - The rows read, `limit + 1` at most, in the order of the list.
 * @param {number} limit - Page size.
 * @param {(row: TRow) => TItem} toItem - Maps a row to an item.
 * @param {(row: TRow) => PagePosition} positionOf - The position of a row in the list.
 * @returns {Page<TItem>} The page.
 */
export function toPage<TRow, TItem>(
  rows: readonly TRow[],
  limit: number,
  toItem: (row: TRow) => TItem,
  positionOf: (row: TRow) => PagePosition,
): Page<TItem> {
  const kept: readonly TRow[] = rows.slice(0, limit);
  const last: TRow | undefined = kept.at(-1);
  return {
    items: kept.map(toItem),
    next: rows.length > limit && last !== undefined ? positionOf(last) : null,
  };
}
