import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import { EmailAddress } from '../../value-objects/email/email-address.value-object.js';
import { DirectoryUser } from './directory-user.aggregate.js';

/** The address of Camille Martin. */
const CAMILLE: EmailAddress = EmailAddress.parse('camille.martin@ateliernord.fr');

/** An event of the account of Camille Martin, as the directory applies it. */
type AccountEvent = (user: DirectoryUser) => DirectoryUser;

/** The events of a sign-up replaced once, verified, then renamed, in the order of identity. */
const HISTORY: readonly AccountEvent[] = [
  (user) => user.applySignUp(1, CAMILLE, 'Camille M.'),
  (user) => user.applySignUp(2, CAMILLE, 'Camille Martin'),
  (user) => user.applyEmailVerification(3, CAMILLE),
  (user) => user.applyProfileUpdate(4, 'Camille Martin-Durand'),
];

describe('DirectoryUser', () => {
  it('knows an account once its sign-up is applied, and trusts its address once verified', () => {
    const signedUp: DirectoryUser = DirectoryUser.unknown('camille').applySignUp(
      1,
      CAMILLE,
      'Camille Martin',
    );

    expect(DirectoryUser.unknown('camille').isSynchronized).toBe(false);
    expect(signedUp.isSynchronized).toBe(true);
    expect(signedUp.verifiedEmail).toBeNull();
    expect(signedUp.applyEmailVerification(2, CAMILLE).verifiedEmail?.value).toBe(CAMILLE.value);
  });

  it('changes nothing for an event already applied or older than the entry', () => {
    const verified: DirectoryUser = DirectoryUser.unknown('camille')
      .applySignUp(1, CAMILLE, 'Camille Martin')
      .applyEmailVerification(2, CAMILLE);

    expect(verified.applyEmailVerification(2, CAMILLE)).toBe(verified);
    expect(verified.applySignUp(1, CAMILLE, 'Camille M.')).toBe(verified);
  });

  it('keeps a profile name over a late sign-up, and a verification over a late sign-up', () => {
    const user: DirectoryUser = DirectoryUser.unknown('camille')
      .applyProfileUpdate(4, 'Camille Martin-Durand')
      .applyEmailVerification(3, CAMILLE)
      .applySignUp(2, CAMILLE, 'Camille Martin');

    expect(user.snapshot).toEqual({
      userId: 'camille',
      name: 'Camille Martin-Durand',
      nameVersion: 4,
      email: CAMILLE.value,
      emailVerified: true,
      emailVersion: 3,
    });
  });

  test.prop([fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 })])(
    'reaches the same entry whatever the order the events arrive in',
    (order: number[]) => {
      let user: DirectoryUser = DirectoryUser.unknown('camille');
      for (const index of order) {
        user = HISTORY[index]?.(user) ?? user;
      }
      expect(user.snapshot).toEqual({
        userId: 'camille',
        name: 'Camille Martin-Durand',
        nameVersion: 4,
        email: CAMILLE.value,
        emailVerified: true,
        emailVersion: 3,
      });
    },
  );

  it('refuses a stored entry verified without an address or with a negative version', () => {
    const state = DirectoryUser.unknown('camille').snapshot;

    expect(() => DirectoryUser.restore({ ...state, emailVerified: true })).toThrow(
      InvalidStoredStateError,
    );
    expect(() => DirectoryUser.restore({ ...state, nameVersion: -1 })).toThrow(
      InvalidStoredStateError,
    );
  });
});
