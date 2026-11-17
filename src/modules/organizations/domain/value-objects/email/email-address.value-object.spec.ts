import { describe, expect, it } from 'vitest';

import { InvalidEmailAddressError } from '../../errors/directory/invalid-email-address.error.js';
import { EmailAddress } from './email-address.value-object.js';

describe('EmailAddress', () => {
  it('trims and lowercases an address, so addresses compare without regard to case', () => {
    const address: EmailAddress = EmailAddress.parse('  Ines.Robert@AtelierNord.fr ');

    expect(address.value).toBe('ines.robert@ateliernord.fr');
    expect(address.equals(EmailAddress.parse('ines.robert@ateliernord.fr'))).toBe(true);
    expect(address.equals(EmailAddress.parse('hugo.dubois@ateliernord.fr'))).toBe(false);
  });

  it('refuses a value that cannot be an address', () => {
    for (const invalid of ['', '   ', 'camille', '@ateliernord.fr', 'a b@c.fr', 'a@b@c.fr']) {
      expect(() => EmailAddress.parse(invalid)).toThrow(InvalidEmailAddressError);
    }
    expect(() => EmailAddress.parse(`${'a'.repeat(250)}@b.fr`)).toThrow(InvalidEmailAddressError);
  });
});
