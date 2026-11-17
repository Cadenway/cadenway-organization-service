import { InvalidDescriptionError } from '../../errors/organizations/invalid-description.error.js';
import { InvalidOrganizationNameError } from '../../errors/organizations/invalid-organization-name.error.js';
import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import { Slug } from '../../value-objects/slug/slug.value-object.js';
import { Website } from '../../value-objects/website/website.value-object.js';
import { INITIAL_DEFAULT_LANGUAGE } from '../../value-objects/organizations/default-language.value-object.js';
import type { OrganizationChange } from '../../value-objects/organizations/organization-change.value-object.js';
import type { OrganizationDraft } from '../../value-objects/organizations/organization-draft.value-object.js';
import type { OrganizationField } from '../../value-objects/organizations/organization-field.value-object.js';
import type { OrganizationFounding } from '../../value-objects/organizations/organization-founding.value-object.js';
import type { OrganizationState } from '../../value-objects/organizations/organization-state.value-object.js';
import type { OrganizationUpdate } from '../../value-objects/organizations/organization-update.value-object.js';
import { INITIAL_PLAN } from '../../value-objects/organizations/plan.value-object.js';

/**
 * Class Organization
 *
 * @description
 * An organization and its profile. Rules, from the creation form and the settings "Général" of the
 * mockup (`Organisations.dc.html`, `Organisation.dc.html`), `openapi/public/organizations.yaml` and
 * the decisions of P2b:
 *
 * - the name is trimmed; a name made only of spaces is refused; 120 characters at most;
 * - the address is derived from the name at creation unless given (decision 10), 2 to 63
 *   lowercase letters, digits and single dashes, and stays editable;
 * - the description has 280 characters at most and the website is an absolute http or https URL;
 *   `null` clears either;
 * - a new organization has the plan `free` (billing is P5), the default language `fr` and its
 *   creator as owner;
 * - a change that moves nothing keeps the version; any other adds one.
 */
export class Organization {
  // #region Properties
  /**
   * Property NAME_MAX_LENGTH
   *
   * @description
   * Longest name, in characters.
   *
   * @type {number}
   * @readonly
   */
  public static readonly NAME_MAX_LENGTH: number = 120;

  /**
   * Property DESCRIPTION_MAX_LENGTH
   *
   * @description
   * Longest description, in characters ("280 caractères").
   *
   * @type {number}
   * @readonly
   */
  public static readonly DESCRIPTION_MAX_LENGTH: number = 280;

  /**
   * Property state
   *
   * @description
   * The state of the organization; a change returns a new `Organization`.
   *
   * @type {OrganizationState}
   * @readonly
   */
  private readonly state: OrganizationState;

  /**
   * Property id
   *
   * @description
   * Id of the organization.
   *
   * @type {string}
   * @readonly
   */
  public get id(): string {
    return this.state.id;
  }

  /**
   * Property snapshot
   *
   * @description
   * The state to store.
   *
   * @type {OrganizationState}
   * @readonly
   */
  public get snapshot(): OrganizationState {
    return this.state;
  }
  // #endregion

  // #region Constructor
  /**
   * Constructor
   *
   * @description
   * Keeps a state checked by `restore`.
   *
   * @param {OrganizationState} state - The checked state.
   * @constructor
   */
  private constructor(state: OrganizationState) {
    this.state = state;
  }
  // #endregion

  // #region Methods
  /**
   * Method found
   *
   * @description
   * The organization the creation form creates at `now`, at version 1.
   *
   * @param {OrganizationFounding} founding - What the form gives.
   * @param {Date} now - When it is created.
   * @returns {OrganizationDraft} The organization to store.
   * @throws {InvalidOrganizationNameError} When the name is blank or too long.
   * @throws {SlugInvalidError} When the given or derived address is not valid.
   */
  public static found(founding: OrganizationFounding, now: Date): OrganizationDraft {
    const name: string = Organization.checkedName(founding.name);
    const slug: Slug = founding.slug === null ? Slug.derive(name) : Slug.parse(founding.slug);
    return {
      name,
      slug: slug.value,
      description: null,
      website: null,
      defaultLanguage: INITIAL_DEFAULT_LANGUAGE,
      plan: INITIAL_PLAN,
      teamSize: founding.teamSize,
      primaryUse: founding.primaryUse,
      ownerUserId: founding.ownerUserId,
      createdAt: now,
      version: 1,
    };
  }

