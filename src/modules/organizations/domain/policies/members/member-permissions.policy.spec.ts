import { describe, expect, it } from 'vitest';

import { RoleForbiddenError } from '../../errors/members/role-forbidden.error.js';
import { assertManagesOrganization, assertReadsMembers } from './member-permissions.policy.js';
import { takesSeat } from './seat.policy.js';

describe('member permissions', () => {
  it('lets the owner and the admins manage the organization, and nobody else', () => {
    expect(() => {
      assertManagesOrganization('owner');
    }).not.toThrow();
    expect(() => {
      assertManagesOrganization('admin');
    }).not.toThrow();
    expect(() => {
      assertManagesOrganization('member');
    }).toThrow(RoleForbiddenError);
    expect(() => {
      assertManagesOrganization('guest');
    }).toThrow(RoleForbiddenError);
  });

  it('lets everyone but the guests read the member list', () => {
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect(() => {
        assertReadsMembers(role);
      }).not.toThrow();
    }
    expect(() => {
      assertReadsMembers('guest');
    }).toThrow(RoleForbiddenError);
  });

  it('counts a seat for everyone but the guests', () => {
    expect(takesSeat('owner')).toBe(true);
    expect(takesSeat('member')).toBe(true);
    expect(takesSeat('guest')).toBe(false);
  });
});
