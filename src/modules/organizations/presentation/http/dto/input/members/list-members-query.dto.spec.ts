import { describe, expect, it } from 'vitest';

import { ListMembersQuery } from './list-members-query.dto.js';

describe('ListMembersQuery', () => {
  it('reads limit from the text of the query string with the validator of the contract', () => {
    expect(ListMembersQuery.schema.parse({ limit: '20' })).toMatchObject({ limit: 20 });
    expect(ListMembersQuery.schema.parse({})).toMatchObject({ limit: 50 });
    for (const limit of ['0', '101', 'ten', '8.5', '']) {
      expect(ListMembersQuery.schema.safeParse({ limit }).success).toBe(false);
    }
  });

  it('keeps splitting the comma-separated roles', () => {
    expect(ListMembersQuery.schema.parse({ role: 'owner,admin', limit: '2' })).toEqual({
      role: ['owner', 'admin'],
      limit: 2,
    });
    expect(ListMembersQuery.schema.safeParse({ role: 'owner,chief' }).success).toBe(false);
  });
});
