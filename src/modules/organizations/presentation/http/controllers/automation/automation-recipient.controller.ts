import type { AutomationRecipientDecision } from '@cadenway/contracts/types/internal/organization-service';
import { InternalAccess, ProblemException } from '@cadenway/nest-common';
import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';

import { CheckAutomationRecipient } from '../../../../application/use-cases/queries/automation/check-automation-recipient/check-automation-recipient.use-case.js';
import { AutomationRecipientCheckBody } from '../../dto/input/automation/automation-recipient-check-body.dto.js';
import { answerRefusals } from '../../errors/organizations/organization-refusal.problem.js';
import { toActorUserId, toOrganizationId } from '../../mappers/context/request-context.mapper.js';

/** Checks recipient membership for a signed gateway user in the selected organization. */
@Controller('internal/v1/automation-recipients')
@InternalAccess({ issuers: ['api-gateway'], actors: ['user'], organization: 'required' })
export class AutomationRecipientController {
  // #region Constructor
  /** Binds the current tenant membership decision. */
  public constructor(private readonly checkRecipient: CheckAutomationRecipient) {}
  // #endregion

  // #region Methods
  /** Returns only the eligibility decision from the current membership snapshot. */
  @Post('check')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async check(
    @Body() body: AutomationRecipientCheckBody,
  ): Promise<AutomationRecipientDecision> {
    try {
      const decision = await answerRefusals(() =>
        this.checkRecipient.execute({
          actorUserId: toActorUserId(),
          organizationId: toOrganizationId(),
          userId: body.userId,
        }),
      );
      return { eligible: decision.eligible };
    } catch (error) {
      if (error instanceof ProblemException) throw error;
      throw new ProblemException({ status: 503, code: 'organization.unavailable' });
    }
  }
  // #endregion
}
