import { describe, expect, it } from 'vitest';

import { searchKeyOf } from './search-key.value-object.js';

describe('searchKeyOf', () => {
  it('drops case and accents, so the search of the member list ignores them', () => {
    expect(searchKeyOf('Inès Robert')).toBe('ines robert');
    expect(searchKeyOf('INES')).toBe(searchKeyOf('inès'));
    expect(searchKeyOf('Coopérative Lumen')).toBe('cooperative lumen');
  });
});
