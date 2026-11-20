import type { OrganizationLogo } from '../../../domain/aggregates/logo/organization-logo.aggregate.js';
import type { OrganizationLogoReservation } from '../../../domain/aggregates/logo/organization-logo-reservation.aggregate.js';
import type { Member } from '../../../domain/aggregates/member/member.aggregate.js';
import type { OrganizationLogoChanged } from '../../../domain/events/logo/organization-logo-changed.event.js';
import type { OrganizationLogoUploadAbandoned } from '../../../domain/events/logo/organization-logo-upload-abandoned.event.js';

/** Tenant-scoped owner state and outbox bound to a single transaction. */
export interface OrganizationLogoStore {
  // #region Methods
  /** Locks and returns the actor's current active membership. */
  lockMember(organizationId: string, userId: string): Promise<Member | null>;

  /** Locks the organization row and returns its logo generation and profile version. */
  lockLogo(organizationId: string): Promise<OrganizationLogo | null>;

  /** Finds an idempotency receipt scoped to the actor and organization. */
  findByKey(
    organizationId: string,
    userId: string,
    key: string,
  ): Promise<OrganizationLogoReservation | null>;

  /** Locks the exact tenant and uploader reservation. */
  lockReservation(
    organizationId: string,
    userId: string,
    uploadId: string,
  ): Promise<OrganizationLogoReservation | null>;

  /** Allocates an opaque UUID v7 without leaving the current transaction. */
  newUploadId(): Promise<string>;

  /** Persists the reservation and its optional 24-hour idempotency claim. */
  insertReservation(
    reservation: OrganizationLogoReservation,
    key: string | undefined,
  ): Promise<void>;

  /** Writes a reservation previously locked in this transaction. */
  saveReservation(reservation: OrganizationLogoReservation): Promise<void>;

  /** Writes the profile reference and generation while the organization row is locked. */
  saveLogo(logo: OrganizationLogo): Promise<void>;

  /** Appends the versioned reference change in this transaction's outbox. */
  appendLogoChanged(event: OrganizationLogoChanged): Promise<void>;

  /** Appends a terminal reservation decision in this transaction's outbox. */
  appendUploadAbandoned(event: OrganizationLogoUploadAbandoned): Promise<void>;
  // #endregion
}
