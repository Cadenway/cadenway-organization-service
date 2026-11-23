import { InternalAccess, principalOf, ProblemException } from '@cadenway/nest-common';
import { Controller, Header, Param, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';

import { ReserveAccountDeletion } from '../../../../application/use-cases/commands/members/reserve-account-deletion/reserve-account-deletion.use-case.js';
import { ReserveAccountDeletionPath } from '../../dto/input/members/reserve-account-deletion-path.dto.js';
import { answerSearchAuthority } from '../../errors/search/search-authority.problem.js';

/** Reserves account deletion for the verified, unscoped Identity system actor. */
@Controller('internal/v1/users/:userId/account-deletion-reservations')
@InternalAccess({ issuers: ['identity-service'], actors: ['system'], organization: 'optional' })
export class AccountDeletionReservationsController {
  // #region Constructor
  /** Binds Organization's transactional ownership check. */
  public constructor(private readonly reserve: ReserveAccountDeletion) {}
  // #endregion

  // #region Methods
  /** Creates the exact attempt or confirms a replay without a response body. */
  @Put(':attemptId')
  @Header('Cache-Control', 'private, no-store')
  public async create(
    @Param() path: ReserveAccountDeletionPath,
    @Req() request: object,
    @Res() response: Response,
  ): Promise<void> {
    const principal = principalOf(request);
    if (
      principal?.actor.type !== 'system' ||
      principal.actor.id !== 'identity-service' ||
      principal.role !== null ||
      principal.scopes.length !== 0
    ) {
      throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
    }
    if (principal.organizationId !== null) {
      throw new ProblemException({ status: 403, code: 'auth.organization-not-allowed' });
    }

    const result = await answerSearchAuthority(() =>
      this.reserve.execute(path.userId, path.attemptId),
    );
    switch (result.status) {
      case 'created':
        response.status(201).end();
        return;
      case 'reused':
        response.status(204).end();
        return;
      case 'not-found':
        throw new ProblemException({ status: 404, code: 'user.not-found' });
      case 'owner':
        throw new ProblemException({
          status: 409,
          code: 'account.organization-owner',
          details: { organizationIds: result.organizationIds },
        });
      case 'conflict':
        throw new ProblemException({ status: 409, code: 'account.deletion-reservation-conflict' });
    }
  }
  // #endregion
}
