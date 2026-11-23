import type { Member } from '../../../../../domain/aggregates/member/member.aggregate.js';
import type { Organization } from '../../../../../domain/aggregates/organization/organization.aggregate.js';
import { readSeatEntitlement } from '../../../../services/members/seat-limit.service.js';
import { assertManagesOrganization } from '../../../../../domain/policies/members/member-permissions.policy.js';
import type { OrganizationUpdate } from '../../../../../domain/value-objects/organizations/organization-update.value-object.js';
import { toOrganizationView } from '../../../../mappers/organizations/organization-view.mapper.js';
import { toOrganizationRefusal } from '../../../../mappers/refusals/organization-refusal.mapper.js';
import { OrganizationRefusal } from '../../../../models/refusals/organization-refusal.model.js';
import type { OrganizationsStore } from '../../../../models/transactions/organizations-store.model.js';
import type { OrganizationsUnitOfWork } from '../../../../ports/outbound/transactions/organizations/organizations-unit-of-work.port.js';
import type { OrganizationView } from '../../../../projections/organizations/organization-view.projection.js';
import { requireActorMembership } from '../../../../services/members/actor-membership.service.js';
import { assertVersionMatches } from '../../../../services/versions/version-check.service.js';
import type { UpdateOrganizationInput } from './update-organization.input.js';

/**
 * Class UpdateOrganization
 *
 * @description
 * Applies a JSON Merge Patch to the organization of the request (`PATCH /internal/v1/organization`)
 * in its tenant transaction. Checks, in order: the actor belongs to it (`organization-not-found`),
 * is its owner or an admin (`role-forbidden`), and made the change from its current version when
 * `If-Match` is given (`version-mismatch`); then the domain checks the patch and the unique index
 * the address (`slug-taken`). A patch that moves something writes the next version and appends
 * `organization.updated.v1` in the same transaction; one that moves nothing answers the same
 * version and appends nothing.
 */
export class UpdateOrganization {
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
   * Takes the ports of the change.
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
   * Changes the organization.
   *
   * @param {UpdateOrganizationInput} input - The patch, its actor and its organization.
   * @returns {Promise<OrganizationView>} The organization after the change.
   * @throws {OrganizationRefusal} `organization-not-found`, `role-forbidden`, `version-mismatch`,
   * `invalid-field` or `slug-taken`.
   */
  public async execute(input: UpdateOrganizationInput): Promise<OrganizationView> {
    try {
      return await this.unitOfWork.runInRequestOrganization(
        async (store: OrganizationsStore): Promise<OrganizationView> => {
          const actor: Member = await requireActorMembership(
            store,
            input.organizationId,
            input.actorUserId,
          );
          assertManagesOrganization(actor.role);
          const organization: Organization | null = await store.organizations.findForUpdate(
            input.organizationId,
          );
          if (organization === null) {
            throw new OrganizationRefusal({ reason: 'organization-not-found' });
          }
          assertVersionMatches(input.expectedVersion, organization.snapshot.version);
          const update: OrganizationUpdate = organization.change(input.change);
          if (update.changed.length > 0) {
            await store.organizations.update(update.organization);
            await store.events.organizationUpdated(
              update.organization,
              update.changed,
              input.actorUserId,
            );
          }
          return toOrganizationView(
            update.organization,
            actor.role,
            await store.members.countSeats(input.organizationId),
            (await readSeatEntitlement(store, input.organizationId)).plan,
          );
        },
      );
    } catch (error) {
      throw toOrganizationRefusal(error);
    }
  }
  // #endregion
}
