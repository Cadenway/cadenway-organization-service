import type { Member, MemberPage } from '@cadenway/contracts/types/internal/organization-service';
import { InternalAccess, ProblemException } from '@cadenway/nest-common';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Query,
  QueryMethod,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import type { PagePosition } from '../../../../application/models/pagination/page-position.model.js';
import type { MemberView } from '../../../../application/projections/members/member-view.projection.js';
import { ChangeMemberRole } from '../../../../application/use-cases/commands/members/change-member-role/change-member-role.use-case.js';
import { RemoveMember } from '../../../../application/use-cases/commands/members/remove-member/remove-member.use-case.js';
import { GetMember } from '../../../../application/use-cases/queries/members/get-member/get-member.use-case.js';
import type { ListMembersOutput } from '../../../../application/use-cases/queries/members/list-members/list-members.output.js';
import { ListMembers } from '../../../../application/use-cases/queries/members/list-members/list-members.use-case.js';
import { ChangeMemberRoleBody } from '../../dto/input/members/change-member-role-body.dto.js';
import { ListMembersQuery } from '../../dto/input/members/list-members-query.dto.js';
import { MemberPath } from '../../dto/input/members/member-path.dto.js';
import { QueryMembersBody } from '../../dto/input/members/query-members-body.dto.js';
import { answerRefusals } from '../../errors/organizations/organization-refusal.problem.js';
import { toActorUserId, toOrganizationId } from '../../mappers/context/request-context.mapper.js';
import { toMemberResponse } from '../../mappers/members/member-response.mapper.js';
import { toNextCursor, toPagePosition } from '../../mappers/pagination/cursor.mapper.js';
import { toVersionCondition } from '../../validation/versions/if-match.validation.js';

/**
 * Class MembersController
 *
 * @description
 * The member routes of `openapi/internal/organization-service.yaml`, which the gateway calls for
 * `openapi/public/members.yaml`. Every route accepts the issuer `api-gateway` and the actor `user`
 * only, and acts on the organization of the token; organization-service decides the role rules from
 * its own members, never from the role or the scopes of the token.
 */
@Controller('internal/v1/members')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'] })
export class MembersController {
  // #region Properties
  /**
   * Property listMembers
   *
   * @description
   * Use case of the list.
   *
   * @type {ListMembers}
   * @readonly
   */
  private readonly listMembers: ListMembers;

  /**
   * Property getMember
   *
   * @description
   * Use case of the reading.
   *
   * @type {GetMember}
   * @readonly
   */
  private readonly getMember: GetMember;

  /**
   * Property changeMemberRole
   *
   * @description
   * Use case of the change of role.
   *
   * @type {ChangeMemberRole}
   * @readonly
   */
  private readonly changeMemberRole: ChangeMemberRole;

  /**
   * Property removeMember
   *
   * @description
   * Use case of the removal.
   *
   * @type {RemoveMember}
   * @readonly
   */
  private readonly removeMember: RemoveMember;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the use cases, provided by `OrganizationsModule`.
   *
   * @param {ListMembers} listMembers - Use case of the list.
   * @param {GetMember} getMember - Use case of the reading.
   * @param {ChangeMemberRole} changeMemberRole - Use case of the change of role.
   * @param {RemoveMember} removeMember - Use case of the removal.
   * @constructor
   */
  public constructor(
    listMembers: ListMembers,
    getMember: GetMember,
    changeMemberRole: ChangeMemberRole,
    removeMember: RemoveMember,
  ) {
    this.listMembers = listMembers;
    this.getMember = getMember;
    this.changeMemberRole = changeMemberRole;
    this.removeMember = removeMember;
  }
  // #endregion

