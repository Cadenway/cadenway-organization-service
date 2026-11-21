import type {
  QuotaNotificationRecipientLookupResult,
  QuotaNotificationRecipientPage,
} from '@cadenway/contracts/types/internal/organization-service';
import { getOrganizationContext, InternalAccess, ProblemException } from '@cadenway/nest-common';
import { Body, Controller, Get, Header, HttpCode, Post, Query } from '@nestjs/common';

import { ListQuotaNotificationRecipients } from '../../../../application/use-cases/queries/quota-notifications/list-quota-notification-recipients/list-quota-notification-recipients.use-case.js';
import { LookupQuotaNotificationRecipients } from '../../../../application/use-cases/queries/quota-notifications/lookup-quota-notification-recipients/lookup-quota-notification-recipients.use-case.js';
import { QuotaRecipientsBody } from '../../dto/input/billing/quota-recipients-body.dto.js';
import { QuotaRecipientsQuery } from '../../dto/input/billing/quota-recipients-query.dto.js';
import { answerSearchAuthority } from '../../errors/search/search-authority.problem.js';
import { BillingAuthorityCursor } from '../../mappers/billing/billing-authority-cursor.mapper.js';
import { toOrganizationId } from '../../mappers/context/request-context.mapper.js';

/** Resolves the current users eligible to receive a quota notification. */
@Controller('internal/v1/quota-notification-recipients')
@InternalAccess({ issuers: ['notification-service'], actors: ['system'], organization: 'required' })
export class QuotaNotificationRecipientsController {
  // #region Constructor
  /** Binds the current-recipient queries and their cursor signer. */
  public constructor(
    private readonly recipients: ListQuotaNotificationRecipients,
    private readonly lookupRecipients: LookupQuotaNotificationRecipients,
    private readonly cursor: BillingAuthorityCursor,
  ) {}
  // #endregion

  // #region Methods
  /** Lists the current eligible user IDs in ascending order. */
  @Get()
  @Header('Cache-Control', 'private, no-store')
  public async list(@Query() query: QuotaRecipientsQuery): Promise<QuotaNotificationRecipientPage> {
    const organizationId = this.tenant();
    return answerSearchAuthority(async () => {
      const position = this.cursor.read(query.cursor, 'recipients', organizationId);
      const page = await this.recipients.execute({
        organizationId,
        afterUserId: position?.afterId ?? null,
        limit: query.limit,
      });
      if (page === null)
        throw new ProblemException({ status: 404, code: 'organization.not-found' });
      return {
        items: [...page.items],
        nextCursor: this.cursor.write(
          page.nextUserId === null ? null : { afterId: page.nextUserId, upperId: null },
          'recipients',
          organizationId,
        ),
      };
    });
  }

  /** Rechecks roles immediately before each notification delivery attempt. */
  @Post('lookup')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  public async lookup(
    @Body() body: QuotaRecipientsBody,
  ): Promise<QuotaNotificationRecipientLookupResult> {
    const organizationId = this.tenant();
    return answerSearchAuthority(async () => {
      const result = await this.lookupRecipients.execute({ organizationId, userIds: body.userIds });
      if (result === null)
        throw new ProblemException({ status: 404, code: 'organization.not-found' });
      return { items: [...result.items] };
    });
  }

  private tenant(): string {
    const context = getOrganizationContext();
    if (context?.actor.type !== 'system' || context.actor.id !== 'notification-service') {
      throw new ProblemException({ status: 403, code: 'auth.actor-not-allowed' });
    }
    return toOrganizationId();
  }
  // #endregion
}
