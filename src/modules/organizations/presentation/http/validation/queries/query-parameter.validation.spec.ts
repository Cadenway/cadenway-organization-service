import { ListMembersInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { describe, expect, it } from 'vitest';

import { listParameter } from './query-parameter.validation.js';

describe('query parameters', () => {
  const role = listParameter(ListMembersInternalQueryParams.shape.role);

  it('reads comma-separated values, repeated or not, and validates each against the contract', () => {
    expect(role.parse('owner,admin')).toEqual(['owner', 'admin']);
    expect(role.parse(['owner', 'member,guest'])).toEqual(['owner', 'member', 'guest']);
    expect(role.parse(undefined)).toBeUndefined();
    expect(role.safeParse('owner,chief').success).toBe(false);
  });
});
