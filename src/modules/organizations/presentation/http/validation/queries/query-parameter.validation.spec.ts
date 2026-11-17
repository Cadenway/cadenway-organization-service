import { ListMembersInternalQueryParams } from '@cadenway/contracts/validators/internal/organization-service';
import { describe, expect, it } from 'vitest';

import { integerParameter, listParameter } from './query-parameter.validation.js';

describe('query parameters', () => {
  const limit = integerParameter(ListMembersInternalQueryParams.shape.limit);
  const role = listParameter(ListMembersInternalQueryParams.shape.role);

  it('reads an integer from the text of the query string, with the default of the contract', () => {
    expect(limit.parse('20')).toBe(20);
    expect(limit.parse(undefined)).toBe(50);
    expect(limit.safeParse('0').success).toBe(false);
    expect(limit.safeParse('101').success).toBe(false);
    expect(limit.safeParse('ten').success).toBe(false);
  });

  it('reads comma-separated values, repeated or not, and validates each against the contract', () => {
    expect(role.parse('owner,admin')).toEqual(['owner', 'admin']);
    expect(role.parse(['owner', 'member,guest'])).toEqual(['owner', 'member', 'guest']);
    expect(role.parse(undefined)).toBeUndefined();
    expect(role.safeParse('owner,chief').success).toBe(false);
  });
});
