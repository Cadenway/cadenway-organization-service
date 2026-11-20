import type { MemberNameLookupResult } from '@cadenway/contracts/types/internal/organization-service';
import { InternalAccess } from '@cadenway/nest-common';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { LookupMemberNames } from '../../../../application/use-cases/queries/members/lookup-member-names/lookup-member-names.use-case.js';
import { MemberNameLookupBody } from '../../dto/input/members/member-name-lookup-body.dto.js';
import { answerRefusals } from '../../errors/organizations/organization-refusal.problem.js';
import { toActorUserId, toOrganizationId } from '../../mappers/context/request-context.mapper.js';

/** Resolves current member names for the gateway within the verified organization. */
@Controller('internal/v1/member-names')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'] })
export class MemberNamesController {
  // #region Constructor
  /** Binds the tenant-scoped name lookup. */
  public constructor(private readonly lookupMemberNames: LookupMemberNames) {}
  // #endregion

  // #region Methods
  /** Returns only account identifiers and names after validating the caller's membership. */
  @Post('lookup')
  @HttpCode(200)
  public async lookup(@Body() body: MemberNameLookupBody): Promise<MemberNameLookupResult> {
    const output = await answerRefusals(() =>
      this.lookupMemberNames.execute({
        actorUserId: toActorUserId(),
        organizationId: toOrganizationId(),
        userIds: body.userIds,
      }),
    );
    return { items: output.items.map(({ userId, name }) => ({ userId, name })) };
  }
  // #endregion
}
