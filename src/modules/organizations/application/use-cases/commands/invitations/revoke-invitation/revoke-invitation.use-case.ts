import type { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import { assertManagesOrganization } from '../../../../../domain/policies/members/member-permissions.policy.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import { requireActorMembership } from '../../../../services/members/actor-membership.service.js';
import type { RevokeInvitationInput } from './revoke-invitation.input.js';

/**
 * Class RevokeInvitation
 *
 * @description
 * Revokes a pending invitation of the organization of the request, expired or not
 * (`DELETE /internal/v1/invitations/{invitationId}`), in its tenant transaction: its link stops
 * working. The owner and the admins revoke (`role-forbidden`); revoking it again succeeds and
 * changes nothing; an answered one is refused (`invitation-answered`). Emits nothing.
 */
export class RevokeInvitation {
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
   * The time of the revocation.
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
   * Takes the ports of the revocation.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @param {Clock} clock - The time of the revocation.
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
   * Revokes the invitation.
   *
   * @param {RevokeInvitationInput} input - The actor, the organization and the invitation.
   * @returns {Promise<void>} Resolves once revoked, or at once when it was revoked already.
   * @throws {OrganizationRefusal} `organization-not-found`, `role-forbidden`,
   * `invitation-not-found` or `invitation-answered`.
   */
  public async execute(input: RevokeInvitationInput): Promise<void> {
    const now: Date = this.clock.now();
    try {
      await this.unitOfWork.runInRequestOrganization(
        async (store: OrganizationsStore): Promise<void> => {
          const actor: Member = await requireActorMembership(
            store,
            input.organizationId,
            input.actorUserId,
          );
          assertManagesOrganization(actor.role);
          const invitation: Invitation | null = await store.invitations.findForUpdate(
            input.organizationId,
            input.invitationId,
          );
          if (invitation === null) {
            throw new OrganizationRefusal({ reason: 'invitation-not-found' });
          }
          const revoked: Invitation = invitation.revoke(now);
          if (revoked !== invitation) {
            await store.invitations.update(revoked);
          }
        },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }
  // #endregion
}
