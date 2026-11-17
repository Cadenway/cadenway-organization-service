import type { Invitation } from '../../../../../domain/aggregates/invitation/invitation.aggregate.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { Clock } from '../../../../ports/outbound/time/organizations/clock.port.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import {
  assertAddressedToActor,
  findAddressedInvitation,
} from '../../../../services/invitations/addressed-invitation.service.js';
import type { RefuseInvitationInput } from './refuse-invitation.input.js';

/**
 * Class RefuseInvitation
 *
 * @description
 * Refuses an invitation addressed to the actor
 * (`POST /internal/v1/users/{userId}/invitations/{invitationId}/refuse`), with the checks of the
 * acceptance in the same order, the write in the tenant transaction of the organization of the
 * invitation. It leaves both lists, and the person who invited can send a new one. Emits nothing.
 */
export class RefuseInvitation {
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
   * The time of the refusal.
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
   * Takes the ports of the refusal.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @param {Clock} clock - The time of the refusal.
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
   * Refuses the invitation.
   *
   * @param {RefuseInvitationInput} input - The actor, the account of the path and the invitation.
   * @returns {Promise<void>} Resolves once refused.
   * @throws {OrganizationRefusal} `user-not-found`, `invitation-not-found`,
   * `invitation-email-mismatch`, `invitation-revoked`, `invitation-answered` or
   * `invitation-expired`.
   */
  public async execute(input: RefuseInvitationInput): Promise<void> {
    try {
      const addressed: Invitation = await findAddressedInvitation(this.unitOfWork, input);
      const now: Date = this.clock.now();
      await this.unitOfWork.runInOrganizationOf(
        addressed,
        input.actorUserId,
        async (store: OrganizationsStore): Promise<void> => {
          const invitation: Invitation = await assertAddressedToActor(
            store,
            await store.invitations.findForUpdate(
              addressed.snapshot.organizationId,
              input.invitationId,
            ),
            input.actorUserId,
          );
          await store.invitations.update(invitation.refuse(now));
        },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }
  // #endregion
}
