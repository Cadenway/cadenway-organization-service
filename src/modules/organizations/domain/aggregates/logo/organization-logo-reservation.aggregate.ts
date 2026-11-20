import { OrganizationLogoError } from '../../errors/logo/organization-logo.error.js';
import { InvalidStoredStateError } from '../../errors/organizations/invalid-stored-state.error.js';
import type { OrganizationLogoUploadAbandoned } from '../../events/logo/organization-logo-upload-abandoned.event.js';
import {
  isLogoMediaId,
  isLogoScopeId,
  sameLogoBinding,
  type OrganizationLogoBinding,
} from '../../value-objects/logo/organization-logo-binding.value-object.js';
import {
  declareOrganizationLogo,
  type OrganizationLogoDeclaration,
} from '../../value-objects/logo/organization-logo-declaration.value-object.js';
import type { OrganizationLogoReservationState } from '../../value-objects/logo/organization-logo-reservation-state.value-object.js';

/**
 * An immutable organization logo reservation owned by one uploader and image generation.
 * See the reserve, state and publish operations in the installed Organization OpenAPI contract
 * and the terminal upload decision in its AsyncAPI contract.
 */
export class OrganizationLogoReservation {
  // #region Properties
  /** A detached snapshot for persistence. */
  public get snapshot(): OrganizationLogoReservationState {
    return {
      ...this.state,
      declaration: { ...this.state.declaration },
      expiresAt: new Date(this.state.expiresAt),
    };
  }
  // #endregion

  // #region Constructor
  /** Keeps an already checked, privately owned state. */
  private constructor(private readonly state: OrganizationLogoReservationState) {}
  // #endregion

  // #region Methods
  /** Opens one pending reservation with the current logo generation and a future deadline. */
  public static open(
    binding: OrganizationLogoBinding,
    requested: Readonly<{ contentType: string; sizeBytes: number }>,
    generation: number,
    now: Date,
    expiresAt: Date,
  ): OrganizationLogoReservation {
    const declaration = declareOrganizationLogo(requested.contentType, requested.sizeBytes);
    if (!Number.isFinite(now.getTime()) || expiresAt.getTime() <= now.getTime()) {
      throw new InvalidStoredStateError('logo reservation', 'the deadline follows the allocation');
    }
    return OrganizationLogoReservation.restore({
      ...binding,
      declaration,
      generation,
      expiresAt,
      state: 'pending',
    });
  }

  /** Rebuilds an owner reservation while keeping the stored identity and deadline immutable. */
  public static restore(state: OrganizationLogoReservationState): OrganizationLogoReservation {
    if (
      !isLogoScopeId(state.organizationId) ||
      !isLogoScopeId(state.uploaderUserId) ||
      !isLogoMediaId(state.uploadId) ||
      !Number.isSafeInteger(state.generation) ||
      state.generation < 0 ||
      !Number.isFinite(state.expiresAt.getTime()) ||
      !['pending', 'committed', 'expired', 'superseded'].includes(state.state)
    ) {
      throw new InvalidStoredStateError(
        'logo reservation',
        'its identity, generation and state are valid',
      );
    }
    let declaration: OrganizationLogoDeclaration;
    try {
      declaration = declareOrganizationLogo(
        state.declaration.contentType,
        state.declaration.sizeBytes,
      );
    } catch {
      throw new InvalidStoredStateError('logo reservation', 'its declaration is valid');
    }
    return new OrganizationLogoReservation({
      ...state,
      organizationId: state.organizationId.toLowerCase(),
      uploaderUserId: state.uploaderUserId.toLowerCase(),
      uploadId: state.uploadId.toLowerCase(),
      declaration,
      expiresAt: new Date(state.expiresAt),
    });
  }

  /** Replays an identical declaration without extending or reopening the reservation. */
  public replay(
    binding: OrganizationLogoBinding,
    requested: Readonly<{ contentType: string; sizeBytes: number }>,
  ): { readonly uploadId: string; readonly expiresAt: Date } {
    this.requireBinding(binding);
    if (
      requested.contentType !== this.state.declaration.contentType ||
      requested.sizeBytes !== this.state.declaration.sizeBytes
    ) {
      throw new OrganizationLogoError('idempotency-key-reused');
    }
    return { uploadId: this.state.uploadId, expiresAt: new Date(this.state.expiresAt) };
  }

  /** Reports a committed replay or requires a pending reservation to be current. */
  public read(
    binding: OrganizationLogoBinding,
    currentGeneration: number,
    now: Date,
  ): 'pending' | 'committed' {
    this.requireBinding(binding);
    if (this.state.state === 'committed') return 'committed';
    const closed =
      this.state.state === 'pending'
        ? this.disqualification(currentGeneration, now)
        : this.state.state;
    if (closed === 'superseded') throw new OrganizationLogoError('upload-superseded');
    if (closed === 'expired') throw new OrganizationLogoError('upload-expired');
    return 'pending';
  }

  /** Commits the exact prepared reservation or returns its already committed receipt. */
  public commit(
    binding: OrganizationLogoBinding,
    prepared: OrganizationLogoBinding | null,
    currentGeneration: number,
    now: Date,
  ): OrganizationLogoReservation {
    if (this.read(binding, currentGeneration, now) === 'committed') return this;
    if (prepared === null || !sameLogoBinding(prepared, this.state)) {
      throw new OrganizationLogoError('upload-not-ready');
    }
    return new OrganizationLogoReservation({ ...this.state, state: 'committed' });
  }

  /** Ends a pending expired or superseded upload once while the owner holds the reservation lock. */
  public abandon(
    currentGeneration: number,
    now: Date,
  ): {
    readonly reservation: OrganizationLogoReservation;
    readonly event: OrganizationLogoUploadAbandoned | null;
  } {
    const state =
      this.state.state === 'pending' ? this.disqualification(currentGeneration, now) : null;
    if (state === null) return { reservation: this, event: null };
    return {
      reservation: new OrganizationLogoReservation({ ...this.state, state }),
      event: { organizationId: this.state.organizationId, uploadId: this.state.uploadId },
    };
  }

  /** Keeps all lookup refusals opaque across actor, tenant and upload identifiers. */
  private requireBinding(binding: OrganizationLogoBinding): void {
    if (!sameLogoBinding(binding, this.state)) throw new OrganizationLogoError('not-found');
  }

  /** Compares the latest locked generation and the exclusive owner deadline. */
  private disqualification(currentGeneration: number, now: Date): 'expired' | 'superseded' | null {
    if (
      !Number.isSafeInteger(currentGeneration) ||
      currentGeneration < this.state.generation ||
      !Number.isFinite(now.getTime())
    ) {
      throw new InvalidStoredStateError(
        'logo reservation',
        'the owner generation and clock are current',
      );
    }
    if (currentGeneration > this.state.generation) return 'superseded';
    return now.getTime() >= this.state.expiresAt.getTime() ? 'expired' : null;
  }
  // #endregion
}
