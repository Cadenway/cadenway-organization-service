import { describe, expect, it } from 'vitest';

import { InvalidEmailAddressError } from '../../errors/directory/invalid-email-address.error.js';
import type { EmailAddress } from '../../value-objects/email/email-address.value-object.js';
import { distinctAddresses } from './invitation-batch.policy.js';

describe('distinctAddresses', () => {
  it('keeps each address once, in the order of its first appearance, whatever its case', () => {
    const addresses: EmailAddress[] = distinctAddresses([
      'marc.roux@ateliernord.fr',
      'lucie@exemple.fr',
      'Marc.Roux@AtelierNord.fr',
      'ines.robert@ateliernord.fr',
    ]);

    expect(addresses.map((address: EmailAddress) => address.value)).toEqual([
      'marc.roux@ateliernord.fr',
      'lucie@exemple.fr',
      'ines.robert@ateliernord.fr',
    ]);
  });

  it('refuses a value that cannot be an address', () => {
    expect(() => distinctAddresses(['lucie@exemple.fr', 'lucie'])).toThrow(
      InvalidEmailAddressError,
    );
  });
});