  // #region Methods
  /**
   * Method list
   *
   * @description
   * `GET /internal/v1/members`: `200` with one page of members, `total` and `counts`; `400`,
   * `403 organization.role-forbidden` for a guest, `404 organization.not-found`.
   *
   * @param {ListMembersQuery} query - The filters and the page.
   * @returns {Promise<MemberPage>} The page.
   */
  @Get()
  public async list(@Query() query: ListMembersQuery): Promise<MemberPage> {
    const filters: { readonly search: string | null; readonly role: readonly string[] | null } = {
      search: query.search ?? null,
      role:
        query.role === undefined
          ? null
          : query.role.toSorted((left: string, right: string): number => left.localeCompare(right)),
    };
    const after: PagePosition | null = toPagePosition(query.cursor, filters);
    const output: ListMembersOutput = await answerRefusals(() =>
      this.listMembers.execute({
        actorUserId: toActorUserId(),
        organizationId: toOrganizationId(),
        search: query.search ?? null,
        roles: query.role ?? null,
        after,
        limit: query.limit,
      }),
    );
    return {
      items: output.page.items.map(toMemberResponse),
      nextCursor: toNextCursor(output.page.next, filters),
      total: output.total,
      counts: { ...output.counts },
    };
  }

  /** Lists members using the contract's JSON filters and the same tenant-scoped read as GET. */
  @QueryMethod()
  @HttpCode(200)
  public async queryMembers(
    @Body() body: QueryMembersBody,
    @Req() request: Request,
  ): Promise<MemberPage> {
    const length = request.headers['content-length'];
    if (
      !request.is('application/json') ||
      Number(length) === 0 ||
      (length === undefined && !request.readableDidRead)
    ) {
      throw new ProblemException({ status: 400, code: 'request.invalid' });
    }
    return this.list({
      search: body.search,
      role: body.role,
      cursor: body.cursor,
      limit: body.limit,
    });
  }

  /**
   * Method read
   *
   * @description
   * `GET /internal/v1/members/{memberId}`: `200` with the member and its `ETag`; `400`,
   * `403 organization.role-forbidden` for a guest, `404 member.not-found`.
   *
   * @param {MemberPath} path - The id of the membership.
   * @returns {Promise<Member>} The member.
   */
  @Get(':memberId')
  public async read(@Param() path: MemberPath): Promise<Member> {
    const view: MemberView = await answerRefusals(() =>
      this.getMember.execute({
        actorUserId: toActorUserId(),
        organizationId: toOrganizationId(),
        memberId: path.memberId,
      }),
    );
    return toMemberResponse(view);
  }

  /**
   * Method changeRole
   *
   * @description
   * `PATCH /internal/v1/members/{memberId}`: `200` with the member and its `ETag`; `400`,
   * `403 organization.role-forbidden`, `404 member.not-found`, `412 request.version-mismatch`,
   * `422 member.owner-protected`.
   *
   * @param {MemberPath} path - The id of the membership.
   * @param {ChangeMemberRoleBody} body - The new role.
   * @param {string | undefined} ifMatch - The `If-Match` header.
   * @returns {Promise<Member>} The member after the change.
   */
  @Patch(':memberId')
  public async changeRole(
    @Param() path: MemberPath,
    @Body() body: ChangeMemberRoleBody,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<Member> {
    const view: MemberView = await answerRefusals(() =>
      this.changeMemberRole.execute({
        actorUserId: toActorUserId(),
        organizationId: toOrganizationId(),
        memberId: path.memberId,
        role: body.role,
        expectedVersion: toVersionCondition(ifMatch),
      }),
    );
    return toMemberResponse(view);
  }

  /**
   * Method remove
   *
   * @description
   * `DELETE /internal/v1/members/{memberId}`: `204`; `400`, `403 organization.role-forbidden`,
   * `404 member.not-found`, `422 member.owner-protected`.
   *
   * @param {MemberPath} path - The id of the membership.
   * @returns {Promise<void>} Resolves once removed.
   */
  @Delete(':memberId')
  @HttpCode(204)
  public async remove(@Param() path: MemberPath): Promise<void> {
    await answerRefusals(() =>
      this.removeMember.execute({
        actorUserId: toActorUserId(),
        organizationId: toOrganizationId(),
        memberId: path.memberId,
      }),
    );
  }
  // #endregion
}
