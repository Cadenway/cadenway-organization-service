import { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import type { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import { distinctAddresses } from '../../../../../domain/policies/invitations/invitation-batch.policy.js';
import {
  assertKeyedInvitationBatchAvailable,
  KEYED_INVITATION_BATCH_BUDGET,
} from '../../../../../domain/policies/invitations/keyed-invitation-batch-budget.policy.js';
import {
  assertInvitationBatchAvailable,
  invitationEmailWindowStart,
} from '../../../../../domain/policies/invitations/invitation-email-allowance.policy.js';
import { InvitationBatchKeyReusedError } from '../../../../../domain/errors/invitations/invitation-batch-key-reused.error.js';
import { assertManagesOrganization } from '../../../../../domain/policies/members/member-permissions.policy.js';
import type { EmailAddress } from '../../../../../domain/value-objects/email/email-address.value-object.js';
import { InvitationBatchRequest } from '../../../../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import type { InvitationEmailUsage } from '../../../../../domain/value-objects/invitations/invitation-email-usage.value-object.js';
import type { KeyedInvitationBatchUsage } from '../../../../../domain/value-objects/invitations/keyed-invitation-batch-usage.value-object.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import type { InvitationBatchReplayKey } from '../../../../models/invitations/invitation-batch-replay-key.model.js';
import type { InvitationMail } from '../../../../models/invitations/invitation-mail.model.js';
import type { StoredInvitationBatch } from '../../../../models/invitations/stored-invitation-batch.model.js';
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
 * Interface KeyedBatch
 *
 * @description
 * A batch sent with an `Idempotency-Key`: its scoped key, its canonical form, its distinct
 * addresses and the instant of the sending.
 */
interface KeyedBatch {
  // #region Properties
  /** The key, scoped to the organization and the actor. */
  readonly key: InvitationBatchReplayKey;

  /** The canonical batch, whose fingerprint the key holds. */
  readonly request: InvitationBatchRequest;

  /** The distinct addresses, in order. */
  readonly addresses: readonly EmailAddress[];

  /** When the batch is sent. */
  readonly now: Date;
  // #endregion
}

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
 * With an `Idempotency-Key` (scoped to the organization, the actor and this operation), the key is
 * settled first, in a short transaction of its own, once the authorization and the organization
 * are checked as for a fresh batch: a live record replays for an equivalent batch (the actor's role
 * read again in the snapshot of the record, without any lock), without writing, sending or
 * emitting; a live reservation answers `idempotency-request-in-progress` to the same batch; either
 * answers `idempotency-key-reused` to another batch. A free key is reserved under a lease and the
 * reservation commits, so the first batch that reserves a key is the only one that can run with
 * it. The batch then runs as without a key and turns the reservation into its record last, in the
 * same transaction: the invitations, their ledger entries, their `invitation.issued.v1` and the
 * record commit together, and a refusal (a 429 included) or a failure records nothing and deletes
 * the reservation.
 *
 * A key without a live row is reserved only while the organization holds fewer keyed batches than
 * its replay record budget, its live records plus its reservations under a live lease: the check
 * and the reservation are one step, serialized per organization, after the replay lookup and
 * before the daily allowances. A full budget answers `invitation-keyed-batch-limit-reached` and
 * reserves, writes, sends and emits nothing. A batch without a key never counts.
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

  /**
   * Property budget
   *
   * @description
   * The replay record budget of an organization: how many keyed batches it holds at once.
   *
   * @type {number}
   * @readonly
   */
  private readonly budget: number;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the ports of the batch and the replay record budget.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @param {Clock} clock - The time of the sending.
   * @param {number} budget - The replay record budget, `KEYED_INVITATION_BATCH_BUDGET` by default.
   * @constructor
   */
  public constructor(
    unitOfWork: OrganizationsUnitOfWork,
    clock: Clock,
    budget: number = KEYED_INVITATION_BATCH_BUDGET,
  ) {
    this.unitOfWork = unitOfWork;
    this.clock = clock;
    this.budget = budget;
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
   * `invitation-daily-limit-reached`, `invitation-keyed-batch-limit-reached`,
   * `idempotency-key-reused` or
   * `idempotency-request-in-progress`.
   */
  public async execute(input: InviteMembersInput): Promise<InviteMembersOutput> {
    const now: Date = this.clock.now();
    try {
      const addresses: EmailAddress[] = distinctAddresses(input.emails);
      if (input.idempotencyKey === undefined) {
        return await this.unitOfWork.runInRequestOrganization(
          async (store: OrganizationsStore): Promise<InviteMembersOutput> =>
            InviteMembers.issue(store, input, {
              organization: await InviteMembers.authorize(store, input),
              addresses,
              now,
            }),
        );
      }
      return await this.keyed(input, {
        key: {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          key: input.idempotencyKey,
        },
        request: InvitationBatchRequest.of(addresses, input.role),
        addresses,
        now,
      });
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }

  /**
   * Method keyed
   *
   * @description
   * Runs a keyed batch in two transactions. The first, short, settles the key: it replays a live
   * record or refuses a live reservation, or reserves the key under a lease and commits. The second
   * runs the batch and turns the reservation into its record, together with the invitations. A
   * batch that fails or is refused (a 429 included) deletes its reservation afterwards, best
   * effort, so the key runs again at once; the lease frees it otherwise.
   *
   * @param {InviteMembersInput} input - The batch.
   * @param {KeyedBatch} batch - The scoped key, the canonical batch, the distinct addresses and the
   * instant.
   * @returns {Promise<InviteMembersOutput>} The outcome, replayed or fresh.
   * @throws {OrganizationRefusal} `idempotency-request-in-progress`, `role-forbidden`,
   * `organization-not-found`, `invitation-keyed-batch-limit-reached` or
   * `invitation-daily-limit-reached`.
   * @throws {InvitationBatchKeyReusedError} For a batch that is not the one that holds the key.
   */
  private async keyed(input: InviteMembersInput, batch: KeyedBatch): Promise<InviteMembersOutput> {
    const { key, request, addresses, now } = batch;
    const settled: InviteMembersOutput | string = await this.unitOfWork.runInRequestOrganization(
      (store: OrganizationsStore): Promise<InviteMembersOutput | string> =>
        InviteMembers.reserve(store, input, batch, this.budget),
    );
    if (typeof settled !== 'string') {
      return settled;
    }
    const leaseId: string = settled;
    try {
      return await this.unitOfWork.runInRequestOrganization(
        async (store: OrganizationsStore): Promise<InviteMembersOutput> => {
          // Hold the reservation for the whole batch: past its lease, nobody may take it over.
          if (!(await store.invitationBatchReplays.renew(key, leaseId))) {
            throw new OrganizationRefusal({ reason: 'idempotency-request-in-progress' });
          }
          const output: InviteMembersOutput = await InviteMembers.issue(store, input, {
            organization: await InviteMembers.authorize(store, input),
            addresses,
            now,
          });
          if (
            !(await store.invitationBatchReplays.complete(key, leaseId, {
              request,
              invitations: output.invitations,
            }))
          ) {
            // The lease ran out and another request took the key over: this batch rolls back.
            throw new OrganizationRefusal({ reason: 'idempotency-request-in-progress' });
          }
          return output;
        },
      );
    } catch (error) {
      await this.release(key, leaseId);
      throw error;
    }
  }

  /**
   * Method release
   *
   * @description
   * Deletes the reservation of a batch that did not commit, in a transaction of its own; a failure
   * is left to the lease, which frees the key once it runs out.
   *
   * @param {InvitationBatchReplayKey} key - The scoped key.
   * @param {string} leaseId - The lease of the batch.
   * @returns {Promise<void>} Resolves once deleted, or once given up.
   */
  private async release(key: InvitationBatchReplayKey, leaseId: string): Promise<void> {
    try {
      await this.unitOfWork.runInRequestOrganization((store: OrganizationsStore): Promise<void> =>
        store.invitationBatchReplays.release(key, leaseId),
      );
    } catch {
      // The lease of `INVITATION_BATCH_LEASE_MS` frees the key.
    }
  }

  /**
   * Method authorize
   *
   * @description
   * Checks that the actor is an owner or an admin of the organization of the request, and loads it.
   *
   * @param {OrganizationsStore} store - The store of the transaction.
   * @param {InviteMembersInput} input - The batch.
   * @returns {Promise<Organization>} The organization.
   * @throws {OrganizationRefusal} `organization-not-found` or `role-forbidden`.
   */
  private static async authorize(
    store: OrganizationsStore,
    input: InviteMembersInput,
  ): Promise<Organization> {
    const actor: Member = await requireActorMembership(
      store,
      input.organizationId,
      input.actorUserId,
    );
    assertManagesOrganization(actor.role);
    const organization: Organization | null = await store.organizations.find(input.organizationId);
    if (organization === null) {
      throw new OrganizationRefusal({ reason: 'organization-not-found' });
    }
    return organization;
  }

  /**
   * Method reserve
   *
   * @description
   * The first transaction of a keyed batch: once the actor and the organization are found, settles
   * the key from its live reservation or record, or reserves it. When the key is not free for the
   * reservation (another request reserves it at that moment, or a transaction holds its expired
   * row), the request is settled from a live row if one is committed by then, and otherwise answers
   * the retryable `idempotency-request-in-progress`, whatever the body: an expired reservation's
   * fingerprint never decides a terminal `idempotency-key-reused`. A key without a live row is
   * reserved only within the replay record budget of the organization (`admit`). Nothing waits on
   * a batch.
   *
   * @param {OrganizationsStore} store - The store of the transaction.
   * @param {InviteMembersInput} input - The batch.
   * @param {KeyedBatch} batch - The scoped key and the canonical batch.
   * @param {number} budget - The replay record budget of the organization.
   * @returns {Promise<InviteMembersOutput | string>} The replayed outcome, or the id of the lease.
   */
  private static async reserve(
    store: OrganizationsStore,
    input: InviteMembersInput,
    batch: KeyedBatch,
    budget: number,
  ): Promise<InviteMembersOutput | string> {
    await InviteMembers.authorize(store, input);
    const settled: InviteMembersOutput | null = await InviteMembers.settle(store, batch);
    if (settled !== null) {
      return settled;
    }
    const budgeted: InviteMembersOutput | null = await InviteMembers.admit(store, batch, budget);
    if (budgeted !== null) {
      return budgeted;
    }
    const leaseId: string | null = await store.invitationBatchReplays.reserve(
      batch.key,
      batch.request,
    );
    if (leaseId !== null) {
      return leaseId;
    }
    const meanwhile: InviteMembersOutput | null = await InviteMembers.settle(store, batch);
    if (meanwhile !== null) {
      return meanwhile;
    }
    // The key is held without a live row: another request reserves it, a batch runs past its lease,
    // a takeover or a purge holds its expired row. Who holds it, and with which batch, is unknown,
    // so the answer is the retryable one whatever the body, never a terminal 422.
    throw new OrganizationRefusal({ reason: 'idempotency-request-in-progress' });
  }

  /**
   * Method admit
   *
   * @description
   * Checks the replay record budget of the organization for a key without a live row, as one step
   * with its reservation: the reservations of the organization are serialized from here to the
   * commit of the reservation, so concurrent new keys never take it past the budget. When no place
   * is left, a row of the key committed by a request that reserved it before this one took the
   * lock still answers as before (a replay, `409` or `422`), and a batch of the key still running
   * past its lease answers the retryable `idempotency-request-in-progress`, whatever the body, as
   * when the budget is not full (an expired reservation never decides a terminal answer);
   * otherwise the batch answers `invitation-keyed-batch-limit-reached` and the key is not reserved.
   * Nothing here waits on a batch.
   *
   * @param {OrganizationsStore} store - The store of the transaction.
   * @param {KeyedBatch} batch - The scoped key and the canonical batch.
   * @param {number} budget - The replay record budget of the organization.
   * @returns {Promise<InviteMembersOutput | null>} The stored outcome of the key, or `null` once a
   * place is left for it.
   * @throws {InvitationKeyedBatchLimitReachedError} When the organization holds `budget` keyed
   * batches.
   * @throws {OrganizationRefusal} `idempotency-request-in-progress` while a batch of the key runs.
   */
  private static async admit(
    store: OrganizationsStore,
    batch: KeyedBatch,
    budget: number,
  ): Promise<InviteMembersOutput | null> {
    await store.invitationBatchReplays.lockReservations(batch.key.organizationId);
    const usage: KeyedInvitationBatchUsage = await store.invitationBatchReplays.usage(
      batch.key.organizationId,
      budget,
    );
    try {
      assertKeyedInvitationBatchAvailable(budget, usage);
      return null;
    } catch (error) {
      const meanwhile: InviteMembersOutput | null = await InviteMembers.settle(store, batch);
      if (meanwhile !== null) {
        return meanwhile;
      }
      if (await store.invitationBatchReplays.isReserved(batch.key)) {
        // Past its lease, its batch still holds the key and may still commit: retry later.
        throw new OrganizationRefusal({ reason: 'idempotency-request-in-progress' });
      }
      throw error;
    }
  }

  /**
   * Method settle
   *
   * @description
   * Answers the live reservation or record of the key, if any, once the actor still manages the
   * organization in the snapshot of the row (a replay creates nothing, so it never waits on a role
   * change in progress): a record replays its outcome to an equivalent batch; a reservation
   * answers `idempotency-request-in-progress` to the same batch, which is still running; any other
   * batch answers `idempotency-key-reused`.
   *
   * @param {OrganizationsStore} store - The store of the transaction.
   * @param {KeyedBatch} batch - The scoped key and the canonical batch.
   * @returns {Promise<InviteMembersOutput | null>} The stored outcome, or `null` when the key is
   * free.
   * @throws {OrganizationRefusal} `organization-not-found`, `role-forbidden` or
   * `idempotency-request-in-progress`.
   * @throws {InvitationBatchKeyReusedError} For a batch that is not the one that holds the key.
   */
  private static async settle(
    store: OrganizationsStore,
    batch: KeyedBatch,
  ): Promise<InviteMembersOutput | null> {
    const stored: StoredInvitationBatch | null = await store.invitationBatchReplays.findLive(
      batch.key,
      batch.request,
    );
    return stored === null ? null : InviteMembers.answer(stored);
  }

  /**
   * Method answer
   *
   * @description
   * What a row of the key answers once the actor still manages the organization in the snapshot of
   * the row: a record its outcome to an equivalent batch, a reservation
   * `idempotency-request-in-progress` to the same batch, either `idempotency-key-reused` to another.
   *
   * @param {StoredInvitationBatch} stored - The row of the key.
   * @returns {InviteMembersOutput} The stored outcome of an equivalent batch.
   * @throws {OrganizationRefusal} `organization-not-found`, `role-forbidden` or
   * `idempotency-request-in-progress`.
   * @throws {InvitationBatchKeyReusedError} For a batch that is not the one that holds the key.
   */
  private static answer(stored: StoredInvitationBatch): InviteMembersOutput {
    if (stored.actorRole === null) {
      throw new OrganizationRefusal({ reason: 'organization-not-found' });
    }
    assertManagesOrganization(stored.actorRole);
    if (!stored.sameRequest) {
      throw new InvitationBatchKeyReusedError();
    }
    if (stored.state === 'reserved') {
      throw new OrganizationRefusal({ reason: 'idempotency-request-in-progress' });
    }
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
