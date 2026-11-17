import type {
  Invitation,
  InvitationBatchResult,
  InvitationPage,
} from '@cadenway/contracts/types/internal/organization-service';
import { InternalAccess } from '@cadenway/nest-common';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import type { PagePosition } from '../../../../application/models/pagination/page-position.model.js';
import type { InvitationView } from '../../../../application/projections/invitations/invitation-view.projection.js';
import type { InviteMembersOutput } from '../../../../application/use-cases/commands/invitations/invite-members/invite-members.output.js';
import { InviteMembers } from '../../../../application/use-cases/commands/invitations/invite-members/invite-members.use-case.js';
import { ResendInvitation } from '../../../../application/use-cases/commands/invitations/resend-invitation/resend-invitation.use-case.js';
import { RevokeInvitation } from '../../../../application/use-cases/commands/invitations/revoke-invitation/revoke-invitation.use-case.js';
import type { ListInvitationsOutput } from '../../../../application/use-cases/queries/invitations/list-invitations/list-invitations.output.js';
import { ListInvitations } from '../../../../application/use-cases/queries/invitations/list-invitations/list-invitations.use-case.js';
import { EmptyBody } from '../../dto/input/invitations/empty-body.dto.js';
import { InvitationPath } from '../../dto/input/invitations/invitation-path.dto.js';
import { InviteMembersBody } from '../../dto/input/invitations/invite-members-body.dto.js';
import { ListInvitationsQuery } from '../../dto/input/invitations/list-invitations-query.dto.js';
import { answerRefusals } from '../../errors/organizations/organization-refusal.problem.js';
import { toActorUserId, toOrganizationId } from '../../mappers/context/request-context.mapper.js';
import {
  toInvitationResponse,
  toInvitationResultResponse,
} from '../../mappers/invitations/invitation-response.mapper.js';
import { isInstant, toNextCursor, toPagePosition } from '../../mappers/pagination/cursor.mapper.js';

/**
 * Constant PENDING_LIST
 *
 * @description
 * What defines the pending list, for its cursors.
 *
 * @type {{ readonly list: string }}
 */
const PENDING_LIST: { readonly list: string } = { list: 'pending-invitations' };

/**
 * Class InvitationsController
 *
 * @description
 * The invitation routes of an organization in `openapi/internal/organization-service.yaml`, which
 * the gateway calls for `openapi/public/members.yaml`. Every route accepts the issuer
 * `api-gateway` and the actor `user` only, and acts on the organization of the token; only its
 * owner and its admins reach them.
 */
@Controller('internal/v1/invitations')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'] })
export class InvitationsController {
  // #region Properties
  /**
   * Property inviteMembers
   *
   * @description
   * Use case of the batch.
   *
   * @type {InviteMembers}
   * @readonly
   */
  private readonly inviteMembers: InviteMembers;

  /**
   * Property listInvitations
   *
   * @description
   * Use case of the pending list.
   *
   * @type {ListInvitations}
   * @readonly
   */
  private readonly listInvitations: ListInvitations;

  /**
   * Property resendInvitation
   *
   * @description
   * Use case of the resend.
   *
   * @type {ResendInvitation}
   * @readonly
   */
  private readonly resendInvitation: ResendInvitation;

  /**
   * Property revokeInvitation
   *
   * @description
   * Use case of the revocation.
   *
   * @type {RevokeInvitation}
   * @readonly
   */
  private readonly revokeInvitation: RevokeInvitation;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the use cases, provided by `OrganizationsModule`.
   *
   * @param {InviteMembers} inviteMembers - Use case of the batch.
   * @param {ListInvitations} listInvitations - Use case of the pending list.
   * @param {ResendInvitation} resendInvitation - Use case of the resend.
   * @param {RevokeInvitation} revokeInvitation - Use case of the revocation.
   * @constructor
   */
  public constructor(
    inviteMembers: InviteMembers,
    listInvitations: ListInvitations,
    resendInvitation: ResendInvitation,
    revokeInvitation: RevokeInvitation,
  ) {
    this.inviteMembers = inviteMembers;
    this.listInvitations = listInvitations;
    this.resendInvitation = resendInvitation;
    this.revokeInvitation = revokeInvitation;
  }
  // #endregion

