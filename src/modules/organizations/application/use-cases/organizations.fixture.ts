import { DirectoryUser } from '../../domain/aggregates/directory-user/directory-user.aggregate.js';
import { Invitation } from '../../domain/aggregates/invitation/invitation.aggregate.js';
import { Member } from '../../domain/aggregates/member/member.aggregate.js';
import { Organization } from '../../domain/aggregates/organization/organization.aggregate.js';
import { SlugTakenError } from '../../domain/errors/organizations/slug-taken.error.js';
import { takesSeat } from '../../domain/policies/members/seat.policy.js';
import type { SeatEntitlement } from '../../domain/value-objects/billing/seat-entitlement.value-object.js';
import { FREE_SEAT_ENTITLEMENT } from '../../domain/value-objects/billing/seat-entitlement.value-object.js';
import { EmailAddress } from '../../domain/value-objects/email/email-address.value-object.js';
import type { DirectoryUserState } from '../../domain/value-objects/directory/directory-user-state.value-object.js';
import { FORMER_MEMBER_NAME } from '../../domain/value-objects/directory/former-member-name.value-object.js';
import { invitationBatchReplayExpiresAt } from '../../domain/policies/invitations/invitation-batch-replay.policy.js';
import type { InvitationBatchRequest } from '../../domain/value-objects/invitations/invitation-batch-request.value-object.js';
import type { InvitationDraft } from '../../domain/value-objects/invitations/invitation-draft.value-object.js';
import type { InvitationEmailUsage } from '../../domain/value-objects/invitations/invitation-email-usage.value-object.js';
import type { InvitationState } from '../../domain/value-objects/invitations/invitation-state.value-object.js';
import type { MemberDraft } from '../../domain/value-objects/members/member-draft.value-object.js';
import type { MemberState } from '../../domain/value-objects/members/member-state.value-object.js';
import type { Role } from '../../domain/value-objects/members/role.value-object.js';
import type { OrganizationDraft } from '../../domain/value-objects/organizations/organization-draft.value-object.js';
import type { OrganizationState } from '../../domain/value-objects/organizations/organization-state.value-object.js';
import { searchKeyOf } from '../../domain/value-objects/search/search-key.value-object.js';
import type { InvitationBatchReplayKey } from '../models/invitations/invitation-batch-replay-key.model.js';
import type { InvitationBatchReplay } from '../models/invitations/invitation-batch-replay.model.js';
import type { InvitationMail } from '../models/invitations/invitation-mail.model.js';
import type { InvitationWithInviter } from '../models/invitations/invitation-with-inviter.model.js';
import type { StoredInvitationBatch } from '../models/invitations/stored-invitation-batch.model.js';
import type { MemberFilters } from '../models/members/member-filters.model.js';
import type { Page } from '../models/pagination/page.model.js';
import type { PagePosition } from '../models/pagination/page-position.model.js';
import type { OrganizationsStore } from '../models/transactions/organizations-store.model.js';
import type { UnitOfWorkOptions } from '../models/transactions/unit-of-work-options.model.js';
import type { Clock } from '../ports/outbound/time/organizations/clock.port.js';
import type { VerifiedEmailAuthority } from '../ports/outbound/identity/invitations/verified-email-authority.port.js';
import type { OrganizationsUnitOfWork } from '../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { InvitationOutcome } from '../projections/invitations/invitation-outcome.projection.js';
import type { InvitationView } from '../projections/invitations/invitation-view.projection.js';
import type { ReceivedInvitationView } from '../projections/invitations/received-invitation-view.projection.js';
import type { MemberView } from '../projections/members/member-view.projection.js';
import type { RoleCounts } from '../projections/members/role-counts.projection.js';
import type { MyOrganizationView } from '../projections/organizations/my-organization-view.projection.js';

/** An event appended to the fake outbox. */
export interface RecordedEvent {
  // #region Properties
  /** Name of the event. */
  readonly name: string;

  /** What the use case handed to the port. */
  readonly payload: Readonly<Record<string, unknown>>;
  // #endregion
}

/** An entry of the fake ledger of invitation emails. */
export interface RecordedEmail {
  // #region Properties
  /** The organization that caused it. */
  readonly organizationId: string;

