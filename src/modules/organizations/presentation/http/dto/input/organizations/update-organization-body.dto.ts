import { UpdateOrganizationInternalBody } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/**
 * Class UpdateOrganizationBody
 *
 * @description
 * Body of `PATCH /internal/v1/organization` (`OrganizationPatch`), a JSON Merge Patch validated with
 * the schema of the contract: a member left out stays absent, `null` clears the description or the
 * website, an empty object changes nothing.
 */
export class UpdateOrganizationBody extends zodDto(UpdateOrganizationInternalBody) {}
