import { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import type { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import { distinctAddresses } from '../../../../../domain/policies/invitations/invitation-batch.policy.js';
import {
  assertInvitationEmailsAvailable,
  invitationEmailWindowStart,
} from '../../../../../domain/policies/invitations/invitation-email-allowance.policy.js';
import { assertManagesOrganization } from '../../../../../domain/policies/members/member-permissions.policy.js';
import type { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';
import type { InvitationEmailUsage } from '../../../../../domain/value-objects/invitations/invitation-email-usage.value-object.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import type { InvitationMail } from '../../../../models/invitations/invitation-mail.model.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { InvitationOutcome } from '../../../../projections/invitations/invitation-outcome.projection.js';
import { senderNameOf } from '../../../../services/invitations/sender-name.service.js';
import { requireActorMembership } from '../../../../services/members/actor-membership.service.js';
import type { InviteMembersInput } from './invite-members.input.js';
import type { InviteMembersOutput } from './invite-members.output.js';

/**
 * Interface PlannedAddress
 *
 * @description
 * An address of the batch before anything is written: its outcome when it is a member or already
 * invited, `null` when it would be invited and needs an invitation email.
 */
interface PlannedAddress {
  // #region Properties
  /**
   * Property address
   *
   * @description
   * The address.
   *
   * @type {EmailAddress}
   * @readonly
   */
  readonly address: EmailAddress;

  /**
   * Property decided
   *
   * @description
   * `already-member` or `already-invited`, or `null` for an address to invite.
   *
   * @type {InvitationOutcome | null}
   * @readonly
   */
  readonly decided: InvitationOutcome | null;
  // #endregion
}

/**
 * Class InviteMembers
 *
 * @description
 * Invites a batch of addresses with one role to the organization of the request
 * (`POST /internal/v1/invitations`) in its tenant transaction. The owner and the admins invite
 * (`role-forbidden` otherwise). The batch is never refused as a whole for one address: each
 * distinct address, in its order, is `already-member` when it is the address of an active member,
 * `already-invited` with the pending invitation when it has one (expired included), and `invited`
 * otherwise (decision 5 of P2b). Each invitation, its entry in the ledger of invitation emails and
 * its `invitation.issued.v1` commit together.
 *
 * Once the role is accepted, the ledger of the organization is locked for the transaction and the
 * batch is refused as a whole with `invitation-daily-limit-reached` when its addresses to invite
 * need more invitation emails than remain of the 100 of the last 24 hours: nothing is written,
 * sent or emitted (decision 1 of the P2b security follow-ups). A batch that invites nobody is never
 * refused.
 */
export class InviteMembers {
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
   * The time of the sending.
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
   * Takes the ports of the batch.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @param {Clock} clock - The time of the sending.
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
   * Invites the batch.
   *
   * @param {InviteMembersInput} input - The actor, the organization, the addresses and the role.
   * @returns {Promise<InviteMembersOutput>} The outcome of each distinct address.
   * @throws {OrganizationRefusal} `organization-not-found`, `role-forbidden` or
   * `invitation-daily-limit-reached`.
   */
  public async execute(input: InviteMembersInput): Promise<InviteMembersOutput> {
    const now: Date = this.clock.now();
    try {
      const addresses: EmailAddress[] = distinctAddresses(input.emails);
      return await this.unitOfWork.runInRequestOrganization(
        async (store: OrganizationsStore): Promise<InviteMembersOutput> => {
          const actor: Member = await requireActorMembership(
            store,
            input.organizationId,
            input.actorUserId,
          );
          assertManagesOrganization(actor.role);
          const organization: Organization | null = await store.organizations.find(
            input.organizationId,
          );
          if (organization === null) {
            throw new OrganizationRefusal({ reason: 'organization-not-found' });
          }
          const usage: InvitationEmailUsage = await store.invitationEmails.lockUsage(
            input.organizationId,
            invitationEmailWindowStart(now),
          );
          const planned: PlannedAddress[] = [];
          for (const address of addresses) {
            planned.push(await InviteMembers.plan(store, input.organizationId, address));
          }
          assertInvitationEmailsAvailable(
            usage,
            planned.filter((entry: PlannedAddress) => entry.decided === null).length,
            now,
          );
          const mail: InvitationMail = {
            inviterUserId: input.actorUserId,
            inviterName: await senderNameOf(store, input.actorUserId),
            organizationName: organization.snapshot.name,
            memberCount: await store.members.countSeats(input.organizationId),
            language: organization.snapshot.defaultLanguage,
          };
          const invitations: InvitationOutcome[] = [];
          for (const entry of planned) {
            invitations.push(
              entry.decided ??
                (await InviteMembers.invite(store, input, mail, { address: entry.address, now })),
            );
          }
          return { invitations };
        },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }

  /**
   * Method plan
   *
   * @description
   * Decides the outcome of one address without writing anything: `already-member` for the address
   * of an active member, `already-invited` with its pending invitation, or nothing yet for an
   * address to invite.
   *
   * @param {OrganizationsStore} store - The store of the transaction.
   * @param {string} organizationId - The organization of the request.
   * @param {EmailAddress} address - The address.
   * @returns {Promise<PlannedAddress>} The address and its outcome, if decided.
   */
  private static async plan(
    store: OrganizationsStore,
    organizationId: string,
    address: EmailAddress,
  ): Promise<PlannedAddress> {
    if (await store.members.hasActiveMemberWithEmail(organizationId, address)) {
      return {
        address,
        decided: { email: address.value, outcome: 'already-member', invitationId: null },
      };
    }
    const pending: Invitation | null = await store.invitations.findPendingTo(
      organizationId,
      address,
    );
    return {
      address,
      decided:
        pending === null
          ? null
          : { email: address.value, outcome: 'already-invited', invitationId: pending.id },
    };
  }

  /**
   * Method invite
   *
   * @description
   * Stores the invitation of an address to invite, records its email in the ledger and appends its
   * event. The lock of the ledger serializes the batches of the organization, so no other batch
   * inserts the same address meanwhile; should a pending invitation of the address exist all the
   * same, the address answers `already-invited` with it and nothing is recorded.
   *
   * @param {OrganizationsStore} store - The store of the transaction.
   * @param {InviteMembersInput} input - The batch.
   * @param {InvitationMail} mail - The sender, the organization and the language of the email.
   * @param {{ readonly address: EmailAddress; readonly now: Date }} sending - The address and the
   * instant of the sending.
   * @returns {Promise<InvitationOutcome>} What became of the address.
   */
  private static async invite(
    store: OrganizationsStore,
    input: InviteMembersInput,
    mail: InvitationMail,
    sending: { readonly address: EmailAddress; readonly now: Date },
  ): Promise<InvitationOutcome> {
    const { address, now } = sending;
    const invitation: Invitation | null = await store.invitations.insertPending(
      Invitation.issue(input.organizationId, address, input.role, input.actorUserId, now),
    );
    if (invitation === null) {
      const concurrent: Invitation | null = await store.invitations.findPendingTo(
        input.organizationId,
        address,
      );
      return {
        email: address.value,
        outcome: 'already-invited',
        invitationId: concurrent?.id ?? null,
      };
    }
    await store.invitationEmails.record(invitation);
    await store.events.invitationIssued(invitation, mail);
    return { email: address.value, outcome: 'invited', invitationId: invitation.id };
  }
  // #endregion
}