  /** The invitation sent. */
  readonly invitationId: string;

  /** When it went out. */
  readonly sentAt: Date;
  // #endregion
}

/** A fake replay record of an invitation batch. */
interface StoredReplay {
  // #region Properties
  /** The organization of the key. */
  readonly organizationId: string;

  /** The canonical form of the batch, standing for its fingerprint. */
  readonly request: string;

  /** The outcome replayed. */
  readonly invitations: readonly InvitationOutcome[];

  /** When the replay ends. */
  readonly expiresAt: Date;
  // #endregion
}

/**
 * The scoped key of a replay record, as the primary key of `invitation_batch_replays` holds it.
 *
 * @param key - The organization, the actor and the key.
 * @returns One string per scoped key.
 */
function replayKeyOf(key: InvitationBatchReplayKey): string {
  return JSON.stringify([key.organizationId, key.actorUserId.toLowerCase(), key.key]);
}

/** The data of the fake database. */
interface Tables {
  // #region Properties
  /** Organizations by id. */
  organizations: Map<string, OrganizationState>;

  /** Memberships by id. */
  members: Map<string, MemberState>;

  /** Committed seat projections by organization. */
  seatEntitlements: Map<string, SeatEntitlement>;

  /** Invitations by id. */
  invitations: Map<string, InvitationState>;

  /** Directory entries by account. */
  directory: Map<string, DirectoryUserState>;

  /** Reservations for final account deletion. */
  deletionAttempts: Map<string, string>;

  /** The fake ledger of invitation emails. */
  invitationEmails: RecordedEmail[];

  /** The fake sender ledger, independent of tenant retention. */
  senderEmails: { readonly senderId: string; readonly sentAt: Date }[];

  /** The fake replay records, by scoped key. */
  replays: Map<string, StoredReplay>;

  /** The fake outbox. */
  events: RecordedEvent[];
  // #endregion
}

/**
 * One page of items sorted by key, then id, after a position.
 *
 * @param items - Every item with its position, sorted.
 * @param after - Where the previous page ended.
 * @param limit - Page size.
 * @returns The page.
 */
function pageOf<TItem>(
  items: readonly { readonly item: TItem; readonly position: PagePosition }[],
  after: PagePosition | null,
  limit: number,
): Page<TItem> {
  const start: number =
    after === null ? 0 : items.findIndex(({ position }) => position.id === after.id) + 1;
  const kept = items.slice(start, start + limit);
  return {
    items: kept.map(({ item }) => item),
    next: items.length > start + limit ? (kept.at(-1)?.position ?? null) : null,
  };
}

/**
 * A fake `OrganizationsUnitOfWork` holding its data in memory, committed only when the work
 * resolves. `requestOrganizationId` plays the organization of the request context; reads in a
 * transaction of an organization see its rows only, as row-level security would.
 */
export class InMemoryOrganizations implements OrganizationsUnitOfWork, VerifiedEmailAuthority {
  // #region Properties
  /** The committed data. */
  public tables: Tables = {
    organizations: new Map(),
    members: new Map(),
    seatEntitlements: new Map(),
    invitations: new Map(),
    directory: new Map(),
    deletionAttempts: new Map(),
    invitationEmails: [],
    senderEmails: [],
    replays: new Map(),
    events: [],
  };

  /** The clock of the fake database, which the replay records are written and read on. */
  public databaseClock: Clock | null = null;

  /** How each tenant transaction of a request was asked to open, in order. */
  public readonly requestOptions: UnitOfWorkOptions[] = [];

  /** Runs when a transaction gets its connection, as a slow checkout of the pool would. */
  public onCheckout: (() => void) | null = null;

  /**
   * Refuses the next claim, as another transaction holding it after its wait would, after running
   * what that transaction does meanwhile (committing a replay record, for instance).
   */
  public refuseNextClaim: (() => void) | null = null;

  /** Makes every replay record fail, as a database failure after the invitations would. */
  public failReplayRecords: boolean = false;

  /** Replay keys claimed by a run still under way, as the advisory locks of PostgreSQL. */
  private readonly claimedReplayKeys: Set<string> = new Set<string>();

