import { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import type { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import {
  assertInvitationBatchAvailable,
  invitationEmailWindowStart,
} from '../../../../../domain/policies/invitations/invitation-email-allowance.policy.js';
import { assertManagesOrganization } from '../../../../../domain/policies/members/member-permissions.policy.js';
import type { InvitationEmailUsage } from '../../../../../domain/value-objects/invitations/invitation-email-usage.value-object.js';
import type { InvitationState } from '../../../../../domain/value-objects/invitations/invitation-state.value-object.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { InvitationView } from '../../../../projections/invitations/invitation-view.projection.js';
import { senderNameOf } from '../../../../services/invitations/sender-name.service.js';
import { requireActorMembership } from '../../../../services/members/actor-membership.service.js';
import type { ResendInvitationInput } from './resend-invitation.input.js';

/**
 * Class ResendInvitation
 *
 * @description
 * Sends a pending invitation of the organization of the request again, expired or not
 * (`POST /internal/v1/invitations/{invitationId}/resend`), in its tenant transaction: its 7 days
 * start again and `invitation.issued.v1` is appended with the next version (decision 5 of P2b).
 * The owner and the admins resend (`role-forbidden`); an unknown invitation, or one of another
 * organization, answers `invitation-not-found`; a revoked or answered one `invitation-revoked` or
 * `invitation-answered`. The email names the one who resends it as its sender; the pending list
 * keeps naming who invited first ("Invité par {nom}").
 *
 * Once the invitation is found and pending, two limits apply in the order of the contract
 * (decision 1 of the P2b security follow-ups): a resend less than an hour after its last sending
 * answers `invitation-resend-throttled`, and a resend takes one invitation email of the daily
 * allowance of the organization, `invitation-daily-limit-reached` with none left. The ledger of the
 * organization is locked before the invitation, the order every writer of the ledger follows. A
 * refused resend changes, records and emits nothing.
 */
export class ResendInvitation {
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
   * The time of the resend.
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
   * Takes the ports of the resend.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @param {Clock} clock - The time of the resend.
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
   * Resends the invitation.
   *
   * @param {ResendInvitationInput} input - The actor, the organization and the invitation.
   * @returns {Promise<InvitationView>} The invitation with its new expiry.
   * @throws {OrganizationRefusal} `organization-not-found`, `role-forbidden`,
   * `invitation-not-found`, `invitation-revoked`, `invitation-answered`,
   * `invitation-resend-throttled` or `invitation-daily-limit-reached`.
   */
  public async execute(input: ResendInvitationInput): Promise<InvitationView> {
    const now: Date = this.clock.now();
    try {
      return await this.unitOfWork.runInRequestOrganization(
        async (store: OrganizationsStore): Promise<InvitationView> => {
          const actor: Member = await requireActorMembership(
            store,
            input.organizationId,
            input.actorUserId,
          );
          assertManagesOrganization(actor.role);
          const windowStart = invitationEmailWindowStart(now);
          const senderUsage = await store.invitationEmails.lockSenderUsage(
            input.actorUserId,
            windowStart,
          );
          const usage: InvitationEmailUsage = await store.invitationEmails.lockUsage(
            input.organizationId,
            windowStart,
          );
          const invitation: Invitation | null = await store.invitations.findForUpdate(
            input.organizationId,
            input.invitationId,
          );
          const organization: Organization | null = await store.organizations.find(
            input.organizationId,
          );
          if (invitation === null || organization === null) {
            throw new OrganizationRefusal({ reason: 'invitation-not-found' });
          }
          const resent: Invitation = invitation.resend(now);
          assertInvitationBatchAvailable(senderUsage, usage, 1, now);
          await store.invitations.update(resent);
          await store.invitationEmails.record(resent, input.actorUserId);
          await store.events.invitationIssued(resent, {
            inviterUserId: input.actorUserId,
            inviterName: await senderNameOf(store, input.actorUserId),
            organizationName: organization.snapshot.name,
            memberCount: await store.members.countSeats(input.organizationId),
            language: organization.snapshot.defaultLanguage,
          });
          const state: InvitationState = resent.snapshot;
          return {
            id: state.id,
            email: state.email,
            role: state.role,
            invitedBy: {
              userId: state.invitedByUserId,
              name: await senderNameOf(store, state.invitedByUserId),
            },
            status: Invitation.pendingStatusAt(state.expiresAt, now),
            sentAt: state.sentAt,
            expiresAt: state.expiresAt,
            version: state.version,
          };
        },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }
  // #endregion
}
