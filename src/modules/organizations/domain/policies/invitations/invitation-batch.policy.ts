import { EmailAddress } from '../../value-objects/email/email-address.value-object.js';

/**
 * Function distinctAddresses
 *
 * @description
 * The addresses of an invitation batch, each once, in the order of their first appearance: "the
 * same address twice counts once" and the outcomes follow the order given
 * (`openapi/public/members.yaml`). Two addresses that differ by case are the same.
 *
 * @param {readonly string[]} addresses - The addresses as received.
 * @returns {EmailAddress[]} The distinct addresses.
 * @throws {InvalidEmailAddressError} When a value cannot be an address.
 */
export function distinctAddresses(addresses: readonly string[]): EmailAddress[] {
  const seen: Set<string> = new Set<string>();
  const distinct: EmailAddress[] = [];
  for (const raw of addresses) {
    const address: EmailAddress = EmailAddress.parse(raw);
    if (!seen.has(address.value)) {
      seen.add(address.value);
      distinct.push(address);
    }
  }
  return distinct;
}
