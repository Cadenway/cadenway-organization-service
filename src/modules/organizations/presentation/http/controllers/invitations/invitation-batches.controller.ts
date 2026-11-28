import type { InvitationBatchResult } from '@cadenway/contracts/types/internal/organization-service';
import { InternalAccess } from '@cadenway/nest-common';
import { Body, Controller, Headers, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import type { InviteMembersOutput } from '../../../../application/use-cases/commands/invitations/invite-members/invite-members.output.js';
import { InviteMembers } from '../../../../application/use-cases/commands/invitations/invite-members/invite-members.use-case.js';
import { InviteMembersKeyedBody } from '../../dto/input/invitations/invite-members-keyed-body.dto.js';
import { answerRefusals } from '../../errors/organizations/organization-refusal.problem.js';
import { toActorUserId, toOrganizationId } from '../../mappers/context/request-context.mapper.js';
import { toInvitationResultResponse } from '../../mappers/invitations/invitation-response.mapper.js';
import { requiredInvitationBatchKey } from '../../validation/invitations/invitation.validation.js';

/**
 * Class InvitationBatchesController
 *
 * @description
 * `POST /internal/v1/invitation-batches` of `openapi/internal/organization-service.yaml`: the
 * keyed invitation batch, which only a release that replays keyed batches serves, so a previous
 * release answers it `404` and the gateway answers `503 upstream.unavailable` rather than running
 * a keyed retry afresh. It runs the same use case as `POST /internal/v1/invitations` with a key, in
 * the same key namespace: one replay record and one in-progress claim per organization, actor and
 * key, whichever route wrote or holds it. Issuer `api-gateway`, actor `user`, organization of the
 * token.
 */
@Controller('internal/v1/invitation-batches')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'] })
export class InvitationBatchesController {
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
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Takes the use case, provided by `OrganizationsModule`.
   *
   * @param {InviteMembers} inviteMembers - Use case of the batch.
   * @constructor
   */
  public constructor(inviteMembers: InviteMembers) {
    this.inviteMembers = inviteMembers;
  }
  // #endregion

  // #region Methods
  /**
   * Method invite
   *
   * @description
   * `200` with the outcome of each distinct address, replayed for an equivalent batch under the
   * same `Idempotency-Key`; `400` (a missing key included), `403 organization.role-forbidden`,
   * `404 organization.not-found`, `409 idempotency.request-in-progress`,
   * `422 idempotency.key-reused`, `429 invitation.keyed-batch-limit-reached` or
   * `invitation.daily-limit-reached` with `Retry-After`.
   *
   * @param {InviteMembersKeyedBody} body - The addresses and the role.
   * @param {string | undefined} requestKey - The `Idempotency-Key` header.
   * @param {Response} response - The response, for `Retry-After`.
   * @returns {Promise<InvitationBatchResult>} The outcomes.
   */
  @Post()
  @HttpCode(200)
  public async invite(
    @Body() body: InviteMembersKeyedBody,
    @Headers('idempotency-key') requestKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<InvitationBatchResult> {
    const idempotencyKey: string = requiredInvitationBatchKey(requestKey);
    const output: InviteMembersOutput = await answerRefusals(
      () =>
        this.inviteMembers.execute({
          actorUserId: toActorUserId(),
          organizationId: toOrganizationId(),
          emails: body.emails,
          role: body.role,
          idempotencyKey,
        }),
      response,
    );
    return { invitations: output.invitations.map(toInvitationResultResponse) };
  }
  // #endregion
}
