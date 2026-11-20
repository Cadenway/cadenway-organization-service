import type {
  ProfileMediaReservation,
  ProfileMediaReservationState,
} from '@cadenway/contracts/types/internal/organization-service';
import { formatEtag, InternalAccess } from '@cadenway/nest-common';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { PublishOrganizationLogo } from '../../../../application/use-cases/commands/logo/publish-organization-logo/publish-organization-logo.use-case.js';
import { RemoveOrganizationLogo } from '../../../../application/use-cases/commands/logo/remove-organization-logo/remove-organization-logo.use-case.js';
import { ReserveOrganizationLogoUpload } from '../../../../application/use-cases/commands/logo/reserve-organization-logo-upload/reserve-organization-logo-upload.use-case.js';
import { GetOrganizationLogoUpload } from '../../../../application/use-cases/queries/logo/get-organization-logo-upload/get-organization-logo-upload.use-case.js';
import { LogoUploadPath } from '../../dto/input/logo/logo-upload-path.dto.js';
import { PublishLogoBody } from '../../dto/input/logo/publish-logo-body.dto.js';
import { answerLogoRefusals } from '../../errors/logo/logo-refusal.problem.js';
import { toActorUserId, toOrganizationId } from '../../mappers/context/request-context.mapper.js';
import {
  LogoDeclarationPipe,
  logoExpectedVersion,
  logoRequestKey,
} from '../../validation/logo/logo.validation.js';

/** Internal logo owner operations called only by the authenticated API gateway. */
@Controller('internal/v1/organization/logo')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'] })
export class OrganizationLogoController {
  // #region Constructor
  /** Binds each published operation to its tenant-scoped use case. */
  public constructor(
    private readonly reserve: ReserveOrganizationLogoUpload,
    private readonly lookup: GetOrganizationLogoUpload,
    private readonly publish: PublishOrganizationLogo,
    private readonly remove: RemoveOrganizationLogo,
  ) {}
  // #endregion

  // #region Methods
  /** Reserves a logo declaration and returns its original deadline on replay. */
  @Post('uploads')
  public async start(
    @Body(new LogoDeclarationPipe())
    body: { readonly contentType: string; readonly sizeBytes: number },
    @Headers('idempotency-key') requestKey: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProfileMediaReservation> {
    response.setHeader('Cache-Control', 'no-store');
    const idempotencyKey = logoRequestKey(requestKey);
    const result = await answerLogoRefusals(() =>
      this.reserve.execute({
        organizationId: toOrganizationId(),
        actorUserId: toActorUserId(),
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      }),
    );
    response.setHeader('Location', `/internal/v1/organization/logo/uploads/${result.uploadId}`);
    return { uploadId: result.uploadId, expiresAt: result.expiresAt.toISOString() };
  }

  /** Returns the authenticated uploader's current reservation state. */
  @Get('uploads/:uploadId')
  public async read(
    @Param() path: LogoUploadPath,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ProfileMediaReservationState> {
    // Express freshness checks would replace the current state with a 304.
    delete request.headers['if-none-match'];
    delete request.headers['if-modified-since'];
    response.setHeader('Cache-Control', 'no-store');
    const result = await answerLogoRefusals(() =>
      this.lookup.execute({
        organizationId: toOrganizationId(),
        actorUserId: toActorUserId(),
        uploadId: path.uploadId,
      }),
    );
    return {
      uploadId: result.uploadId,
      state: result.state,
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  /** Publishes a prepared asset and returns the current organization ETag. */
  @Put()
  @HttpCode(204)
  public async set(
    @Body() body: PublishLogoBody,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    const expectedVersion = logoExpectedVersion(ifMatch);
    const result = await answerLogoRefusals(() =>
      this.publish.execute({
        organizationId: toOrganizationId(),
        actorUserId: toActorUserId(),
        uploadId: body.uploadId,
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      }),
    );
    response.setHeader('ETag', formatEtag(result.version));
  }

  /** Clears the owner reference and returns the resulting organization ETag. */
  @Delete()
  @HttpCode(204)
  public async clear(
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    const expectedVersion = logoExpectedVersion(ifMatch);
    const result = await answerLogoRefusals(() =>
      this.remove.execute({
        organizationId: toOrganizationId(),
        actorUserId: toActorUserId(),
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      }),
    );
    response.setHeader('ETag', formatEtag(result.version));
  }
  // #endregion
}
