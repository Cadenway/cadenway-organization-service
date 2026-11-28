import { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import type { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import { distinctAddresses } from '../../../../../domain/policies/invitations/invitation-batch.policy.js';
import {
  assertInvitationBatchAvailable,
  invitationEmailWindowStart,
} from '../../../../../domain/policies/invitations/invitation-email-allowance.policy.js';
import {
  assertSameInvitationBatch,
  invitationBatchReplayExpiresAt,
} from '../../../../../domain/policies/invitations/invitation-batch-replay.policy.js';
import { assertManagesOrganization } from '../../../../../domain/policies/members/member-permissions.policy.js';
import type { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';
import { InvitationBatchRequest } from '../../../../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import type { InvitationEmailUsage } from '../../../../../domain/value-objects/invitations/invitation-email-usage.value-object.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import type { InvitationBatchReplayKey } from '../../../../models/invitations/invitation-batch-replay-key.model.js';
import type { InvitationBatchReplay } from '../../../../models/invitations/invitation-batch-replay.model.js';
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
 *
 * With an `Idempotency-Key` (scoped to the organization, the actor and this operation), the
 * authorization and the organization are checked first, as for a fresh batch, then the key is
 * claimed for the transaction without waiting (`idempotency-request-in-progress` while another
 * transaction holds it). A record still live is replayed for an equivalent batch once the actor's
 * role is checked again under a share lock, without locking the allowances, writing, sending or
 * emitting; another batch is refused (`idempotency-key-reused`). Otherwise the batch runs as without
 * a key and its outcome is recorded last, in the same transaction: the invitations, their ledger
 * entries, their `invitation.issued.v1` and the record commit together, and a refusal (a 429
 * included) or a failure records nothing.
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
   * @throws {OrganizationRefusal} `organization-not-found`, `role-forbidden`,
   * `invitation-daily-limit-reached`, `idempotency-key-reused` or
   * `idempotency-request-in-progress`.
   */
  public async execute(input: InviteMembersInput): Promise<InviteMembersOutput> {
    const now: Date = this.clock.now();
    try {
      const addresses: EmailAddress[] = distinctAddresses(input.emails);
      const request: InvitationBatchRequest = InvitationBatchRequest.of(addresses, input.role);
      const key: InvitationBatchReplayKey | null =
        input.idempotencyKey === undefined
          ? null
          : {
              organizationId: input.organizationId,
              actorUserId: input.actorUserId,
              key: input.idempotencyKey,
            };
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
          if (key === null) {
            return InviteMembers.issue(store, input, { organization, addresses, now });
          }
          const replayed: InviteMembersOutput | null = await InviteMembers.replay(
            store,
            key,
            request,
            now,
          );
          if (replayed !== null) {
            return replayed;
          }
          const output: InviteMembersOutput = await InviteMembers.issue(store, input, {
            organization,
            addresses,
            now,
          });
          const recorded: boolean = await store.invitationBatchReplays.record(
            key,
            { request, invitations: output.invitations },
            { now, expiresAt: invitationBatchReplayExpiresAt(now) },
          );
          if (!recorded) {
            throw new OrganizationRefusal({ reason: 'idempotency-request-in-progress' });
          }
          return output;
        },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }

  /**
   * Method replay
   *
   * @description
   * Claims the key for the transaction, then answers its live record, if any, for an equivalent
   * batch once the actor still manages the organization under a share lock.
   *
   * @param {OrganizationsStore} store - The store of the transaction.
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {InvitationBatchRequest} request - The batch of the request.
   * @param {Date} now - The instant of the request.
   * @returns {Promise<InviteMembersOutput | null>} The stored outcome, or `null` to run the batch.
   * @throws {OrganizationRefusal} `idempotency-request-in-progress`, `organization-not-found` or
   * `role-forbidden`.
   * @throws {InvitationBatchKeyReusedError} For a batch that is not equivalent.
   */
  private static async replay(
    store: OrganizationsStore,
    key: InvitationBatchReplayKey,
    request: InvitationBatchRequest,
    now: Date,
  ): Promise<InviteMembersOutput | null> {
    if (!(await store.invitationBatchReplays.tryClaim(key))) {
      throw new OrganizationRefusal({ reason: 'idempotency-request-in-progress' });
    }
    const stored: InvitationBatchReplay | null = await store.invitationBatchReplays.findLive(
      key,
      now,
    );
    if (stored === null) {
      return null;
    }
    const actor: Member = await requireActorMembership(
      store,
      key.organizationId,
      key.actorUserId,
      'share',
    );
    assertManagesOrganization(actor.role);
    assertSameInvitationBatch(stored.request, request);
    return { invitations: stored.invitations };
  }

  /**
   * Method issue
   *
   * @description
   * Runs the batch once the actor and the organization are found: locks the allowances of the
   * sender and of the organization, checks the actor's role again under a share lock, decides each
   * address, refuses a batch that needs more emails than remain, then stores the new invitations
   * with their ledger entries and events.
   *
   * @param {OrganizationsStore} store - The store of the transaction.
   * @param {InviteMembersInput} input - The batch.
   * @param {{ readonly organization: Organization; readonly addresses: readonly EmailAddress[];
   * readonly now: Date }} batch - The organization, the distinct addresses and the instant.
   * @returns {Promise<InviteMembersOutput>} The outcome of each distinct address.
   */
  private static async issue(
    store: OrganizationsStore,
    input: InviteMembersInput,
    batch: {
      readonly organization: Organization;
      readonly addresses: readonly EmailAddress[];
      readonly now: Date;
    },
  ): Promise<InviteMembersOutput> {
    const { organization, addresses, now } = batch;
    const windowStart = invitationEmailWindowStart(now);
    const senderUsage = await store.invitationEmails.lockSenderUsage(
      input.actorUserId,
      windowStart,
    );
    const usage: InvitationEmailUsage = await store.invitationEmails.lockUsage(
      input.organizationId,
      windowStart,
    );
    const currentActor = await requireActorMembership(
      store,
      input.organizationId,
      input.actorUserId,
      'share',
    );
    assertManagesOrganization(currentActor.role);
    const planned: PlannedAddress[] = [];
    for (const address of addresses) {
      planned.push(await InviteMembers.plan(store, input.organizationId, address));
    }
    assertInvitationBatchAvailable(
      senderUsage,
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
    await store.invitationEmails.record(invitation, input.actorUserId);
    await store.events.invitationIssued(invitation, mail);
    return { email: address.value, outcome: 'invited', invitationId: invitation.id };
  }
  // #endregion
}
