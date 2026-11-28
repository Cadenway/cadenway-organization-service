import { ProblemException } from '@cadenway/nest-common';
import { describe, expect, it } from 'vitest';

import { invitationBatchKey, requiredInvitationBatchKey } from './invitation.validation.js';

describe('invitation batch Idempotency-Key', () => {
  it('accepts an absent key and a key of 1 to 255 characters', () => {
    expect(invitationBatchKey(undefined)).toBeUndefined();
    expect(invitationBatchKey('k')).toBe('k');
    expect(invitationBatchKey('k'.repeat(255))).toBe('k'.repeat(255));
  });

  it('requires the key of the keyed route, with the same bounds', () => {
    expect(requiredInvitationBatchKey('k')).toBe('k');
    for (const value of [undefined, '', 'k'.repeat(256)]) {
      expect(() => requiredInvitationBatchKey(value)).toThrow(ProblemException);
    }
  });

  it('refuses an empty or longer key as a header issue of request.invalid', () => {
    for (const value of ['', 'k'.repeat(256)]) {
      let problem: unknown;
      try {
        invitationBatchKey(value);
      } catch (error) {
        expect(error).toBeInstanceOf(ProblemException);
        problem = (error as ProblemException).getResponse();
      }
      expect(problem).toMatchObject({
        status: 400,
        code: 'request.invalid',
        details: { issues: [{ in: 'header', path: 'Idempotency-Key' }] },
      });
    }
  });
});
