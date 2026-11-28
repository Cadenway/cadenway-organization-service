import { describe, expect, it } from 'vitest';

import { isLockTimeout } from './lock-timeout.mapper.js';

describe('isLockTimeout', () => {
  it('finds the lock timeout of PostgreSQL, wrapped or not', () => {
    const timeout: Error = Object.assign(new Error('lock timeout'), { code: '55P03' });

    expect(isLockTimeout(timeout)).toBe(true);
    expect(isLockTimeout(new Error('Failed query', { cause: timeout }))).toBe(true);
  });

  it('ignores any other failure', () => {
    expect(isLockTimeout(Object.assign(new Error('unique'), { code: '23505' }))).toBe(false);
    expect(isLockTimeout('55P03')).toBe(false);
  });
});
