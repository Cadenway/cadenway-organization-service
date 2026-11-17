/**
 * Type DefaultLanguage
 *
 * @description
 * Default language of an organization ("Langue par défaut", `Organisation.dc.html`), a BCP 47 tag:
 * `fr` (Français), `en` (English) or `de` (Deutsch). The invitation emails are written in it.
 *
 * @type {'fr' | 'en' | 'de'}
 */
export type DefaultLanguage = 'fr' | 'en' | 'de';

/**
 * Constant DEFAULT_LANGUAGES
 *
 * @description
 * Every default language, in the order of the settings.
 *
 * @type {readonly DefaultLanguage[]}
 */
export const DEFAULT_LANGUAGES: readonly DefaultLanguage[] = ['fr', 'en', 'de'];

/**
 * Constant INITIAL_DEFAULT_LANGUAGE
 *
 * @description
 * Default language of a new organization: the creation form asks for none, and the settings start
 * on Français, as the example of `POST /v1/organizations` answers.
 *
 * @type {DefaultLanguage}
 */
export const INITIAL_DEFAULT_LANGUAGE: DefaultLanguage = 'fr';
