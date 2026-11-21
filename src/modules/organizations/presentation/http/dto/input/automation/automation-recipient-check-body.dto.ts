import { CheckAutomationRecipientInternalBody } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/** Validates the recipient account against the published UUIDv7 request contract. */
export class AutomationRecipientCheckBody extends zodDto(CheckAutomationRecipientInternalBody) {}
