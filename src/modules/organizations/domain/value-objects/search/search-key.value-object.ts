/**
 * Constant COMBINING_MARKS
 *
 * @description
 * The combining diacritical marks (U+0300 to U+036F) that the canonical decomposition separates
 * from their letters, as the creation form of the mockup strips them (`Organisations.dc.html`).
 *
 * @type {RegExp}
 */
const COMBINING_MARKS: RegExp = /[̀-ͯ]/gu;

/**
 * Function searchKeyOf
 *
 * @description
 * The form of a text that sorts and searches "without regard to case or accents"
 * (`openapi/public/members.yaml`, `openapi/public/organizations.yaml`): decomposed, stripped of its
 * combining marks, lowercased. `Inès Robert` and `ines robert` have the same key.
 *
 * @param {string} text - A name or an address.
 * @returns {string} Its key.
 */
export function searchKeyOf(text: string): string {
  return text.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}
