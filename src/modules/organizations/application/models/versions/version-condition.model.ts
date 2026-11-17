/**
 * Type VersionCondition
 *
 * @description
 * The `If-Match` of a change: the versions the caller made it from, `any` for `*`, or `null` when
 * the header is absent, since it is optional (`openapi/internal/organization-service.yaml`).
 *
 * @type {readonly number[] | 'any' | null}
 */
export type VersionCondition = readonly number[] | 'any' | null;
