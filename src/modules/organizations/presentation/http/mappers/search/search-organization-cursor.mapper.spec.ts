import { describe, expect, it } from 'vitest';

import { SearchOrganizationCursor } from './search-organization-cursor.mapper.js';

describe('SearchOrganizationCursor', () => {
  const key = Buffer.alloc(32, 7).toString('base64url');
  const cursor = new SearchOrganizationCursor(key);
  const invalidCursorProblem: unknown = expect.objectContaining({
    status: 400,
    code: 'request.invalid',
  });
  const position = {
    afterId: '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12',
    upperId: '019a7002-2b3c-7d4e-8f5a-6b7c8d9e0f12',
  };

  it('preserves the export bounds between instances with the same configured key', () => {
    const signingReplica = new SearchOrganizationCursor(key);
    expect(cursor.read(signingReplica.write(position) ?? undefined)).toEqual(position);
    expect(cursor.read(undefined)).toBeNull();
    expect(cursor.write(null)).toBeNull();
  });

  it('resumes a signed scan when both positions use historical UUIDv4 IDs', () => {
    const legacyPosition = {
      afterId: '019a7001-2b3c-4d4e-8f5a-6b7c8d9e0f12',
      upperId: '019a7002-2b3c-4d4e-8f5a-6b7c8d9e0f12',
    };
    expect(cursor.read(cursor.write(legacyPosition) ?? undefined)).toEqual(legacyPosition);
  });

  it('rejects tampered and differently signed continuations', () => {
    const signed = cursor.write(position) ?? '';
    const tampered = `${signed.startsWith('X') ? 'Y' : 'X'}${signed.slice(1)}`;
    const anotherKey = Buffer.alloc(32, 9).toString('base64url');
    const wrongSigner = new SearchOrganizationCursor(anotherKey);
    for (const invalid of ['', tampered, `${signed}.extra`, wrongSigner.write(position) ?? '']) {
      expect(() => cursor.read(invalid)).toThrow(
        expect.objectContaining({ problem: invalidCursorProblem }),
      );
    }
  });

  it('rejects an invalid or exhausted range even when correctly signed', () => {
    for (const invalid of [
      { ...position, upperId: 'not-an-id' },
      { ...position, upperId: position.afterId },
      { upperId: position.afterId, afterId: position.upperId },
    ]) {
      expect(() => cursor.read(cursor.write(invalid) ?? undefined)).toThrow(
        expect.objectContaining({ problem: invalidCursorProblem }),
      );
    }
  });
});
