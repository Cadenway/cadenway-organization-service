import type {
  BillingActiveSeatCount,
  BillingMembershipPage,
  BillingOrganizationPage,
} from '@cadenway/contracts/types/internal/organization-service';
import { getOrganizationContext, InternalAccess, ProblemException } from '@cadenway/nest-common';
import { Controller, Get, Header, Query } from '@nestjs/common';

import { GetBillingActiveSeatCount } from '../../../../application/use-cases/queries/billing/get-billing-active-seat-count/get-billing-active-seat-count.use-case.js';
import { ListBillingMemberships } from '../../../../application/use-cases/queries/billing/list-billing-memberships/list-billing-memberships.use-case.js';
import { ListSearchOrganizations } from '../../../../application/use-cases/queries/search/list-search-organizations/list-search-organizations.use-case.js';
import { BillingMembershipsQuery } from '../../dto/input/billing/billing-memberships-query.dto.js';
import { BillingOrganizationsQuery } from '../../dto/input/billing/billing-organizations-query.dto.js';
import { answerSearchAuthority } from '../../errors/search/search-authority.problem.js';
import { BillingAuthorityCursor } from '../../mappers/billing/billing-authority-cursor.mapper.js';
import { toOrganizationId } from '../../mappers/context/request-context.mapper.js';

/** Supplies Billing with bounded organization and tenant membership snapshots. */
@Controller('internal/v1')
@InternalAccess({ issuers: ['billing-service'], actors: ['system'] })
export class BillingAuthorityController {
  // #region Constructor
  /** Binds the snapshot queries and the deployment-scoped cursor signer. */
  public constructor(
    private readonly organizations: ListSearchOrganizations,
    private readonly memberships: ListBillingMemberships,
    private readonly cursor: BillingAuthorityCursor,
    private readonly activeSeats: GetBillingActiveSeatCount,
  ) {}
  // #endregion

  // #region Methods
  /** Lists organization IDs for the unscoped Billing system actor. */
  @Get('billing-organizations')
  @InternalAccess({ organization: 'optional' })
  @Header('Cache-Control', 'private, no-store')
  public async listOrganizations(
    @Query() query: BillingOrganizationsQuery,
  ): Promise<BillingOrganizationPage> {
    const context = getOrganizationContext();
    if (context?.actor.type !== 'system' || context.actor.id !== 'billing-service') {
      throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
    }
    if (context.organizationId !== null)
      throw new ProblemException({ status: 403, code: 'auth.organization-not-allowed' });
    return answerSearchAuthority(async () => {
      const position = this.cursor.read(query.cursor, 'organizations', null);
      if (position?.upperId === null)
        throw new ProblemException({ status: 400, code: 'request.invalid' });
      const page = await this.organizations.execute({
        position:
          position?.upperId == null
            ? null
            : { upperId: position.upperId, afterId: position.afterId },
        limit: query.limit,
      });
      return {
        items: [...page.items],
        nextCursor: this.cursor.write(page.next, 'organizations', null),
      };
    });
  }

  /** Lists active and removed membership versions for the signed tenant. */
  @Get('billing-memberships')
  @InternalAccess({ organization: 'required' })
  @Header('Cache-Control', 'private, no-store')
  public async listMemberships(
    @Query() query: BillingMembershipsQuery,
  ): Promise<BillingMembershipPage> {
    const context = getOrganizationContext();
    if (context?.actor.type !== 'system' || context.actor.id !== 'billing-service') {
      throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
    }
    const organizationId = toOrganizationId();
    return answerSearchAuthority(async () => {
      const position = this.cursor.read(query.cursor, 'memberships', organizationId);
      if (position?.upperId === null)
        throw new ProblemException({ status: 400, code: 'request.invalid' });
      const page = await this.memberships.execute({
        organizationId,
        position:
          position?.upperId == null
            ? null
            : { upperId: position.upperId, afterId: position.afterId },
        limit: query.limit,
      });
      if (page === null)
        throw new ProblemException({ status: 404, code: 'organization.not-found' });
      return {
        items: [...page.items],
        nextCursor: this.cursor.write(page.nextPosition, 'memberships', organizationId),
      };
    });
  }

  /** Counts current billable memberships in the tenant selected by the verified Billing token. */
  @Get('billing-active-seats')
  @InternalAccess({ organization: 'required' })
  @Header('Cache-Control', 'private, no-store')
  public async getActiveSeatCount(): Promise<BillingActiveSeatCount> {
    const context = getOrganizationContext();
    if (context?.actor.type !== 'system' || context.actor.id !== 'billing-service') {
      throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
    }
    const organizationId = toOrganizationId();
    return answerSearchAuthority(async () => {
      const activeSeatCount = await this.activeSeats.execute(organizationId);
      if (activeSeatCount === null)
        throw new ProblemException({ status: 404, code: 'organization.not-found' });
      return { activeSeatCount };
    });
  }
  // #endregion
}
