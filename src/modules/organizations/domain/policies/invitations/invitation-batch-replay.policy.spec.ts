import { describe, expect, it } from 'vitest';

import { InvitationBatchKeyReusedError } from '../../errors/invitations/invitation-batch-key-reused.error.js';
import { InvitationBatchRequest } from '../../value-objects/invitations/invitation-batch-request.value-object.js';
import { distinctAddresses } from './invitation-batch.policy.js';
import {
  assertSameInvitationBatch,
  invitationBatchReplayExpiresAt,
} from './invitation-batch-replay.policy.js';

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

    expect(() => {
      assertSameInvitationBatch(
        sent,
        batch([' Marc.Roux@AtelierNord.fr', 'lucie@exemple.fr', 'LUCIE@exemple.fr'], 'member'),
      );
    }).not.toThrow();
    expect(() => {
      assertSameInvitationBatch(InvitationBatchRequest.restore(sent.snapshot), sent);
    }).not.toThrow();
  });

  it('refuses another order, another address or another role under the same key', () => {
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
      expect(() => {
        assertSameInvitationBatch(sent, other);
      }).toThrow(InvitationBatchKeyReusedError);
    }
  });

  it('replays a committed batch for 24 hours', () => {
    expect(invitationBatchReplayExpiresAt(new Date('2026-11-08T09:00:00Z'))).toEqual(
      new Date('2026-11-09T09:00:00Z'),
    );
  });
});
