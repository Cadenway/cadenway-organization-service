import { ReserveAccountDeletionInternalParams } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/** Validates the account and the stable UUIDv7 reserved by Identity. */
export class ReserveAccountDeletionPath extends zodDto(ReserveAccountDeletionInternalParams) {}