  // #region Methods
  /**
   * Method invite
   *
   * @description
   * `POST /internal/v1/invitations`: `200` with the outcome of each distinct address; `400`,
   * `403 organization.role-forbidden`, `404 organization.not-found`,
   * `429 invitation.daily-limit-reached` with `Retry-After`.
   *
   * @param {InviteMembersBody} body - The addresses and the role.
   * @param {Response} response - The response, for `Retry-After`.
   * @returns {Promise<InvitationBatchResult>} The outcomes.
   */
  @Post()
  @HttpCode(200)
  public async invite(
    @Body() body: InviteMembersBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvitationBatchResult> {
    const output: InviteMembersOutput = await answerRefusals(
      () =>
        this.inviteMembers.execute({
          actorUserId: toActorUserId(),
          organizationId: toOrganizationId(),
          emails: body.emails,
          role: body.role,
        }),
      response,
    );
    return { invitations: output.invitations.map(toInvitationResultResponse) };
  }

  /**
   * Method list
   *
   * @description
   * `GET /internal/v1/invitations`: `200` with one page of pending invitations and `total`; `400`,
   * `403 organization.role-forbidden`, `404 organization.not-found`.
   *
   * @param {ListInvitationsQuery} query - The cursor and the page size.
   * @returns {Promise<InvitationPage>} The page.
   */
  @Get()
  public async list(@Query() query: ListInvitationsQuery): Promise<InvitationPage> {
    const after: PagePosition | null = toPagePosition(query.cursor, PENDING_LIST, isInstant);
    const output: ListInvitationsOutput = await answerRefusals(() =>
      this.listInvitations.execute({
        actorUserId: toActorUserId(),
        organizationId: toOrganizationId(),
        after,
        limit: query.limit,
      }),
    );
    return {
      items: output.page.items.map(toInvitationResponse),
      nextCursor: toNextCursor(output.page.next, PENDING_LIST),
      total: output.total,
    };
  }

  /**
   * Method revoke
   *
   * @description
   * `DELETE /internal/v1/invitations/{invitationId}`: `204`, again for a revoked one; `400`,
   * `403 organization.role-forbidden`, `404 invitation.not-found`, `409 invitation.answered`.
   *
   * @param {InvitationPath} path - The id of the invitation.
   * @returns {Promise<void>} Resolves once revoked.
   */
  @Delete(':invitationId')
  @HttpCode(204)
  public async revoke(@Param() path: InvitationPath): Promise<void> {
    await answerRefusals(() =>
      this.revokeInvitation.execute({
        actorUserId: toActorUserId(),
        organizationId: toOrganizationId(),
        invitationId: path.invitationId,
      }),
    );
  }

  /**
   * Method resend
   *
   * @description
   * `POST /internal/v1/invitations/{invitationId}/resend`: `200` with the invitation, its new
   * expiry and its `ETag`; `400`, `403 organization.role-forbidden`, `404 invitation.not-found`,
   * `409 invitation.revoked` or `invitation.answered`, `429 invitation.resend-throttled` or
   * `invitation.daily-limit-reached` with `Retry-After`.
   *
   * @param {EmptyBody} _body - The empty object of the contract, validated only.
   * @param {InvitationPath} path - The id of the invitation.
   * @param {Response} response - The response, for `Retry-After`.
   * @returns {Promise<Invitation>} The invitation.
   */
  @Post(':invitationId/resend')
  @HttpCode(200)
  public async resend(
    @Body() _body: EmptyBody,
    @Param() path: InvitationPath,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Invitation> {
    const view: InvitationView = await answerRefusals(
      () =>
        this.resendInvitation.execute({
          actorUserId: toActorUserId(),
          organizationId: toOrganizationId(),
          invitationId: path.invitationId,
        }),
      response,
    );
    return toInvitationResponse(view);
  }
  // #endregion
}
