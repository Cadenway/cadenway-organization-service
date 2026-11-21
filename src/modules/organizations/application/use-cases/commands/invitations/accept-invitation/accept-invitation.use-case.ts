import type { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import type { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import { takesSeat } from '../../../../../domain/policies/members/seat.policy.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { MyOrganizationView } from '../../../../projections/organizations/my-organization-view.projection.js';
import {
  assertAddressedToActor,
  findAddressedInvitation,
} from '../../../../services/invitations/addressed-invitation.service.js';
import { requireAvailableSeat } from '../../../../services/members/seat-limit.service.js';
import type { AcceptInvitationInput } from './accept-invitation.input.js';

/**
 * Class AcceptInvitation
 *
 * @description
 * Makes the actor a member of the organization of an invitation, with its role
 * (`POST /internal/v1/users/{userId}/invitations/{invitationId}/accept`). The checks run in the
 * order of the contract: the actor and the invited address first, in a read-only system
 * transaction (`findAddressedInvitation`); then, in the tenant transaction of the organization of
 * the invitation, the invitation is locked, addressed to the actor again, and must still be
 * pending (`invitation-revoked`, `invitation-answered`, `invitation-expired`). The accepted invitation, the
 * membership and `member.joined.v1` commit together. An actor who is an active member of the
 * organization already keeps that membership: the invitation is accepted and nothing else changes.
 */
export class AcceptInvitation {
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
   * The time of the acceptance.
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
   * Takes the ports of the acceptance.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @param {Clock} clock - The time of the acceptance.
   * @constructor
   */
  public constructor(
    unitOfWork: OrganizationsUnitOfWork,
    clock: Clock,
    private readonly seatQuotaEnabled: boolean = false,
  ) {
    this.unitOfWork = unitOfWork;
    this.clock = clock;
  }
  // #endregion

  // #region Methods
  /**
   * Method execute
   *
   * @description
   * Accepts the invitation.
   *
   * @param {AcceptInvitationInput} input - The actor, the account of the path and the invitation.
   * @returns {Promise<MyOrganizationView>} The organization joined, as the picker lists it.
   * @throws {OrganizationRefusal} `user-not-found`, `invitation-not-found`,
   * `invitation-email-mismatch`, `invitation-revoked`, `invitation-answered` or
   * `invitation-expired`.
   */
  public async execute(input: AcceptInvitationInput): Promise<MyOrganizationView> {
    try {
      const addressed: Invitation = await findAddressedInvitation(this.unitOfWork, input);
      const organizationId: string = addressed.snapshot.organizationId;
      const now: Date = this.clock.now();
      return await this.unitOfWork.runInOrganizationOf(
        addressed,
        input.actorUserId,
        async (store: OrganizationsStore): Promise<MyOrganizationView> => {
          // The directory entry of the actor is held until the commit, before the invitation: a
          // deletion of the account under way is waited for, then leaves no verified address, and
          // a later one finds the new membership (`RemoveDeletedUser`).
          await store.directory.findForShare(input.actorUserId);
          const invitation: Invitation = await assertAddressedToActor(
            store,
            await store.invitations.findForUpdate(organizationId, input.invitationId),
            input.actorUserId,
          );
          const organization: Organization | null = await store.organizations.find(organizationId);
          if (organization === null) {
            throw new OrganizationRefusal({ reason: 'invitation-not-found' });
          }
          await store.invitations.update(invitation.accept(now));
          const member: Member = await this.membershipOf(store, invitation, input.actorUserId, now);
          return {
            id: organization.id,
            name: organization.snapshot.name,
            slug: organization.snapshot.slug,
            role: member.role,
            memberCount: await store.members.countSeats(organizationId),
            plan: organization.snapshot.plan,
            joinedAt: member.snapshot.joinedAt,
          };
        },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }

  /**
   * Method membershipOf
   *
   * @description
   * The membership the acceptance gives: a new one with the role of the invitation, with its
   * `member.joined.v1`, or the active one the actor already has.
   *
   * @param {OrganizationsStore} store - The store of the transaction.
   * @param {Invitation} invitation - The accepted invitation.
   * @param {string} actorUserId - The invitee.
   * @param {Date} now - When it is accepted.
   * @returns {Promise<Member>} The membership.
   */
  private async membershipOf(
    store: OrganizationsStore,
    invitation: Invitation,
    actorUserId: string,
    now: Date,
  ): Promise<Member> {
    const organizationId: string = invitation.snapshot.organizationId;
    const requiresSeat: boolean = this.seatQuotaEnabled && takesSeat(invitation.snapshot.role);
    if (requiresSeat) {
      await store.members.lockSeatAdmission(organizationId);
    }
    const existing: Member | null = await store.members.findActiveOfUser(
      organizationId,
      actorUserId,
    );
    if (existing !== null) {
      return existing;
    }
    if (requiresSeat) {
      await requireAvailableSeat(store, organizationId);
    }
    const joined: Member = await store.members.insert(
      Member.joining(organizationId, actorUserId, invitation.snapshot.role, invitation.id, now),
    );
    await store.events.memberJoined(joined);
    return joined;
  }
  // #endregion
}
