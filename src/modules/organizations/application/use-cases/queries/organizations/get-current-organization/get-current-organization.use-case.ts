import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import type { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import { readSeatEntitlement } from '../../../../services/members/seat-limit.service.js';
import { toOrganizationView } from '../../../../mappers/organizations/organization-view.mapper.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { OrganizationView } from '../../../../projections/organizations/organization-view.projection.js';
import { requireActorMembership } from '../../../../services/members/actor-membership.service.js';
import type { GetCurrentOrganizationInput } from './get-current-organization.input.js';

/**
 * Class GetCurrentOrganization
 *
 * @description
 * Reads the organization of the request with the role of the actor in it
 * (`GET /internal/v1/organization`), in a read-only tenant transaction. Every role reads it; an
 * actor that does not belong to it answers `organization-not-found`.
 */
export class GetCurrentOrganization {
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
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the ports of the reading.
   *
   * @param {OrganizationsUnitOfWork} unitOfWork - The transactions of the module.
   * @constructor
   */
  public constructor(unitOfWork: OrganizationsUnitOfWork) {
    this.unitOfWork = unitOfWork;
  }
  // #endregion

  // #region Methods
  /**
   * Method execute
   *
   * @description
   * Reads the organization.
   *
   * @param {GetCurrentOrganizationInput} input - The actor and the organization.
   * @returns {Promise<OrganizationView>} The organization.
   * @throws {OrganizationRefusal} `organization-not-found`.
   */
  public execute(input: GetCurrentOrganizationInput): Promise<OrganizationView> {
    return this.unitOfWork.runInRequestOrganization(
      async (store: OrganizationsStore): Promise<OrganizationView> => {
        const actor: Member = await requireActorMembership(
          store,
          input.organizationId,
          input.actorUserId,
        );
        const organization: Organization | null = await store.organizations.find(
          input.organizationId,
        );
        if (organization === null) {
          throw new OrganizationRefusal({ reason: 'organization-not-found' });
        }
        return toOrganizationView(
          organization,
          actor.role,
          await store.members.countSeats(input.organizationId),
          (await readSeatEntitlement(store, input.organizationId)).plan,
        );
      },
      { readOnly: true },
    );
  }
  // #endregion
}
