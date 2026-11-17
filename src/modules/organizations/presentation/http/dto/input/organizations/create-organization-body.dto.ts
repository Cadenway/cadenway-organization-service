import { CreateOrganizationInternalBody } from '@cadenway/contracts/validators/internal/organization-service';
import { zodDto } from '@cadenway/nest-common';

/**
 * Class CreateOrganizationBody
 *
 * @description
 * Body of `POST /internal/v1/organizations` (`OrganizationCreation`), validated with the schema of
 * the contract, its defaults included (`6-20`, `product-engineering`, no address to invite).
 */
export class CreateOrganizationBody extends zodDto(CreateOrganizationInternalBody) {}
