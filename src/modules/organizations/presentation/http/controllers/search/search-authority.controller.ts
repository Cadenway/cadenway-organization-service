import type {
  SearchMembership,
  SearchOrganizationPage,
} from '@cadenway/contracts/types/internal/organization-service';
import {
  getOrganizationContext,
  InternalAccess,
  ProblemException,
  ZodValidationPipe,
} from '@cadenway/nest-common';
import { Controller, Get, Header, Query } from '@nestjs/common';

import { GetSearchMembership } from '../../../../application/use-cases/queries/search/get-search-membership/get-search-membership.use-case.js';
import { ListSearchOrganizations } from '../../../../application/use-cases/queries/search/list-search-organizations/list-search-organizations.use-case.js';
import { GetSearchMembershipQuery } from '../../dto/input/search/get-search-membership-query.dto.js';
import { ListSearchOrganizationsQuery } from '../../dto/input/search/list-search-organizations-query.dto.js';
import { answerSearchAuthority } from '../../errors/search/search-authority.problem.js';
import { toActorUserId, toOrganizationId } from '../../mappers/context/request-context.mapper.js';
import { SearchOrganizationCursor } from '../../mappers/search/search-organization-cursor.mapper.js';

/** Supplies Search with bounded bootstrap IDs and live membership stamps. */
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
  /** Reserves the cross-tenant scan for the unscoped Search system actor. */
  @Get('search-organizations')
  @InternalAccess({ actors: ['system'], organization: 'optional' })
  @Header('Cache-Control', 'private, no-store')
  public async list(@Query() query: ListSearchOrganizationsQuery): Promise<SearchOrganizationPage> {
    const context = getOrganizationContext();
    if (context?.actor.type !== 'system' || context.actor.id !== 'search-service') {
      throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
    }
    if (context.organizationId !== null) {
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
  @InternalAccess({ actors: ['user'], organization: 'required' })
  @Header('Cache-Control', 'private, no-store')
  public async membership(@Query() query: unknown): Promise<SearchMembership> {
    this.membershipQuery.transform(query, { type: 'query' });
    return answerSearchAuthority(() =>
      this.getSearchMembership.execute({
        actorUserId: toActorUserId(),
        organizationId: toOrganizationId(),
      }),
    );
  }
  // #endregion
}
