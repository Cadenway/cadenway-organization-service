import type { Role } from '../../../../../domain/value-objects/members/role.value-object.js';
import type { PagePosition } from '../../../../models/pagination/page-position.model.js';

/**
 * Interface ListMembersInput
 *
 * @description
 * One page of the member list of the organization of the request ("Membres").
 */
export interface ListMembersInput {
  // #region Properties
  /**
   * Property actorUserId
   *
   * @description
   * The user of the verified internal token.
   *
   * @type {string}
   * @readonly
   */
  readonly actorUserId: string;

  /**
   * Property organizationId
   *
   * @description
   * The organization of the verified internal token.
   *
   * @type {string}
   * @readonly
   */
  readonly organizationId: string;

  /**
   * Property search
   *
   * @description
   * Text to find in the name or the address ("Rechercher un membre"), or `null`.
   *
   * @type {string | null}
   * @readonly
   */
  readonly search: string | null;

  /**
   * Property roles
   *
   * @description
   * Roles to keep (the tab "Administrateurs" is `owner` and `admin`), or `null` for every role.
   *
   * @type {readonly Role[] | null}
   * @readonly
   */
  readonly roles: readonly Role[] | null;

  /**
   * Property after
   *
   * @description
   * Where the previous page ended, or `null` for the first page.
   *
   * @type {PagePosition | null}
   * @readonly
   */
  readonly after: PagePosition | null;

  /**
   * Property limit
   *
   * @description
   * Page size, 1 to 100.
   *
   * @type {number}
   * @readonly
   */
  readonly limit: number;
  // #endregion
}
