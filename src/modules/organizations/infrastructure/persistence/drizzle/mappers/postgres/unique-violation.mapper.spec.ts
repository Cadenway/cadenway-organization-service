import { describe, expect, it } from 'vitest';

import { violatedUniqueConstraint } from './unique-violation.mapper.js';

describe('violatedUniqueConstraint', () => {
  it('reads the constraint of a unique violation wrapped by Drizzle', () => {
    const pgError: Error = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'organizations_slug_unique',
    });
    const wrapped: Error = new Error('Failed query', { cause: pgError });

    expect(violatedUniqueConstraint(wrapped)).toBe('organizations_slug_unique');
    expect(violatedUniqueConstraint(pgError)).toBe('organizations_slug_unique');
  });

  it('answers null for any other error', () => {
    const lock: Error = Object.assign(new Error('lock timeout'), { code: '55P03' });

    expect(violatedUniqueConstraint(new Error('Failed query', { cause: lock }))).toBeNull();
    expect(violatedUniqueConstraint('not an error')).toBeNull();
  });
});
