import { describe, expect, it } from 'vitest';

import { toVersionCondition } from './if-match.validation.js';

describe('toVersionCondition', () => {
  it('reads the versions of an If-Match header, a star, or its absence', () => {
    expect(toVersionCondition('"3"')).toEqual([3]);
    expect(toVersionCondition('"2", "3"')).toEqual([2, 3]);
    expect(toVersionCondition('*')).toBe('any');
    expect(toVersionCondition(undefined)).toBeNull();
  });

  it('answers 400 request.invalid for a header that is not a list of entity tags', () => {
    expect(() => toVersionCondition('version-3')).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ status: 400, code: 'request.invalid' }) as unknown,
      }) as Error,
    );
  });
});
