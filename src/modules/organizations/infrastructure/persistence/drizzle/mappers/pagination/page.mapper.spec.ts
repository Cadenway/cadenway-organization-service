import { describe, expect, it } from 'vitest';

import { toPage } from './page.mapper.js';

describe('toPage', () => {
  const rows = [
    { id: 'a', key: 'camille martin' },
    { id: 'b', key: 'hugo dubois' },
    { id: 'c', key: 'ines robert' },
  ];

  it('keeps limit items and starts the next page after the last one kept', () => {
    expect(
      toPage(
        rows,
        2,
        (row) => row.id,
        (row) => ({ key: row.key, id: row.id }),
      ),
    ).toEqual({
      items: ['a', 'b'],
      next: { key: 'hugo dubois', id: 'b' },
    });
  });

  it('has no next page when the extra row is missing', () => {
    expect(
      toPage(
        rows,
        3,
        (row) => row.id,
        (row) => ({ key: row.key, id: row.id }),
      ),
    ).toEqual({
      items: ['a', 'b', 'c'],
      next: null,
    });
  });
});
