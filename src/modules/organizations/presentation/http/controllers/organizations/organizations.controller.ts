import type {
  MyOrganizationPage,
  Organization,
  OrganizationCreated,
} from '@cadenway/contracts/types/internal/organization-service';
import { formatEtag, InternalAccess } from '@cadenway/nest-common';
import { Body, Controller, Get, Headers, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

import type { Page } from '../../../../application/models/pagination/page.model.js';
import type { PagePosition } from '../../../../application/models/pagination/page-position.model.js';
import type { MyOrganizationView } from '../../../../application/projections/organizations/my-organization-view.projection.js';
import type { OrganizationView } from '../../../../application/projections/organizations/organization-view.projection.js';
import type { CreateOrganizationOutput } from '../../../../application/use-cases/commands/organizations/create-organization/create-organization.output.js';
import { CreateOrganization } from '../../../../application/use-cases/commands/organizations/create-organization/create-organization.use-case.js';
import { UpdateOrganization } from '../../../../application/use-cases/commands/organizations/update-organization/update-organization.use-case.js';
import { GetCurrentOrganization } from '../../../../application/use-cases/queries/organizations/get-current-organization/get-current-organization.use-case.js';
import { ListMyOrganizations } from '../../../../application/use-cases/queries/organizations/list-my-organizations/list-my-organizations.use-case.js';
import { CreateOrganizationBody } from '../../dto/input/organizations/create-organization-body.dto.js';
import { ListMyOrganizationsQuery } from '../../dto/input/organizations/list-my-organizations-query.dto.js';
import { UpdateOrganizationBody } from '../../dto/input/organizations/update-organization-body.dto.js';
import { answerRefusals } from '../../errors/organizations/organization-refusal.problem.js';
import { toActorUserId, toOrganizationId } from '../../mappers/context/request-context.mapper.js';
import { toInvitationResultResponse } from '../../mappers/invitations/invitation-response.mapper.js';
import {
  toMyOrganizationResponse,
  toOrganizationResponse,
} from '../../mappers/organizations/organization-response.mapper.js';
import { toNextCursor, toPagePosition } from '../../mappers/pagination/cursor.mapper.js';
import { toVersionCondition } from '../../validation/versions/if-match.validation.js';

/**
 * Constant MY_ORGANIZATIONS_LIST
 *
 * @description
 * What defines the list of the organizations of the actor, for its cursors.
 *
 * @type {{ readonly list: string }}
 */
const MY_ORGANIZATIONS_LIST: { readonly list: string } = { list: 'my-organizations' };

/**
 * Class OrganizationsController
 *
 * @description
 * The organization routes of `openapi/internal/organization-service.yaml`, which the gateway calls
 * for `openapi/public/organizations.yaml`. Every route accepts the issuer `api-gateway` and the
 * actor `user` only. The creation and the list of the organizations of the actor require no
 * organization and ignore the one the token may carry; the reading and the change of the
 * organization act on the organization of the token, never one named by the request.
 */
@Controller('internal/v1')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'] })
export class OrganizationsController {
  // #region Properties
  /**
   * Property createOrganization
   *
   * @description
   * Use case of the creation.
   *
   * @type {CreateOrganization}
   * @readonly
   */
  private readonly createOrganization: CreateOrganization;

  /**
   * Property listMyOrganizations
   *
   * @description
   * Use case of the list of the organizations of the actor.
   *
   * @type {ListMyOrganizations}
   * @readonly
   */
  private readonly listMyOrganizations: ListMyOrganizations;

  /**
   * Property getCurrentOrganization
   *
   * @description
   * Use case of the reading.
   *
   * @type {GetCurrentOrganization}
   * @readonly
   */
  private readonly getCurrentOrganization: GetCurrentOrganization;

  /**
   * Property updateOrganization
   *
   * @description
   * Use case of the change.
   *
   * @type {UpdateOrganization}
   * @readonly
   */
  private readonly updateOrganization: UpdateOrganization;
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the use cases, provided by `OrganizationsModule`.
   *
   * @param {CreateOrganization} createOrganization - Use case of the creation.
   * @param {ListMyOrganizations} listMyOrganizations - Use case of the list of the actor.
   * @param {GetCurrentOrganization} getCurrentOrganization - Use case of the reading.
   * @param {UpdateOrganization} updateOrganization - Use case of the change.
   * @constructor
   */
  public constructor(
    createOrganization: CreateOrganization,
    listMyOrganizations: ListMyOrganizations,
    getCurrentOrganization: GetCurrentOrganization,
    updateOrganization: UpdateOrganization,
  ) {
    this.createOrganization = createOrganization;
    this.listMyOrganizations = listMyOrganizations;
    this.getCurrentOrganization = getCurrentOrganization;
    this.updateOrganization = updateOrganization;
  }
  // #endregion

  // #region Methods
  /**
   * Method create
   *
   * @description
   * `POST /internal/v1/organizations`: `201` with the organization and the invitation outcomes,
   * `Location` and `ETag`; `400`, `404 user.not-synchronized`, `409 organization.slug-taken`,
   * `422 organization.slug-invalid`.
   *
   * @param {CreateOrganizationBody} body - The creation form.
   * @param {Response} response - The response, for its headers.
   * @returns {Promise<OrganizationCreated>} The body.
   */
  @Post('organizations')
  @InternalAccess({ organization: 'optional' })
  public async create(
    @Body() body: CreateOrganizationBody,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OrganizationCreated> {
    const actorUserId: string = toActorUserId();
    const created: CreateOrganizationOutput = await answerRefusals(() =>
      this.createOrganization.execute({
        actorUserId,
        name: body.name,
        slug: body.slug ?? null,
        teamSize: body.teamSize,
        primaryUse: body.primaryUse,
        inviteEmails: body.inviteEmails,
      }),
    );
    response.setHeader('Location', '/internal/v1/organization');
    response.setHeader('ETag', formatEtag(created.organization.version));
    return {
      organization: toOrganizationResponse(created.organization),
      invitations: created.invitations.map(toInvitationResultResponse),
    };
  }

  /**
   * Method listMine
   *
   * @description
   * `GET /internal/v1/organizations`: `200` with one page of the organizations of the actor.
   *
   * @param {ListMyOrganizationsQuery} query - The cursor and the page size.
   * @returns {Promise<MyOrganizationPage>} The page.
   */
  @Get('organizations')
  @InternalAccess({ organization: 'optional' })
  public async listMine(@Query() query: ListMyOrganizationsQuery): Promise<MyOrganizationPage> {
    const after: PagePosition | null = toPagePosition(query.cursor, MY_ORGANIZATIONS_LIST);
    const page: Page<MyOrganizationView> = await this.listMyOrganizations.execute({
      actorUserId: toActorUserId(),
      after,
      limit: query.limit,
    });
    return {
      items: page.items.map(toMyOrganizationResponse),
      nextCursor: toNextCursor(page.next, MY_ORGANIZATIONS_LIST),
    };
  }

  /**
   * Method read
   *
   * @description
   * `GET /internal/v1/organization`: `200` with the organization of the token and its `ETag`;
   * `404 organization.not-found` when the actor does not belong to it.
   *
   * @returns {Promise<Organization>} The organization.
   */
  @Get('organization')
  public async read(): Promise<Organization> {
    const view: OrganizationView = await answerRefusals(() =>
      this.getCurrentOrganization.execute({
        actorUserId: toActorUserId(),
        organizationId: toOrganizationId(),
      }),
    );
    return toOrganizationResponse(view);
  }

  /**
   * Method update
   *
   * @description
   * `PATCH /internal/v1/organization`: `200` with the organization after the change and its `ETag`;
   * `400`, `403 organization.role-forbidden`, `404 organization.not-found`,
   * `409 organization.slug-taken`, `412 request.version-mismatch`.
   *
   * @param {UpdateOrganizationBody} body - The JSON Merge Patch.
   * @param {string | undefined} ifMatch - The `If-Match` header.
   * @returns {Promise<Organization>} The organization.
   */
  @Patch('organization')
  public async update(
    @Body() body: UpdateOrganizationBody,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<Organization> {
    const view: OrganizationView = await answerRefusals(() =>
      this.updateOrganization.execute({
        actorUserId: toActorUserId(),
        organizationId: toOrganizationId(),
        change: {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.slug === undefined ? {} : { slug: body.slug }),
          ...(body.description === undefined ? {} : { description: body.description }),
          ...(body.website === undefined ? {} : { website: body.website }),
          ...(body.defaultLanguage === undefined ? {} : { defaultLanguage: body.defaultLanguage }),
        },
        expectedVersion: toVersionCondition(ifMatch),
      }),
    );
    return toOrganizationResponse(view);
  }
  // #endregion
}
