import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import { SlugInvalidError } from '../../errors/organizations/slug-invalid.error.js';
import { Slug } from './slug.value-object.js';

describe('Slug', () => {
  it('derives the address of a name as the creation form of the mockup does', () => {
    expect(Slug.derive('Atelier Nord').value).toBe('atelier-nord');
    expect(Slug.derive('Coopérative Lumen').value).toBe('cooperative-lumen');
    expect(Slug.derive('  Studio   Pivot !! ').value).toBe('studio-pivot');
    expect(Slug.derive('Été 2026 — Équipe').value).toBe('ete-2026-equipe');
  });

  it('cuts a long name to 63 characters without ending on a dash', () => {
    const name: string = `${'a'.repeat(62)} bc`;

    expect(Slug.derive(name).value).toBe('a'.repeat(62));
    expect(Slug.derive('b'.repeat(80)).value).toHaveLength(63);
  });

  it('refuses a derived address shorter than 2 characters, with what it derived', () => {
    expect(() => Slug.derive('é')).toThrow(SlugInvalidError);
    expect(() => Slug.derive('!!!')).toThrow(SlugInvalidError);
    try {
      Slug.derive('é');
    } catch (error) {
      expect(error).toMatchObject({ slug: 'e' });
    }
  });

  it('refuses a given address outside lowercase letters, digits and single dashes', () => {
    expect(Slug.parse('lumen').value).toBe('lumen');
    for (const invalid of ['Lumen', 'atelier--nord', '-lumen', 'lumen-', 'a', 'a'.repeat(64)]) {
      expect(() => Slug.parse(invalid)).toThrow(SlugInvalidError);
    }
  });

  test.prop([fc.string({ maxLength: 200 })])(
    'derives an address of the contract format or refuses the name',
    (name: string) => {
      let slug: string;
      try {
        slug = Slug.derive(name).value;
      } catch (error) {
        expect(error).toBeInstanceOf(SlugInvalidError);
        return;
      }
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/u);
      expect(slug.length).toBeGreaterThanOrEqual(2);
      expect(slug.length).toBeLessThanOrEqual(63);
    },
  );
});
