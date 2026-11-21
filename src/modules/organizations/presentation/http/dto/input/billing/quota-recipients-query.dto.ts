import { ListQuotaNotificationRecipientsInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/** Published query for quota notification recipient pagination. */
export class QuotaRecipientsQuery extends zodDto(
  ListQuotaNotificationRecipientsInternalQueryParams.strict(),
) {}
