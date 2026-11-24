import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import { SlugInvalidError } from '../../errors/organizations/slug-invalid.error.js';
import { SlugReservedError } from '../../errors/organizations/slug-reserved.error.js';
import { Slug } from './slug.value-object.js';

/** The first path segments of the web application, as `Slug` of the contract lists them. */
const RESERVED: readonly string[] = [
  'login',
  'signup',
  'forgot',
  'reset',
  'invite',
  'auth',
  'organizations',
  'home',
  'account',
  'org',
  'logged-out',
  'api',
  'assets',
  'media',
  'en',
  'fr',
  'de',
];

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

  it('refuses a given address that is a first path segment of the web application', () => {
    for (const reserved of RESERVED) {
      expect(() => Slug.parse(reserved)).toThrow(SlugReservedError);
    }
    expect(() => Slug.parse('home')).toThrow(expect.objectContaining({ slug: 'home' }));
    expect(() => Slug.parse('f')).toThrow(SlugInvalidError);
  });

  it('keeps an address that only contains a reserved segment', () => {
    for (const kept of ['home-office', 'atelier-login', 'api2', 'orga', 'en-route']) {
      expect(Slug.parse(kept).value).toBe(kept);
    }
  });

  it('refuses a name whose derived address is reserved, with what it derived', () => {
    expect(() => Slug.derive('Home')).toThrow(SlugReservedError);
    expect(() => Slug.derive('  LOGGED out ')).toThrow(SlugReservedError);
    expect(() => Slug.derive('API')).toThrow(expect.objectContaining({ slug: 'api' }));
    expect(() => Slug.derive('Éñ')).toThrow(expect.objectContaining({ slug: 'en' }));
  });

  test.prop([fc.string({ maxLength: 200 })])(
    'derives an address of the contract format or refuses the name',
    (name: string) => {
      let slug: string;
      try {
        slug = Slug.derive(name).value;
      } catch (error) {
        expect(error instanceof SlugInvalidError || error instanceof SlugReservedError).toBe(true);
        return;
      }
      expect(RESERVED).not.toContain(slug);
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/u);
      expect(slug.length).toBeGreaterThanOrEqual(2);
      expect(slug.length).toBeLessThanOrEqual(63);
    },
  );
});
