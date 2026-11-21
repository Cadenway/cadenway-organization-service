import type { Role } from '../../../domain/value-objects/members/role.value-object.js';

/** Seat contribution or terminal removal for an immutable membership ID. */
export type BillingMembershipProjection =
  | {
      readonly memberId: string;
      readonly version: number;
      readonly state: 'active';
      readonly role: Role;
    }
  | { readonly memberId: string; readonly version: number; readonly state: 'removed' };
