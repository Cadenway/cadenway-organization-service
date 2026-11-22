import type {
  SearchMembership,
  SearchOrganizationPage,
} from '@cadenway/contracts/types/internal/organization-service';
import type { InternalPrincipal } from '@cadenway/nest-common';
import {
  InternalAccess,
  principalOf,
  ProblemException,
  ZodValidationPipe,
} from '@cadenway/nest-common';
import { Controller, Get, Header, Query, Req } from '@nestjs/common';

import { GetSearchMembership } from '../../../../application/use-cases/queries/search/get-search-membership/get-search-membership.use-case.js';
import { ListSearchOrganizations } from '../../../../application/use-cases/queries/search/list-search-organizations/list-search-organizations.use-case.js';
import { GetSearchMembershipQuery } from '../../dto/input/search/get-search-membership-query.dto.js';
import { ListSearchOrganizationsQuery } from '../../dto/input/search/list-search-organizations-query.dto.js';
import { answerSearchAuthority } from '../../errors/search/search-authority.problem.js';
import { toActorUserId, toOrganizationId } from '../../mappers/context/request-context.mapper.js';
import { SearchOrganizationCursor } from '../../mappers/search/search-organization-cursor.mapper.js';

const exportIssuers = ['search-service', 'identity-service'] as const;
const membershipIssuers = [...exportIssuers, 'task-service', 'realtime-gateway'] as const;

/** Supplies bounded bootstrap IDs to Search and Identity and live membership stamps to consumers. */
@Controller('internal/v1')
@InternalAccess({ issuers: ['search-service'] })
export class SearchAuthorityController {
  // #region Properties
  /** Rejects query parameters before reading the signed membership scope. */
  private readonly membershipQuery = new ZodValidationPipe(GetSearchMembershipQuery.schema);
  // #endregion

  // #region Constructor
  /** Binds the read operations and the export cursor. */
  public constructor(
    private readonly listSearchOrganizations: ListSearchOrganizations,
    private readonly getSearchMembership: GetSearchMembership,
    private readonly cursor: SearchOrganizationCursor,
  ) {}
  // #endregion

  // #region Methods
  /** Reserves the cross-tenant scan for the signing service's unscoped system actor. */
  @Get('search-organizations')
  @InternalAccess({ issuers: exportIssuers, actors: ['system'], organization: 'optional' })
  @Header('Cache-Control', 'private, no-store')
  public async list(
    @Query() query: ListSearchOrganizationsQuery,
    @Req() request: object,
  ): Promise<SearchOrganizationPage> {
    const principal = this.requireAuthorityPrincipal(request);
    if (principal.actor.type !== 'system' || principal.actor.id !== principal.issuer) {
      throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
    }
    if (principal.organizationId !== null) {
      throw new ProblemException({ status: 403, code: 'auth.organization-not-allowed' });
    }
    return answerSearchAuthority(async () => {
      const page = await this.listSearchOrganizations.execute({
        position: this.cursor.read(query.cursor),
        limit: query.limit,
      });
      return { items: [...page.items], nextCursor: this.cursor.write(page.next) };
    });
  }

  /** Proves the current membership of the signed user in the signed organization. */
  @Get('search-membership')
  @InternalAccess({ issuers: membershipIssuers, actors: ['user'], organization: 'required' })
  @Header('Cache-Control', 'private, no-store')
  public async membership(
    @Query() query: unknown,
    @Req() request: object,
  ): Promise<SearchMembership> {
    this.requireAuthorityPrincipal(request);
    this.membershipQuery.transform(query, { type: 'query' });
    return answerSearchAuthority(() =>
      this.getSearchMembership.execute({
        actorUserId: toActorUserId(),
        organizationId: toOrganizationId(),
      }),
    );
  }

  /** Other callers request a stamp using only the signed actor and tenant. */
  private requireAuthorityPrincipal(request: object): InternalPrincipal {
    const principal = principalOf(request);
    if (
      principal === undefined ||
      (principal.issuer !== 'search-service' &&
        (principal.role !== null || principal.scopes.length !== 0))
    ) {
      throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
    }
    return principal;
  }
  // #endregion
}
