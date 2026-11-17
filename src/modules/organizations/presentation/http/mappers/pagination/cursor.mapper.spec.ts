import { encodeCursor } from '@cadenway/nest-common';
import { describe, expect, it } from 'vitest';

import { isInstant, toNextCursor, toPagePosition } from './cursor.mapper.js';

/** Id of the membership of Hugo Dubois. */
const HUGO_MEMBER_ID: string = '019a5f3d-1a2b-7c3d-8e4f-5a6b7c8d9e42';

/** The refusal of a cursor, as the contract declares it. */
const INVALID: Error = expect.objectContaining({
  response: expect.objectContaining({ status: 400, code: 'request.invalid' }) as unknown,
}) as Error;

describe('cursors', () => {
  const filters = { list: 'members', role: ['admin', 'owner'] };

  it('carries the position of the last item, for the same filters only', () => {
    const cursor: string | null = toNextCursor({ key: 'hugo dubois', id: HUGO_MEMBER_ID }, filters);

    expect(toNextCursor(null, filters)).toBeNull();
    expect(toPagePosition(undefined, filters)).toBeNull();
    expect(toPagePosition(cursor ?? '', filters)).toEqual({
      key: 'hugo dubois',
      id: HUGO_MEMBER_ID,
    });
    expect(() => toPagePosition(cursor ?? '', { list: 'members', role: null })).toThrow(INVALID);
    expect(() => toPagePosition('not-a-cursor', filters)).toThrow(INVALID);
  });

  it('refuses a forged position before it reaches a query', () => {
    const numeric: string = encodeCursor({ sort: [3], id: HUGO_MEMBER_ID }, filters);
    const notUuid: string = encodeCursor({ sort: ['hugo dubois'], id: 'member-2' }, filters);
    const notInstant: string = encodeCursor({ sort: ['yesterday'], id: HUGO_MEMBER_ID }, filters);

    expect(() => toPagePosition(numeric, filters)).toThrow(INVALID);
    expect(() => toPagePosition(notUuid, filters)).toThrow(INVALID);
    expect(() => toPagePosition(notInstant, filters, isInstant)).toThrow(INVALID);
    expect(isInstant('2026-11-06T16:20:00.000Z')).toBe(true);
  });
});
