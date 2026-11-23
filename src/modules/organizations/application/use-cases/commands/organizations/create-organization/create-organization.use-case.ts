import type { DirectoryUser } from '../../../../../domain/aggregates/directory-user/directory-user.aggregate.js';
import { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import { FREE_SEAT_ENTITLEMENT } from '../../../../../domain/value-objects/billing/seat-entitlement.value-object.js';
import { distinctAddresses } from '../../../../../domain/policies/invitations/invitation-batch.policy.js';
import {
  assertInvitationEmailsAvailable,
  invitationEmailWindowStart,
} from '../../../../../domain/policies/invitations/invitation-email-allowance.policy.js';
import type { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';
import type { OrganizationDraft } from '../../../../../domain/value-objects/organizations/organization-draft.value-object.js';
import { toOrganizationView } from '../../../../mappers/organizations/organization-view.mapper.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { InvitationOutcome } from '../../../../projections/invitations/invitation-outcome.projection.js';
import type { CreateOrganizationInput } from './create-organization.input.js';
import type { CreateOrganizationOutput } from './create-organization.output.js';

/**
 * Class CreateOrganization
 *
 * @description
 * Creates an organization owned by the actor (`POST /internal/v1/organizations`), with the plan
 * `free`, its owner membership and the invitations of `inviteEmails` as `member`, in one system
 * transaction: the organization does not exist before it, so no tenant transaction can hold it.
 * The transaction writes the rows of that organization only and appends
 * `organization.created.v1`, `member.joined.v1` and one `invitation.issued.v1` per invited address;
 * any failure rolls all of it back. An actor the user directory does not know yet answers
 * `user-not-synchronized` and creates nothing.
 *
 * Each invited address takes one email of the daily allowance of the new organization: its entry
 * in the organization and sender ledgers commits with the invitation. A creation with no new
 * invitations does not consume the sender allowance.
 */
export class CreateOrganization {
  // #region Properties
  /**
   * Property unitOfWork
   *
   * @description
   * The transactions of the module.
   *
   * @type {OrganizationsUnitOfWork}
   * @readonly
   */
  private readonly unitOfWork: OrganizationsUnitOfWork;

  /**
   * Property clock
   *
   * @description
   * The time of the creation.
   *
   * @type {Clock}
   * @readonly
   */
  private readonly clock: Clock;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the ports of the creation.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @param {Clock} clock - The time of the creation.
   * @constructor
   */
  public constructor(unitOfWork: OrganizationsUnitOfWork, clock: Clock) {
    this.unitOfWork = unitOfWork;
    this.clock = clock;
  }
  // #endregion

  // #region Methods
  /**
   * Method execute
   *
   * @description
   * Creates the organization.
   *
   * @param {CreateOrganizationInput} input - The form and its creator.
   * @returns {Promise<CreateOrganizationOutput>} The organization and the invitation outcomes.
   * @throws {OrganizationRefusal} `invalid-field`, `slug-invalid`, `slug-taken` or
   * `user-not-synchronized`.
   */
  public async execute(input: CreateOrganizationInput): Promise<CreateOrganizationOutput> {
    try {
      const now: Date = this.clock.now();
      const draft: OrganizationDraft = Organization.found(
        {
          name: input.name,
          slug: input.slug,
          teamSize: input.teamSize,
          primaryUse: input.primaryUse,
          ownerUserId: input.actorUserId,
        },
        now,
      );
      const addresses: EmailAddress[] = distinctAddresses(input.inviteEmails);
      return await this.unitOfWork.runAcrossOrganizations(
        async (store: OrganizationsStore): Promise<CreateOrganizationOutput> => {
          // Held until the commit: a deletion of the account under way is waited for and then
          // refuses the creation, a later one sees the new owner (`RemoveDeletedUser`).
          const creator: DirectoryUser | null = await store.directory.findForShare(
            input.actorUserId,
          );
          const creatorName: string | null = creator?.name ?? null;
          if (creator === null || creatorName === null || !creator.isSynchronized) {
            throw new OrganizationRefusal({ reason: 'user-not-synchronized' });
          }
          const deletionAttempt = await store.directory.findDeletionAttempt(input.actorUserId);
          if (deletionAttempt !== null) {
            throw new OrganizationRefusal({ reason: 'user-not-synchronized' });
          }
          const needed = addresses.filter(
            (address) => !creator.verifiedEmail?.equals(address),
          ).length;
          if (needed > 0) {
            const usage = await store.invitationEmails.lockSenderUsage(
              input.actorUserId,
              invitationEmailWindowStart(now),
            );
            assertInvitationEmailsAvailable(usage, needed, now);
          }
          const organization: Organization = await store.organizations.insert(draft);
          const owner: Member = await store.members.insert(
            Member.owner(organization.id, input.actorUserId, now),
          );
          await store.events.organizationCreated(organization);
          await store.events.memberJoined(owner);
          const invitations: InvitationOutcome[] = [];
          for (const address of addresses) {
            invitations.push(
              creator.verifiedEmail?.equals(address) === true
                ? { email: address.value, outcome: 'already-member', invitationId: null }
                : await CreateOrganization.invite(store, organization, creatorName, input, {
                    address,
                    now,
                  }),
            );
          }
          return {
            organization: toOrganizationView(organization, 'owner', 1, FREE_SEAT_ENTITLEMENT.plan),
            invitations,
          };
        },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }

  /**
   * Method invite
   *
   * @description
   * Invites one address of the creation form as `member` and records its email in the ledger. The
   * organization is new, so the address has no pending invitation in it unless the form repeats it,
   * which `distinctAddresses` removed.
   *
   * @param {OrganizationsStore} store - The store of the transaction.
   * @param {Organization} organization - The new organization.
   * @param {string} creatorName - Full name of the creator, the sender of the email.
   * @param {CreateOrganizationInput} input - The request, for its actor.
   * @param {{ readonly address: EmailAddress; readonly now: Date }} sending - The address and the
   * instant of the sending.
   * @returns {Promise<InvitationOutcome>} What became of the address.
   */
  private static async invite(
    store: OrganizationsStore,
    organization: Organization,
    creatorName: string,
    input: CreateOrganizationInput,
    sending: { readonly address: EmailAddress; readonly now: Date },
  ): Promise<InvitationOutcome> {
    const { address, now } = sending;
    const invitation: Invitation | null = await store.invitations.insertPending(
      Invitation.issue(organization.id, address, 'member', input.actorUserId, now),
    );
    if (invitation === null) {
      const pending: Invitation | null = await store.invitations.findPendingTo(
        organization.id,
        address,
      );
      return {
        email: address.value,
        outcome: 'already-invited',
        invitationId: pending?.id ?? null,
      };
    }
    await store.invitationEmails.record(invitation, input.actorUserId);
    await store.events.invitationIssued(invitation, {
      inviterUserId: input.actorUserId,
      inviterName: creatorName,
      organizationName: organization.snapshot.name,
      memberCount: 1,
      language: organization.snapshot.defaultLanguage,
    });
    return { email: address.value, outcome: 'invited', invitationId: invitation.id };
  }
  // #endregion
}