  /**
   * Method restore
   *
   * @description
   * Rebuilds a stored organization.
   *
   * @param {OrganizationState} state - The stored state.
   * @returns {Organization} The organization.
   * @throws {InvalidStoredStateError} When the version is not a positive integer.
   */
  public static restore(state: OrganizationState): Organization {
    if (!Number.isInteger(state.version) || state.version < 1) {
      throw new InvalidStoredStateError('organization', 'the version is a positive integer');
    }
    return new Organization(state);
  }

  /**
   * Method checkedName
   *
   * @description
   * Trims a name and checks its length.
   *
   * @param {string} raw - The name as typed.
   * @returns {string} The trimmed name.
   * @throws {InvalidOrganizationNameError} When it is blank or longer than 120 characters.
   */
  private static checkedName(raw: string): string {
    const name: string = raw.trim();
    if (name.length === 0 || name.length > Organization.NAME_MAX_LENGTH) {
      throw new InvalidOrganizationNameError();
    }
    return name;
  }

  /**
   * Method checkedDescription
   *
   * @description
   * Checks the length of a description.
   *
   * @param {string | null} description - The description, or `null`.
   * @returns {string | null} The same value.
   * @throws {InvalidDescriptionError} When it is longer than 280 characters.
   */
  private static checkedDescription(description: string | null): string | null {
    if (description !== null && description.length > Organization.DESCRIPTION_MAX_LENGTH) {
      throw new InvalidDescriptionError();
    }
    return description;
  }

  /**
   * Method nextWebsite
   *
   * @description
   * The website after a patch: unchanged when left out, cleared by `null`, checked otherwise.
   *
   * @param {string | null | undefined} patched - The member of the patch.
   * @param {string | null} current - The current website.
   * @returns {string | null} The website after the patch.
   * @throws {InvalidWebsiteError} When the new website is not an http or https URL.
   */
  private static nextWebsite(
    patched: string | null | undefined,
    current: string | null,
  ): string | null {
    if (patched === undefined) {
      return current;
    }
    return patched === null ? null : Website.parse(patched).value;
  }

  /**
   * Method change
   *
   * @description
   * Applies a JSON Merge Patch of the profile: a member left out is unchanged, `null` clears the
   * description or the website. When something moves, the version goes up by one.
   *
   * @param {OrganizationChange} change - The patch.
   * @returns {OrganizationUpdate} The organization after the change and the members that moved.
   * @throws {InvalidOrganizationNameError} When the new name is blank or too long.
   * @throws {SlugInvalidError} When the new address is not valid.
   * @throws {InvalidDescriptionError} When the new description is too long.
   * @throws {InvalidWebsiteError} When the new website is not an http or https URL.
   */
  public change(change: OrganizationChange): OrganizationUpdate {
    const next: {
      name: string;
      slug: string;
      description: string | null;
      website: string | null;
      defaultLanguage: OrganizationState['defaultLanguage'];
    } = {
      name: change.name === undefined ? this.state.name : Organization.checkedName(change.name),
      slug: change.slug === undefined ? this.state.slug : Slug.parse(change.slug).value,
      description:
        change.description === undefined
          ? this.state.description
          : Organization.checkedDescription(change.description),
      website: Organization.nextWebsite(change.website, this.state.website),
      defaultLanguage: change.defaultLanguage ?? this.state.defaultLanguage,
    };
    const fields: readonly OrganizationField[] = [
      'name',
      'slug',
      'description',
      'website',
      'defaultLanguage',
    ];
    const changed: OrganizationField[] = fields.filter(
      (field: OrganizationField): boolean => next[field] !== this.state[field],
    );
    if (changed.length === 0) {
      return { organization: this, changed };
    }
    return {
      organization: new Organization({ ...this.state, ...next, version: this.state.version + 1 }),
      changed,
    };
  }
  // #endregion
}