  /** Ids assigned so far. */
  private ids: number = 0;
  // #endregion

  // #region Methods
  /** Returns the verified account address in the test authority. */
  public find(userId: string): Promise<EmailAddress | null> {
    const user: DirectoryUserState | undefined = this.tables.directory.get(userId);
    return Promise.resolve(
      user === undefined || user.deleted || !user.emailVerified || user.email === null
        ? null
        : EmailAddress.parse(user.email),
    );
  }

  /** Runs the work on a copy of the data, committed when it resolves. */
  public runInRequestOrganization<TResult>(
    work: (store: OrganizationsStore) => Promise<TResult>,
    options: UnitOfWorkOptions = {},
  ): Promise<TResult> {
    this.requestOptions.push(options);
    return this.run(work);
  }

  /** Runs the work on a copy of the data, committed when it resolves. */
  public runInOrganizationOf<TResult>(
    _invitation: Invitation,
    _actorUserId: string,
    work: (store: OrganizationsStore) => Promise<TResult>,
  ): Promise<TResult> {
    return this.run(work);
  }

  /** Runs the work on a copy of the data, committed when it resolves. */
  public runAcrossOrganizations<TResult>(
    work: (store: OrganizationsStore) => Promise<TResult>,
  ): Promise<TResult> {
    return this.run(work);
  }

  /** Adds an account to the directory, verified or not. */
  public withAccount(userId: string, name: string, email: string, verified: boolean = true): this {
    this.tables.directory.set(userId, {
      userId,
      name,
      nameVersion: 1,
      email,
      emailVerified: verified,
      emailVersion: verified ? 2 : 1,
      twoStepVerificationEnabled: false,
      twoStepVerificationVersion: 0,
      deleted: false,
    });
    return this;
  }

  /** Turns the two-step verification of an account of the directory on, at version 3. */
  public withTwoStepVerification(userId: string): this {
    const entry: DirectoryUserState | undefined = this.tables.directory.get(userId);
    if (entry !== undefined) {
      this.tables.directory.set(userId, {
        ...entry,
        twoStepVerificationEnabled: true,
        twoStepVerificationVersion: 3,
      });
    }
    return this;
  }

  /** The events of a name appended so far. */
  public eventsNamed(name: string): RecordedEvent[] {
    return this.tables.events.filter((event: RecordedEvent) => event.name === name);
  }

  /** The instant on the clock of the fake database. */
  private databaseNow(): Date {
    if (this.databaseClock === null) {
      throw new Error('The fake database has no clock.');
    }
    return this.databaseClock.now();
  }

  /** The next id, as PostgreSQL would assign one. */
  private nextId(): string {
    this.ids += 1;
    return `00000000-0000-7000-8000-${String(this.ids).padStart(12, '0')}`;
  }

  /** Runs the work on a copy of the data, committed when it resolves. */
  private async run<TResult>(
    work: (store: OrganizationsStore) => Promise<TResult>,
  ): Promise<TResult> {
    const tables: Tables = {
      organizations: new Map(this.tables.organizations),
      members: new Map(this.tables.members),
      seatEntitlements: new Map(this.tables.seatEntitlements),
      invitations: new Map(this.tables.invitations),
      directory: new Map(this.tables.directory),
      deletionAttempts: new Map(this.tables.deletionAttempts),
      invitationEmails: [...this.tables.invitationEmails],
      senderEmails: [...this.tables.senderEmails],
      replays: new Map(this.tables.replays),
      events: [...this.tables.events],
    };
    this.onCheckout?.();
    const claims: Set<string> = new Set<string>();
    try {
      const result: TResult = await work(this.storeOf(tables, claims));
      this.tables = tables;
      return result;
    } finally {
      for (const claim of claims) {
        this.claimedReplayKeys.delete(claim);
      }
    }
  }

