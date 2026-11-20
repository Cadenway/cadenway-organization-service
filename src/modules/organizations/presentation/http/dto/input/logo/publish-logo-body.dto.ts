import { SetOrganizationLogoInternalBody } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/** The exact prepared reservation supplied by the gateway. */
export class PublishLogoBody extends zodDto(SetOrganizationLogoInternalBody) {}
