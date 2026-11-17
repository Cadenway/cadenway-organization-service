import type { DirectoryUser } from '../../../domain/aggregates/directory-user/directory-user.aggregate.js';
import type { OrganizationsStore } from '../../models/transactions/organizations-store.model.js';

/**
 * Constant SENDER_NAME_MAX_LENGTH
 *
 * @description
 * Longest `inviter.name` of `invitation.issued.v1`: 120 characters, the length of a full name,
 * which an address standing in for it may exceed.
 *
 * @type {number}
 */
const SENDER_NAME_MAX_LENGTH: number = 120;

/**
 * Function senderNameOf
 *
 * @description
 * The name the email of an invitation shows for its sender ("{inviter.name} vous invite…"): the
 * full name of the account in the user directory. A sender is an owner or an admin, who could only
 * create or join the organization once the directory knew their name and verified address, so the
 * address is the fallback of a profile event not applied yet, and a missing entry is a defect.
 *
 * @param {OrganizationsStore} store - The store of the transaction.
 * @param {string} userId - The sender.
 * @returns {Promise<string>} The name to show.
 * @throws {Error} When the directory has no name nor address for the sender.
 */
export async function senderNameOf(store: OrganizationsStore, userId: string): Promise<string> {
  const sender: DirectoryUser | null = await store.directory.find(userId);
  const name: string | null = sender?.name ?? sender?.email?.value ?? null;
  if (name === null) {
    throw new Error('The sender of an invitation is not in the user directory.');
  }
  return name.slice(0, SENDER_NAME_MAX_LENGTH);
}
