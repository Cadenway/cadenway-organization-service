import { GetOrganizationLogoUploadStateInternalParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/** The contract's UUIDv7 owner upload path. */
export class LogoUploadPath extends zodDto(GetOrganizationLogoUploadStateInternalParams) {}
