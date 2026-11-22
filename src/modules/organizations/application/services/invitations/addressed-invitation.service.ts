import type { DirectoryUser } from '../../../domain/aggregates/directory-user/directory-user.aggregate.js';
import type { Invitation } from '../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { EmailAddress } from '../../../domain/value-objects/email/email-address.value-object.js';
import { OrganizationRefusal } from '../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../models/transactions/organizations-store.model.js';
import type { OrganizationsUnitOfWork } from '../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';

/**
 * Function assertAddressedToActor
 *
 * @description
 * Checks that an invitation is addressed to the current verified address from identity-service.
 * An absent local account or verified address answers like an unknown invitation
 * (`invitation-not-found`), another address `invitation-email-mismatch`.
 *
 * @param {OrganizationsStore} store - The store of the transaction.
 * @param {Invitation | null} invitation - The invitation, or `null` when unknown.
 * @param {string} actorUserId - The verified actor of the request.
 * @param {EmailAddress | null} currentEmail - The current address returned by identity-service.
 * @returns {Promise<Invitation>} The invitation, addressed to the actor.
 * @throws {OrganizationRefusal} `invitation-not-found` or `invitation-email-mismatch`.
 */
export async function assertAddressedToActor(
  store: OrganizationsStore,
  invitation: Invitation | null,
  actorUserId: string,
  currentEmail: EmailAddress | null,
): Promise<Invitation> {
  const user: DirectoryUser | null = await store.directory.find(actorUserId);
  const email: EmailAddress | null = user?.verifiedEmail ?? null;
  if (email === null || currentEmail === null || invitation === null) {
    throw new OrganizationRefusal({ reason: 'invitation-not-found' });
  }
  if (!invitation.isAddressedTo(currentEmail)) {
    throw new OrganizationRefusal({ reason: 'invitation-email-mismatch' });
  }
  return invitation;
}

/**
 * Function findAddressedInvitation
 *
 * @description
 * The first checks of an answer to an invitation, in the order of the contract, before the answer
 * runs in the tenant transaction of its organization: the `userId` of the path is the actor
 * (`user-not-found`), then `assertAddressedToActor`. The invitee belongs to no organization of the
 * invitation yet, so this lookup of one invitation by id runs in a read-only system transaction (a
 * bounded exception of `MODULE.md`); the answer locks the invitation and checks it again in the
 * tenant transaction.
 *
 * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
 * @param {{ readonly actorUserId: string; readonly userId: string; readonly invitationId: string }} request -
 * The actor, the account of the path and the invitation.
 * @param {EmailAddress | null} currentEmail - The current address returned by identity-service.
 * @returns {Promise<Invitation>} The invitation, addressed to the actor.
 * @throws {OrganizationRefusal} `user-not-found`, `invitation-not-found` or
 * `invitation-email-mismatch`.
 */
export async function findAddressedInvitation(
  unitOfWork: OrganizationsUnitOfWork,
  request: { readonly actorUserId: string; readonly userId: string; readonly invitationId: string },
  currentEmail: EmailAddress | null,
): Promise<Invitation> {
  if (request.userId !== request.actorUserId) {
    throw new OrganizationRefusal({ reason: 'user-not-found' });
  }
  return unitOfWork.runAcrossOrganizations(
    async (store: OrganizationsStore): Promise<Invitation> =>
      assertAddressedToActor(
        store,
        await store.invitations.find(request.invitationId),
        request.actorUserId,
        currentEmail,
      ),
    { readOnly: true },
  );
}
