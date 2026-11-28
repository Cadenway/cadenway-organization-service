import { describe, expect, it } from 'vitest';

import { InvitationBatchRequest } from '../../value-objects/invitations/invitation-batch-request.value-object.js';
import { distinctAddresses } from './invitation-batch.policy.js';
import { invitationBatchReplayExpiresAt } from './invitation-batch-replay.policy.js';

/**
 * The request of a batch as the route receives it.
 *
 * @param emails - The addresses, as sent.
 * @param role - The role.
 * @returns The request.
 */
function batch(
  emails: readonly string[],
  role: 'admin' | 'member' | 'guest',
): InvitationBatchRequest {
  return InvitationBatchRequest.of(distinctAddresses(emails), role);
}

describe('invitation batch replay', () => {
  it('treats a repeated address, a change of case and spaces as the same batch', () => {
    const sent: InvitationBatchRequest = batch(
      ['marc.roux@ateliernord.fr', 'lucie@exemple.fr'],
      'member',
    );
    const again: InvitationBatchRequest = batch(
      [' Marc.Roux@AtelierNord.fr', 'lucie@exemple.fr', 'LUCIE@exemple.fr'],
      'member',
    );

    expect(again.equals(sent)).toBe(true);
    expect(again.canonical).toBe(sent.canonical);
  });

  it('tells another order, another address or another role from the batch', () => {
    const sent: InvitationBatchRequest = batch(
      ['marc.roux@ateliernord.fr', 'lucie@exemple.fr'],
      'member',
    );

    for (const other of [
      batch(['lucie@exemple.fr', 'marc.roux@ateliernord.fr'], 'member'),
      batch(['marc.roux@ateliernord.fr'], 'member'),
      batch(['marc.roux@ateliernord.fr', 'lucie@exemple.fr', 'hugo@exemple.fr'], 'member'),
      batch(['marc.roux@ateliernord.fr', 'lucie@exemple.fr'], 'guest'),
    ]) {
      expect(other.equals(sent)).toBe(false);
      expect(other.canonical).not.toBe(sent.canonical);
    }
  });

  it('writes the role, then each distinct address, as one JSON array', () => {
    expect(batch(['A@exemple.fr', 'b@exemple.fr', 'a@exemple.fr'], 'member').canonical).toBe(
      '["member","a@exemple.fr","b@exemple.fr"]',
    );
  });

  it('replays a committed batch for 24 hours', () => {
    expect(invitationBatchReplayExpiresAt(new Date('2026-11-08T09:00:00Z'))).toEqual(
      new Date('2026-11-09T09:00:00Z'),
    );
  });
});
