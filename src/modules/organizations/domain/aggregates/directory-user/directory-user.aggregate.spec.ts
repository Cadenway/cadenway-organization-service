import { fc, test } from '@fast-check/vitest';
import { describe, expect, it } from 'vitest';

import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import { EmailAddress } from '../../value-objects/email/email-address.value-object.js';
import { DirectoryUser } from './directory-user.aggregate.js';

/** The address of Camille Martin. */
const CAMILLE: EmailAddress = EmailAddress.parse('camille.martin@ateliernord.fr');

/** The shorter address Camille Martin moves to (`user.email-changed.v1` of the contract). */
const SHORTER: EmailAddress = EmailAddress.parse('camille@ateliernord.fr');

/** An event of the account of Camille Martin, as the directory applies it. */
type AccountEvent = (user: DirectoryUser) => DirectoryUser;

/**
 * The events of a sign-up replaced once, verified, renamed, then two-step verification turned on,
 * off and on again, in the order of identity.
 */
const HISTORY: readonly AccountEvent[] = [
  (user) => user.applySignUp(1, CAMILLE, 'Camille M.'),
  (user) => user.applySignUp(2, CAMILLE, 'Camille Martin'),
  (user) => user.applyEmailVerification(3, CAMILLE),
  (user) => user.applyProfileUpdate(4, 'Camille Martin-Durand'),
  (user) => user.applyTwoStepVerificationChange(5, true),
  (user) => user.applyTwoStepVerificationChange(6, false),
  (user) => user.applyTwoStepVerificationChange(7, true),
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
      twoStepVerificationEnabled: false,
      twoStepVerificationVersion: 0,
      deleted: false,
    });
  });

  test.prop([fc.shuffledSubarray([0, 1, 2, 3, 4, 5, 6], { minLength: 7, maxLength: 7 })])(
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
        twoStepVerificationEnabled: true,
        twoStepVerificationVersion: 7,
        deleted: false,
      });
    },
  );

  it('applies the two-step verification by version, whatever the change, and each one once', () => {
    const enabled: DirectoryUser = DirectoryUser.unknown('camille')
      .applySignUp(1, CAMILLE, 'Camille Martin')
      .applyTwoStepVerificationChange(8, true);

    expect(DirectoryUser.unknown('camille').twoStepVerificationEnabled).toBe(false);
    expect(enabled.twoStepVerificationEnabled).toBe(true);
    expect(enabled.snapshot).toMatchObject({
      twoStepVerificationEnabled: true,
      twoStepVerificationVersion: 8,
      nameVersion: 1,
      emailVersion: 1,
    });
    // A redelivery and an older event change nothing; a newer one applies.
    expect(enabled.applyTwoStepVerificationChange(8, true)).toBe(enabled);
    expect(enabled.applyTwoStepVerificationChange(7, false)).toBe(enabled);
    expect(enabled.applyTwoStepVerificationChange(10, false).twoStepVerificationEnabled).toBe(
      false,
    );
    // The other parts keep their own versions: a newer two-step event leaves the name alone.
    expect(enabled.applyProfileUpdate(2, 'Camille Martin-Durand').name).toBe(
      'Camille Martin-Durand',
    );
  });

  it('trusts a changed address at once, by version, as a verified one', () => {
    const verified: DirectoryUser = DirectoryUser.unknown('camille')
      .applySignUp(1, CAMILLE, 'Camille Martin')
      .applyEmailVerification(2, CAMILLE);

    const changed: DirectoryUser = verified.applyEmailChange(5, SHORTER);

    expect(changed.verifiedEmail?.value).toBe(SHORTER.value);
    expect(changed.snapshot).toMatchObject({ emailVersion: 5, emailVerified: true });
    expect(changed.applyEmailChange(5, SHORTER)).toBe(changed);
    expect(changed.applyEmailVerification(2, CAMILLE)).toBe(changed);
    expect(verified.applyEmailChange(2, SHORTER)).toBe(verified);
  });

  it('forgets the name, the address and the two-step verification of a deleted account, and applies nothing after it', () => {
    const deleted: DirectoryUser = DirectoryUser.unknown('camille')
      .applySignUp(1, CAMILLE, 'Camille Martin')
      .applyEmailVerification(2, CAMILLE)
      .applyTwoStepVerificationChange(3, true)
      .applyDeletion(7);

    expect(deleted.snapshot).toEqual({
      userId: 'camille',
      name: null,
      nameVersion: 7,
      email: null,
      emailVerified: false,
      emailVersion: 7,
      twoStepVerificationEnabled: false,
      twoStepVerificationVersion: 7,
      deleted: true,
    });
    expect(deleted.applyTwoStepVerificationChange(8, true)).toBe(deleted);
    expect(deleted.isDeleted).toBe(true);
    expect(deleted.isSynchronized).toBe(false);
    expect(deleted.verifiedEmail).toBeNull();
    expect(deleted.applyDeletion(7)).toBe(deleted);
    expect(deleted.applyProfileUpdate(8, 'Camille Martin')).toBe(deleted);
    expect(deleted.applyEmailChange(9, SHORTER)).toBe(deleted);
    expect(deleted.applySignUp(1, CAMILLE, 'Camille Martin')).toBe(deleted);
  });

  it('keeps a deletion that arrives before the other events of the account', () => {
    const deleted: DirectoryUser = DirectoryUser.unknown('camille').applyDeletion(7);

    expect(deleted.applySignUp(1, CAMILLE, 'Camille Martin').snapshot).toMatchObject({
      name: null,
      email: null,
      deleted: true,
    });
  });

  it('refuses a stored entry verified without an address or with a negative version', () => {
    const state = DirectoryUser.unknown('camille').snapshot;

    expect(() => DirectoryUser.restore({ ...state, emailVerified: true })).toThrow(
      InvalidStoredStateError,
    );
    expect(() => DirectoryUser.restore({ ...state, nameVersion: -1 })).toThrow(
      InvalidStoredStateError,
    );
    expect(() => DirectoryUser.restore({ ...state, twoStepVerificationVersion: -1 })).toThrow(
      InvalidStoredStateError,
    );
  });

  it('refuses a stored deleted account that kept its name or its address', () => {
    const state = DirectoryUser.unknown('camille').snapshot;

    expect(() => DirectoryUser.restore({ ...state, deleted: true, name: 'Camille' })).toThrow(
      InvalidStoredStateError,
    );
    expect(() => DirectoryUser.restore({ ...state, deleted: true, email: CAMILLE.value })).toThrow(
      InvalidStoredStateError,
    );
  });
});
