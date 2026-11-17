/**
 * Type Refusal
 *
 * @description
 * Why a use case of the organizations module refused a request, with what the caller needs to
 * explain it. The presentation answers each with the status and the stable code of
 * `openapi/internal/organization-service.yaml`.
 *
 * @type {object}
 */
export type Refusal =
  | { readonly reason: 'invalid-field'; readonly field: string; readonly code: string }
  | { readonly reason: 'organization-not-found' }
  | { readonly reason: 'role-forbidden' }
  | { readonly reason: 'slug-taken'; readonly slug: string }
  | { readonly reason: 'slug-invalid'; readonly slug: string }
  | { readonly reason: 'version-mismatch'; readonly version: number }
  | { readonly reason: 'member-not-found' }
  | { readonly reason: 'owner-protected' }
  | { readonly reason: 'invitation-not-found' }
  | { readonly reason: 'invitation-email-mismatch' }
  | { readonly reason: 'invitation-revoked' }
  | { readonly reason: 'invitation-answered'; readonly status: 'accepted' | 'refused' }
  | { readonly reason: 'invitation-expired'; readonly expiresAt: Date }
  | { readonly reason: 'user-not-found' }
  | { readonly reason: 'user-not-synchronized' };
