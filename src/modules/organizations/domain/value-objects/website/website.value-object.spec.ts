import { describe, expect, it } from 'vitest';

import { InvalidWebsiteError } from '../../errors/organizations/invalid-website.error.js';
import { Website } from './website.value-object.js';

describe('Website', () => {
  it('keeps an absolute https or http URL as typed, trimmed', () => {
    expect(Website.parse(' https://ateliernord.fr ').value).toBe('https://ateliernord.fr');
    expect(Website.parse('http://lumen.coop/equipe').value).toBe('http://lumen.coop/equipe');
  });

  it('refuses another scheme, a relative or overlong URL, credentials and unencoded quotes', () => {
    for (const invalid of [
      'javascript:alert(1)',
      'data:text/html,<p>x</p>',
      'ftp://ateliernord.fr',
      'mailto:contact@ateliernord.fr',
      'ateliernord.fr',
      `https://ateliernord.fr/${'a'.repeat(2048)}`,
      'https://ateliernord.fr/"><img src=x onerror=alert(1)>',
      "https://ateliernord.fr/'onmouseover='alert(1)",
      'https://ateliernord.fr/a b',
      'https://ateliernord.fr@evil.example/login',
      'https://camille:secret@ateliernord.fr',
    ]) {
      expect(() => Website.parse(invalid)).toThrow(InvalidWebsiteError);
    }
  });
});
