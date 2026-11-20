import { LookupMemberNamesInternalBody } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/** Validates the account IDs requested by the gateway against the published lookup contract. */
export class MemberNameLookupBody extends zodDto(LookupMemberNamesInternalBody.strict()) {}