  /** The repositories and the outbox bound to a copy of the data and the claims of its run. */
  private storeOf(tables: Tables, claims: Set<string>): OrganizationsStore {
    const activeMembers = (organizationId: string): MemberState[] =>
      [...tables.members.values()].filter(
        (member: MemberState) =>
          member.organizationId === organizationId && member.removedAt === null,
      );
    const nameOf = (userId: string): string => {
      const entry: DirectoryUserState | undefined = tables.directory.get(userId);
      return entry?.deleted === true ? FORMER_MEMBER_NAME : (entry?.name ?? entry?.email ?? '');
    };
    const memberView = (member: MemberState): MemberView => ({
      id: member.id,
      userId: member.userId,
      name: nameOf(member.userId),
      email: tables.directory.get(member.userId)?.email ?? '',
      role: member.role,
      joinedAt: member.joinedAt,
      version: member.version,
      twoStepVerificationEnabled:
        tables.directory.get(member.userId)?.twoStepVerificationEnabled ?? false,
    });
    const seats = (organizationId: string): number =>
      activeMembers(organizationId).filter((member: MemberState) => takesSeat(member.role)).length;
    const matching = (organizationId: string, filters: MemberFilters): MemberState[] =>
      activeMembers(organizationId).filter((member: MemberState) => {
        const view: MemberView = memberView(member);
        return (
          (filters.roles === null || filters.roles.includes(member.role)) &&
          (filters.search === null ||
            searchKeyOf(view.name).includes(filters.search) ||
            view.email.includes(filters.search))
        );
      });
    return {
      organizations: {
        insert: (draft: OrganizationDraft): Promise<Organization> => {
          if ([...tables.organizations.values()].some((other) => other.slug === draft.slug)) {
            return Promise.reject(new SlugTakenError(draft.slug));
          }
          const state: OrganizationState = { ...draft, id: this.nextId() };
          tables.organizations.set(state.id, state);
          return Promise.resolve(Organization.restore(state));
        },
        find: (organizationId: string): Promise<Organization | null> => {
          const state: OrganizationState | undefined = tables.organizations.get(organizationId);
          return Promise.resolve(state === undefined ? null : Organization.restore(state));
        },
        findForUpdate: (organizationId: string): Promise<Organization | null> => {
          const state: OrganizationState | undefined = tables.organizations.get(organizationId);
          return Promise.resolve(state === undefined ? null : Organization.restore(state));
        },
        update: (organization: Organization): Promise<void> => {
          const taken: boolean = [...tables.organizations.values()].some(
            (other) => other.slug === organization.snapshot.slug && other.id !== organization.id,
          );
          if (taken) {
            return Promise.reject(new SlugTakenError(organization.snapshot.slug));
          }
          tables.organizations.set(organization.id, organization.snapshot);
          return Promise.resolve();
        },
        countActiveSeats: (organizationId: string): Promise<number | null> =>
          Promise.resolve(tables.organizations.has(organizationId) ? seats(organizationId) : null),
        listOfUser: (
          userId: string,
          after: PagePosition | null,
          limit: number,
        ): Promise<Page<MyOrganizationView>> => {
          const items = [...tables.members.values()]
            .filter((member: MemberState) => member.userId === userId && member.removedAt === null)
            .flatMap((member: MemberState) => {
              const organization: OrganizationState | undefined = tables.organizations.get(
                member.organizationId,
              );
              return organization === undefined
                ? []
                : [
                    {
                      item: {
                        id: organization.id,
                        name: organization.name,
                        slug: organization.slug,
                        role: member.role,
                        memberCount: seats(organization.id),
                        plan: (
                          tables.seatEntitlements.get(organization.id) ?? FREE_SEAT_ENTITLEMENT
                        ).plan,
                        joinedAt: member.joinedAt,
                      },
                      position: { key: searchKeyOf(organization.name), id: organization.id },
                    },
                  ];
            })
            .sort((left, right) => left.position.key.localeCompare(right.position.key));
          return Promise.resolve(pageOf(items, after, limit));
        },
      },
      members: {
        insert: (draft: MemberDraft): Promise<Member> => {
          const state: MemberState = { ...draft, id: this.nextId(), removedAt: null };
          tables.members.set(state.id, state);
          return Promise.resolve(Member.restore(state));
        },
        findActiveOfUser: (organizationId: string, userId: string): Promise<Member | null> => {
          const state: MemberState | undefined = activeMembers(organizationId).find(
            (member: MemberState) => member.userId === userId,
          );
          return Promise.resolve(state === undefined ? null : Member.restore(state));
        },
        lockActorAndTarget: (
          organizationId: string,
          actorUserId: string,
          memberId: string,
        ): Promise<readonly Member[]> =>
          Promise.resolve(
            activeMembers(organizationId)
              .filter((row: MemberState) => row.userId === actorUserId || row.id === memberId)
              .map((row: MemberState) => Member.restore(row)),
          ),
        findActiveOfAccountForUpdate: (userId: string): Promise<readonly Member[]> =>
          Promise.resolve(
            [...tables.members.values()]
              .filter(
                (member: MemberState) => member.userId === userId && member.removedAt === null,
              )
              .map((member: MemberState) => Member.restore(member)),
          ),
        listOwnedOrganizationIds: (userId: string, limit: number): Promise<readonly string[]> =>
          Promise.resolve(
            [...tables.members.values()]
              .filter(
                (member) =>
                  member.userId === userId && member.removedAt === null && member.role === 'owner',
              )
              .map(({ organizationId }) => organizationId)
              .sort()
              .slice(0, limit),
          ),
        update: (member: Member): Promise<void> => {
          tables.members.set(member.id, member.snapshot);
          return Promise.resolve();
        },
        hasActiveMemberWithEmail: (organizationId: string, email: EmailAddress): Promise<boolean> =>
          Promise.resolve(
            activeMembers(organizationId).some(
              (member: MemberState) =>
                tables.directory.get(member.userId)?.emailVerified === true &&
                tables.directory.get(member.userId)?.email === email.value,
            ),
          ),
        lockSeatAdmission: (): Promise<void> => Promise.resolve(),
        countSeats: (organizationId: string): Promise<number> =>
          Promise.resolve(seats(organizationId)),
        countByRole: (organizationId: string): Promise<RoleCounts> => {
          const count = (role: Role): number =>
            activeMembers(organizationId).filter((member: MemberState) => member.role === role)
              .length;
          return Promise.resolve({
            owner: count('owner'),
            admin: count('admin'),
            member: count('member'),
            guest: count('guest'),
          });
        },
        view: (organizationId: string, memberId: string): Promise<MemberView | null> => {
          const state: MemberState | undefined = activeMembers(organizationId).find(
            (member: MemberState) => member.id === memberId,
          );
          return Promise.resolve(state === undefined ? null : memberView(state));
        },
        list: (
          organizationId: string,
          filters: MemberFilters,
          after: PagePosition | null,
          limit: number,
        ): Promise<Page<MemberView>> => {
          const items = matching(organizationId, filters)
            .map((member: MemberState) => ({
              item: memberView(member),
              position: { key: searchKeyOf(nameOf(member.userId)), id: member.id },
            }))
            .sort((left, right) => left.position.key.localeCompare(right.position.key));
          return Promise.resolve(pageOf(items, after, limit));
        },
        count: (organizationId: string, filters: MemberFilters): Promise<number> =>
          Promise.resolve(matching(organizationId, filters).length),
      },
      seatEntitlements: {
        find: (organizationId: string): Promise<SeatEntitlement | null> =>
          Promise.resolve(tables.seatEntitlements.get(organizationId) ?? null),
        writeNext: (
          organizationId: string,
          expectedVersion: number,
          entitlement: SeatEntitlement,
        ): Promise<boolean> => {
          const currentVersion = tables.seatEntitlements.get(organizationId)?.version ?? 0;
          if (currentVersion !== expectedVersion || entitlement.version <= expectedVersion) {
            return Promise.resolve(false);
          }
          tables.seatEntitlements.set(organizationId, entitlement);
          return Promise.resolve(true);
        },
      },
      invitations: {
        insertPending: (draft: InvitationDraft): Promise<Invitation | null> => {
          const exists: boolean = [...tables.invitations.values()].some(
            (other) =>
              other.organizationId === draft.organizationId &&
              other.email === draft.email &&
              other.status === 'pending',
          );
          if (exists) {
            return Promise.resolve(null);
          }
          const state: InvitationState = { ...draft, id: this.nextId() };
          tables.invitations.set(state.id, state);
          return Promise.resolve(Invitation.restore(state));
        },
        findPendingTo: (
          organizationId: string,
          email: EmailAddress,
        ): Promise<Invitation | null> => {
          const state: InvitationState | undefined = [...tables.invitations.values()].find(
            (other) =>
              other.organizationId === organizationId &&
              other.email === email.value &&
              other.status === 'pending',
          );
          return Promise.resolve(state === undefined ? null : Invitation.restore(state));
        },
        findForUpdate: (
          organizationId: string,
          invitationId: string,
        ): Promise<Invitation | null> => {
          const state: InvitationState | undefined = tables.invitations.get(invitationId);
          return Promise.resolve(
            state?.organizationId === organizationId ? Invitation.restore(state) : null,
          );
        },
        findWithInviter: (
          organizationId: string,
          invitationId: string,
        ): Promise<InvitationWithInviter | null> => {
          const state: InvitationState | undefined = tables.invitations.get(invitationId);
          return Promise.resolve(
            state?.organizationId === organizationId
              ? {
                  invitation: Invitation.restore(state),
                  invitedBy: { userId: state.invitedByUserId, name: nameOf(state.invitedByUserId) },
                  readAt: this.databaseNow(),
                }
              : null,
          );
        },
        find: (invitationId: string): Promise<Invitation | null> => {
          const state: InvitationState | undefined = tables.invitations.get(invitationId);
          return Promise.resolve(state === undefined ? null : Invitation.restore(state));
        },
        update: (invitation: Invitation): Promise<void> => {
          tables.invitations.set(invitation.id, invitation.snapshot);
          return Promise.resolve();
        },
        listPending: (
          organizationId: string,
          now: Date,
          after: PagePosition | null,
          limit: number,
        ): Promise<Page<InvitationView>> => {
          const items = [...tables.invitations.values()]
            .filter(
              (other) => other.organizationId === organizationId && other.status === 'pending',
            )
            .sort((left, right) => right.sentAt.getTime() - left.sentAt.getTime())
            .map((state: InvitationState) => ({
              item: {
                id: state.id,
                email: state.email,
                role: state.role,
                invitedBy: { userId: state.invitedByUserId, name: nameOf(state.invitedByUserId) },
                status: Invitation.pendingStatusAt(state.expiresAt, now),
                sentAt: state.sentAt,
                expiresAt: state.expiresAt,
                version: state.version,
              },
              position: { key: state.sentAt.toISOString(), id: state.id },
            }));
          return Promise.resolve(pageOf(items, after, limit));
        },
        countPending: (organizationId: string): Promise<number> =>
          Promise.resolve(
            [...tables.invitations.values()].filter(
              (other) => other.organizationId === organizationId && other.status === 'pending',
            ).length,
          ),
        listReceived: (
          email: EmailAddress,
          now: Date,
          after: PagePosition | null,
          limit: number,
        ): Promise<Page<ReceivedInvitationView>> => {
          const items = [...tables.invitations.values()]
            .filter(
              (other) =>
                other.email === email.value &&
                other.status === 'pending' &&
                other.expiresAt.getTime() > now.getTime(),
            )
            .flatMap((state: InvitationState) => {
              const organization: OrganizationState | undefined = tables.organizations.get(
                state.organizationId,
              );
              return organization === undefined
                ? []
                : [
                    {
                      item: {
                        id: state.id,
                        organization: {
                          id: organization.id,
                          name: organization.name,
                          slug: organization.slug,
                          description: organization.description,
                          memberCount: seats(organization.id),
                        },
                        role: state.role,
                        invitedBy: {
                          userId: state.invitedByUserId,
                          name: nameOf(state.invitedByUserId),
                        },
                        expiresAt: state.expiresAt,
                      },
                      position: { key: state.sentAt.toISOString(), id: state.id },
                    },
                  ];
            });
          return Promise.resolve(pageOf(items, after, limit));
        },
      },
      invitationBatchReplays: {
        tryClaim: (
          key: InvitationBatchReplayKey,
          request: InvitationBatchRequest,
        ): Promise<boolean> => {
          const claim: string = JSON.stringify([replayKeyOf(key), request.canonical]);
          const refusal: (() => void) | null = this.refuseNextClaim;
          if (refusal !== null) {
            this.refuseNextClaim = null;
            refusal();
            return Promise.resolve(false);
          }
          if (this.claimedReplayKeys.has(claim)) {
            return Promise.resolve(false);
          }
          this.claimedReplayKeys.add(claim);
          claims.add(claim);
          return Promise.resolve(true);
        },
        findLive: (
          key: InvitationBatchReplayKey,
          request: InvitationBatchRequest,
        ): Promise<StoredInvitationBatch | null> => {
          // A read of PostgreSQL under READ COMMITTED sees what other runs committed meanwhile.
          const stored: StoredReplay | undefined =
            tables.replays.get(replayKeyOf(key)) ?? this.tables.replays.get(replayKeyOf(key));
          return Promise.resolve(
            stored === undefined || stored.expiresAt.getTime() <= this.databaseNow().getTime()
              ? null
              : {
                  sameRequest: stored.request === request.canonical,
                  invitations: stored.invitations,
                  actorRole:
                    activeMembers(key.organizationId).find(
                      (member: MemberState) => member.userId === key.actorUserId.toLowerCase(),
                    )?.role ?? null,
                },
          );
        },
        record: (
          key: InvitationBatchReplayKey,
          replay: InvitationBatchReplay,
        ): Promise<boolean> => {
          if (this.failReplayRecords) {
            return Promise.reject(new Error('The replay record could not be written.'));
          }
          const now: Date = this.databaseNow();
          const claim: string = replayKeyOf(key);
          const expired = (entry: StoredReplay | undefined): boolean =>
            entry !== undefined && entry.expiresAt.getTime() <= now.getTime();
          if (expired(tables.replays.get(claim))) {
            tables.replays.delete(claim);
          }
          const others: string[] = [...tables.replays]
            .filter(([, entry]) => entry.organizationId === key.organizationId && expired(entry))
            .map(([stored]) => stored)
            .slice(0, 10);
          for (const stored of others) {
            tables.replays.delete(stored);
          }
          const committed: StoredReplay | undefined = this.tables.replays.get(claim);
          if (tables.replays.has(claim) || (committed !== undefined && !expired(committed))) {
            return Promise.resolve(false);
          }
          tables.replays.set(claim, {
            organizationId: key.organizationId,
            request: replay.request.canonical,
            invitations: replay.invitations,
            expiresAt: invitationBatchReplayExpiresAt(now),
          });
          return Promise.resolve(true);
        },
      },
      invitationEmails: {
        lockUsage: (organizationId: string, windowStart: Date): Promise<InvitationEmailUsage> => {
          tables.invitationEmails = tables.invitationEmails.filter(
            (entry: RecordedEmail) =>
              entry.organizationId !== organizationId ||
              entry.sentAt.getTime() > windowStart.getTime(),
          );
          const counted: RecordedEmail[] = tables.invitationEmails.filter(
            (entry: RecordedEmail) => entry.organizationId === organizationId,
          );
          const oldest: number = Math.min(
            ...counted.map((entry: RecordedEmail) => entry.sentAt.getTime()),
          );
          return Promise.resolve({
            count: counted.length,
            oldestSentAt: counted.length === 0 ? null : new Date(oldest),
          });
        },
        lockSenderUsage: (senderId: string, windowStart: Date): Promise<InvitationEmailUsage> => {
          tables.senderEmails = tables.senderEmails.filter(
            (entry) => entry.senderId !== senderId || entry.sentAt > windowStart,
          );
          const counted = tables.senderEmails.filter((entry) => entry.senderId === senderId);
          const oldest = Math.min(...counted.map((entry) => entry.sentAt.getTime()));
          return Promise.resolve({
            count: counted.length,
            oldestSentAt: counted.length === 0 ? null : new Date(oldest),
          });
        },
        record: (invitation: Invitation, senderId: string): Promise<void> => {
          tables.invitationEmails.push({
            organizationId: invitation.snapshot.organizationId,
            invitationId: invitation.id,
            sentAt: invitation.snapshot.sentAt,
          });
          tables.senderEmails.push({ senderId, sentAt: invitation.snapshot.sentAt });
          return Promise.resolve();
        },
      },
      directory: {
        find: (userId: string): Promise<DirectoryUser | null> => {
          const state: DirectoryUserState | undefined = tables.directory.get(userId);
          return Promise.resolve(state === undefined ? null : DirectoryUser.restore(state));
        },
        findForShare: (userId: string): Promise<DirectoryUser | null> => {
          const state: DirectoryUserState | undefined = tables.directory.get(userId);
          return Promise.resolve(state === undefined ? null : DirectoryUser.restore(state));
        },
        lock: (userId: string): Promise<DirectoryUser> => {
          const state: DirectoryUserState | undefined = tables.directory.get(userId);
          return Promise.resolve(
            state === undefined ? DirectoryUser.unknown(userId) : DirectoryUser.restore(state),
          );
        },
        findForUpdate: (userId: string): Promise<DirectoryUser | null> => {
          const state = tables.directory.get(userId);
          return Promise.resolve(state === undefined ? null : DirectoryUser.restore(state));
        },
        findDeletionAttempt: (userId: string): Promise<string | null> =>
          Promise.resolve(tables.deletionAttempts.get(userId) ?? null),
        reserveDeletion: (userId: string, attemptId: string): Promise<void> => {
          tables.deletionAttempts.set(userId, attemptId);
          return Promise.resolve();
        },
        save: (user: DirectoryUser): Promise<void> => {
          if (user.isDeleted) tables.deletionAttempts.delete(user.userId);
          tables.directory.set(user.userId, user.snapshot);
          return Promise.resolve();
        },
      },
      events: {
        organizationCreated: (organization: Organization): Promise<void> => {
          tables.events.push({
            name: 'organization.created.v1',
            payload: { ...organization.snapshot },
          });
          return Promise.resolve();
        },
        organizationUpdated: (
          organization: Organization,
          changed: readonly string[],
          actorUserId: string,
        ): Promise<void> => {
          tables.events.push({
            name: 'organization.updated.v1',
            payload: { ...organization.snapshot, changed, actorUserId },
          });
          return Promise.resolve();
        },
        memberJoined: (member: Member): Promise<void> => {
          tables.events.push({ name: 'member.joined.v1', payload: { ...member.snapshot } });
          return Promise.resolve();
        },
        memberRoleChanged: (
          member: Member,
          previousRole: Role,
          actorUserId: string,
        ): Promise<void> => {
          tables.events.push({
            name: 'member.role-changed.v1',
            payload: { ...member.snapshot, previousRole, actorUserId },
          });
          return Promise.resolve();
        },
        memberRemoved: (member: Member, actorUserId: string): Promise<void> => {
          tables.events.push({
            name: 'member.removed.v1',
            payload: { ...member.snapshot, actorUserId },
          });
          return Promise.resolve();
        },
        memberRemovedBySystem: (member: Member): Promise<void> => {
          tables.events.push({
            name: 'member.removed.v1',
            payload: { ...member.snapshot, actor: 'system' },
          });
          return Promise.resolve();
        },
        invitationIssued: (invitation: Invitation, mail: InvitationMail): Promise<void> => {
          tables.events.push({
            name: 'invitation.issued.v1',
            payload: { ...invitation.snapshot, ...mail },
          });
          return Promise.resolve();
        },
      },
    };
  }
  // #endregion
}

/** A clock that stays on an instant until a spec moves it. */
export class FixedClock implements Clock {
  // #region Properties
  /** The current instant, in milliseconds. */
  private instant: number;
  // #endregion

  // #region Constructor
  /** Starts the clock at an ISO 8601 instant. */
  public constructor(iso: string) {
    this.instant = Date.parse(iso);
  }
  // #endregion

  // #region Methods
  /** Returns the current instant. */
  public now(): Date {
    return new Date(this.instant);
  }

  /** Moves the clock forward. */
  public advance(milliseconds: number): void {
    this.instant += milliseconds;
  }
  // #endregion
}

/** Parses an address of the specs. */
export function address(raw: string): EmailAddress {
  return EmailAddress.parse(raw);
}
