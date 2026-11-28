import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { assertManagesOrganization } from '../../../../../domain/policies/members/member-permissions.policy.js';
import type { InvitationLifecycle } from '../../../../../domain/value-objects/invitations/invitation-lifecycle.value-object.js';
import type { InvitationState } from '../../../../../domain/value-objects/invitations/invitation-state.value-object.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import type { InvitationWithInviter } from '../../../../models/invitations/invitation-with-inviter.model.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { InvitationStateView } from '../../../../projections/invitations/invitation-state-view.projection.js';
import { requireActorMembership } from '../../../../services/members/actor-membership.service.js';
import type { GetInvitationInput } from './get-invitation.input.js';

/**
 * Class GetInvitation
 *
 * @description
 * Reads one invitation of the organization of the request in any state
 * (`GET /internal/v1/invitations/{invitationId}`), so a client that lost an answer tells a revoked
 * invitation from an accepted or refused one. The owner and the admins read it, as they see the
 * pending list (`role-forbidden` otherwise); an actor outside the organization answers
 * `organization-not-found`, and an invitation of another organization `invitation-not-found`
 * (decision 9 of P2b). One read-only tenant transaction.
 */
export class GetInvitation {
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
   * The instant that tells `pending` from `expired`.
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
   * Takes the ports of the read.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @param {Clock} clock - The instant of the read.
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
   * Reads the invitation.
   *
   * @param {GetInvitationInput} input - The actor, the organization and the invitation.
   * @returns {Promise<InvitationStateView>} The invitation and its state.
   * @throws {OrganizationRefusal} `organization-not-found`, `role-forbidden` or
   * `invitation-not-found`.
   */
  public async execute(input: GetInvitationInput): Promise<InvitationStateView> {
    const now: Date = this.clock.now();
    try {
      return await this.unitOfWork.runInRequestOrganization(
        async (store: OrganizationsStore): Promise<InvitationStateView> => {
          const actor: Member = await requireActorMembership(
            store,
            input.organizationId,
            input.actorUserId,
          );
          assertManagesOrganization(actor.role);
          const found: InvitationWithInviter | null = await store.invitations.findWithInviter(
            input.organizationId,
            input.invitationId,
          );
          if (found === null) {
            throw new OrganizationRefusal({ reason: 'invitation-not-found' });
          }
          const state: InvitationState = found.invitation.snapshot;
          const lifecycle: InvitationLifecycle = found.invitation.lifecycleAt(now);
          return {
            id: state.id,
            email: state.email,
            role: state.role,
            invitedBy: found.invitedBy,
            status: lifecycle.status,
            sentAt: state.sentAt,
            expiresAt: state.expiresAt,
            answeredAt: lifecycle.answeredAt,
            revokedAt: lifecycle.revokedAt,
            version: state.version,
          };
        },
        { readOnly: true },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }
  // #endregion
}
