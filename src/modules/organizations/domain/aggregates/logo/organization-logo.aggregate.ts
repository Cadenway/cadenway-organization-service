import { OrganizationLogoError } from '../../errors/logo/organization-logo.error.js';
import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import type { OrganizationLogoChanged } from '../../events/logo/organization-logo-changed.event.js';
import {
  isLogoMediaId,
  isLogoScopeId,
  type OrganizationLogoBinding,
} from '../../value-objects/logo/organization-logo-binding.value-object.js';
import type { OrganizationLogoState } from '../../value-objects/logo/organization-logo-state.value-object.js';
import { OrganizationLogoReservation } from './organization-logo-reservation.aggregate.js';

/**
 * Organization's active opaque logo reference. In the published profile-media contract, changing
 * the image updates the organization ETag and emits a reference fact. Explicit removal fences
 * older reservations even when there is no image to retire.
 */
export class OrganizationLogo {
  // #region Properties
  /** A detached copy of the reference and versions for the owner transaction. */
  public get snapshot(): OrganizationLogoState {
    return { ...this.state };
  }
  // #endregion

  // #region Constructor
  /** Keeps a validated reference read from the organization row. */
  private constructor(private readonly state: OrganizationLogoState) {}
  // #endregion

  // #region Methods
  /** Restores the image generation and public profile version, also for rows without a logo. */
  public static restore(state: OrganizationLogoState): OrganizationLogo {
    if (
      !isLogoScopeId(state.organizationId) ||
      !Number.isSafeInteger(state.generation) ||
      state.generation < 0 ||
      !Number.isSafeInteger(state.profileVersion) ||
      state.profileVersion < 1 ||
      (state.assetId !== null && (!isLogoMediaId(state.assetId) || state.generation === 0))
    ) {
      throw new InvalidStoredStateError(
        'organization logo',
        'the immutable reference and versions are valid',
      );
    }
    return new OrganizationLogo({
      ...state,
      organizationId: state.organizationId.toLowerCase(),
      assetId: state.assetId?.toLowerCase() ?? null,
    });
  }

  /** Allocates a reservation scoped to the current image generation without changing the logo. */
  public reserve(
    binding: OrganizationLogoBinding,
    declaration: Readonly<{ contentType: string; sizeBytes: number }>,
    now: Date,
    expiresAt: Date,
  ): OrganizationLogoReservation {
    this.requireOrganization(binding.organizationId);
    return OrganizationLogoReservation.open(
      binding,
      declaration,
      this.state.generation,
      now,
      expiresAt,
    );
  }

  /**
   * Adopts an immutable upload only after the Gateway has verified Storage's preparation for
   * the same scoped binding. A committed replay returns the current organization ETag.
   */
  public publish(
    reservation: OrganizationLogoReservation,
    binding: OrganizationLogoBinding,
    prepared: OrganizationLogoBinding | null,
    now: Date,
    expectedVersion?: number,
  ): {
    readonly logo: OrganizationLogo;
    readonly reservation: OrganizationLogoReservation;
    readonly event: OrganizationLogoChanged | null;
  } {
    this.requireOrganization(binding.organizationId);
    const committed = reservation.commit(binding, prepared, this.state.generation, now);
    if (committed === reservation) return { logo: this, reservation, event: null };

    this.requireVersion(expectedVersion);
    const { uploadId, uploaderUserId } = committed.snapshot;
    if (uploadId === this.state.assetId) {
      throw new InvalidStoredStateError(
        'organization logo',
        'the active asset has a committed reservation',
      );
    }
    return { ...this.changeReference(uploadId, uploaderUserId), reservation: committed };
  }

  /** Clears the logo and invalidates older pending uploads under the same owner lock. */
  public remove(
    actorUserId: string,
    expectedVersion?: number,
  ): { readonly logo: OrganizationLogo; readonly event: OrganizationLogoChanged | null } {
    this.requireVersion(expectedVersion);
    return this.changeReference(null, actorUserId);
  }

  /** Applies a logo transition and advances only the versions it changes. */
  private changeReference(
    assetId: string | null,
    actorUserId: string,
  ): { readonly logo: OrganizationLogo; readonly event: OrganizationLogoChanged | null } {
    const { organizationId, assetId: oldAssetId } = this.state;
    const changed = assetId !== oldAssetId;
    const generation = this.state.generation + 1;
    const profileVersion = changed ? this.state.profileVersion + 1 : this.state.profileVersion;
    const logo = OrganizationLogo.restore({ organizationId, assetId, generation, profileVersion });
    const event = changed
      ? { organizationId, actorUserId: actorUserId.toLowerCase(), generation, assetId, oldAssetId }
      : null;
    return { logo, event };
  }

  /** Keeps the mutation bound to the organization selected by the verified caller. */
  private requireOrganization(organizationId: string): void {
    if (organizationId.toLowerCase() !== this.state.organizationId) {
      throw new OrganizationLogoError('not-found');
    }
  }

  /** Applies optional strong If-Match to first publication and removal. */
  private requireVersion(expectedVersion: number | undefined): void {
    if (expectedVersion !== undefined && expectedVersion !== this.state.profileVersion) {
      throw new OrganizationLogoError('version-mismatch', this.state.profileVersion);
    }
  }
  // #endregion
}
