import type {
  MyOrganization,
  ReceivedInvitationPage,
} from '@cadenway/contracts/types/internal/organization-service';
import { InternalAccess } from '@cadenway/nest-common';
import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';

import type { Page } from '../../../../application/models/pagination/page.model.js';
import type { PagePosition } from '../../../../application/models/pagination/page-position.model.js';
import type { ReceivedInvitationView } from '../../../../application/projections/invitations/received-invitation-view.projection.js';
import type { MyOrganizationView } from '../../../../application/projections/organizations/my-organization-view.projection.js';
import { AcceptInvitation } from '../../../../application/use-cases/commands/invitations/accept-invitation/accept-invitation.use-case.js';
import { RefuseInvitation } from '../../../../application/use-cases/commands/invitations/refuse-invitation/refuse-invitation.use-case.js';
import { ListReceivedInvitations } from '../../../../application/use-cases/queries/invitations/list-received-invitations/list-received-invitations.use-case.js';
import { EmptyBody } from '../../dto/input/invitations/empty-body.dto.js';
import { ListReceivedInvitationsQuery } from '../../dto/input/invitations/list-received-invitations-query.dto.js';
import { ReceivedInvitationPath } from '../../dto/input/invitations/received-invitation-path.dto.js';
import { ReceivedInvitationsPath } from '../../dto/input/invitations/received-invitations-path.dto.js';
import { answerRefusals } from '../../errors/organizations/organization-refusal.problem.js';
import { toActorUserId } from '../../mappers/context/request-context.mapper.js';
import { toReceivedInvitationResponse } from '../../mappers/invitations/invitation-response.mapper.js';
import { toMyOrganizationResponse } from '../../mappers/organizations/organization-response.mapper.js';
import { isInstant, toNextCursor, toPagePosition } from '../../mappers/pagination/cursor.mapper.js';

/**
 * Constant RECEIVED_LIST
 *
 * @description
 * What defines the list of the invitations addressed to the actor, for its cursors.
 *
 * @type {{ readonly list: string }}
 */
const RECEIVED_LIST: { readonly list: string } = { list: 'received-invitations' };

/**
 * Class ReceivedInvitationsController
 *
 * @description
 * The routes of the invitee in `openapi/internal/organization-service.yaml`, which the gateway calls
 * for `/v1/me/invitations` with the user the introspection returned. They accept the issuer
 * `api-gateway` and the actor `user` only, require no organization and ignore the one the token
 * may carry: the invitations addressed to the actor come from every organization. A `userId`
 * other than the actor answers `404 user.not-found`.
 */
@Controller('internal/v1/users/:userId/invitations')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'], organization: 'optional' })
export class ReceivedInvitationsController {
  // #region Properties
  /**
   * Property listReceivedInvitations
   *
   * @description
   * Use case of the list.
   *
   * @type {ListReceivedInvitations}
   * @readonly
   */
  private readonly listReceivedInvitations: ListReceivedInvitations;

  /**
   * Property acceptInvitation
   *
   * @description
   * Use case of the acceptance.
   *
   * @type {AcceptInvitation}
   * @readonly
   */
  private readonly acceptInvitation: AcceptInvitation;

  /**
   * Property refuseInvitation
   *
   * @description
   * Use case of the refusal.
   *
   * @type {RefuseInvitation}
   * @readonly
   */
  private readonly refuseInvitation: RefuseInvitation;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the use cases, provided by `OrganizationsModule`.
   *
   * @param {ListReceivedInvitations} listReceivedInvitations - Use case of the list.
   * @param {AcceptInvitation} acceptInvitation - Use case of the acceptance.
   * @param {RefuseInvitation} refuseInvitation - Use case of the refusal.
   * @constructor
   */
  public constructor(
    listReceivedInvitations: ListReceivedInvitations,
    acceptInvitation: AcceptInvitation,
    refuseInvitation: RefuseInvitation,
  ) {
    this.listReceivedInvitations = listReceivedInvitations;
    this.acceptInvitation = acceptInvitation;
    this.refuseInvitation = refuseInvitation;
  }
  // #endregion

  // #region Methods
  /**
   * Method list
   *
   * @description
   * `GET /internal/v1/users/{userId}/invitations`: `200` with one page of the pending invitations,
   * not expired, addressed to the verified address of the actor; `400`, `404 user.not-found`.
   *
   * @param {ReceivedInvitationsPath} path - The account of the actor.
   * @param {ListReceivedInvitationsQuery} query - The cursor and the page size.
   * @returns {Promise<ReceivedInvitationPage>} The page.
   */
  @Get()
  public async list(
    @Param() path: ReceivedInvitationsPath,
    @Query() query: ListReceivedInvitationsQuery,
  ): Promise<ReceivedInvitationPage> {
    const after: PagePosition | null = toPagePosition(query.cursor, RECEIVED_LIST, isInstant);
    const page: Page<ReceivedInvitationView> = await answerRefusals(() =>
      this.listReceivedInvitations.execute({
        actorUserId: toActorUserId(),
        userId: path.userId,
        after,
        limit: query.limit,
      }),
    );
    return {
      items: page.items.map(toReceivedInvitationResponse),
      nextCursor: toNextCursor(page.next, RECEIVED_LIST),
    };
  }

  /**
   * Method accept
   *
   * @description
   * `POST /internal/v1/users/{userId}/invitations/{invitationId}/accept`: `200` with the
   * organization joined; `400`, `403 invitation.email-mismatch`, `404 invitation.not-found` or
   * `user.not-found`, `409 invitation.revoked`, `invitation.answered` or `invitation.expired`.
   *
   * @param {EmptyBody} _body - The empty object of the contract, validated only.
   * @param {ReceivedInvitationPath} path - The account of the actor and the invitation.
   * @returns {Promise<MyOrganization>} The organization joined.
   */
  @Post(':invitationId/accept')
  @HttpCode(200)
  public async accept(
    @Body() _body: EmptyBody,
    @Param() path: ReceivedInvitationPath,
  ): Promise<MyOrganization> {
    const view: MyOrganizationView = await answerRefusals(() =>
      this.acceptInvitation.execute({
        actorUserId: toActorUserId(),
        userId: path.userId,
        invitationId: path.invitationId,
      }),
    );
    return toMyOrganizationResponse(view);
  }

  /**
   * Method refuse
   *
   * @description
   * `POST /internal/v1/users/{userId}/invitations/{invitationId}/refuse`: `204`; the refusals of
   * the acceptance.
   *
   * @param {EmptyBody} _body - The empty object of the contract, validated only.
   * @param {ReceivedInvitationPath} path - The account of the actor and the invitation.
   * @returns {Promise<void>} Resolves once refused.
   */
  @Post(':invitationId/refuse')
  @HttpCode(204)
  public async refuse(
    @Body() _body: EmptyBody,
    @Param() path: ReceivedInvitationPath,
  ): Promise<void> {
    await answerRefusals(() =>
      this.refuseInvitation.execute({
        actorUserId: toActorUserId(),
        userId: path.userId,
        invitationId: path.invitationId,
      }),
    );
  }
  // #endregion
}
