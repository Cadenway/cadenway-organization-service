import { LookupQuotaNotificationRecipientsInternalBody } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/** Published bounded recipient lookup body. */
export class QuotaRecipientsBody extends zodDto(
  LookupQuotaNotificationRecipientsInternalBody.strict(),
) {}
