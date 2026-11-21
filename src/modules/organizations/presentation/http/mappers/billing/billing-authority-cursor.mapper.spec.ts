import { describe, expect, it } from 'vitest';

import { BillingAuthorityCursor } from './billing-authority-cursor.mapper.js';

const tenant = '019a7001-2b3c-7d4e-8f5a-6b7c8d9e0f12';
const afterId = '019a7002-2b3c-7d4e-8f5a-6b7c8d9e0f12';
const upperId = '019a7003-2b3c-7d4e-8f5a-6b7c8d9e0f12';

describe('BillingAuthorityCursor', () => {
  it('round trips the source bound and rejects another tenant or operation', () => {
    const cursor = new BillingAuthorityCursor(Buffer.alloc(32, 7).toString('base64url'));
    const encoded = cursor.write({ afterId, upperId }, 'memberships', tenant);
    expect(typeof encoded).toBe('string');
    if (encoded === null) throw new Error('Expected a continuation.');

    expect(cursor.read(encoded, 'memberships', tenant)).toEqual({ afterId, upperId });
    expect(() => cursor.read(encoded, 'organizations', null)).toThrow();
    expect(() => cursor.read(encoded, 'memberships', upperId)).toThrow();
    expect(() => cursor.read(`${encoded}x`, 'memberships', tenant)).toThrow();
    expect(() => cursor.read('x'.repeat(1025), 'memberships', tenant)).toThrow();
  });

  it('binds recipient continuations to a tenant without an upper bound', () => {
    const cursor = new BillingAuthorityCursor(Buffer.alloc(32, 8).toString('base64url'));
    const encoded = cursor.write({ afterId, upperId: null }, 'recipients', tenant);
    if (encoded === null) throw new Error('Expected a continuation.');

    expect(cursor.read(encoded, 'recipients', tenant)).toEqual({ afterId, upperId: null });
    expect(() => cursor.read(encoded, 'recipients', upperId)).toThrow();
  });

  it('fails closed when no stable cursor key is configured', () => {
    expect(() =>
      new BillingAuthorityCursor(undefined).read(undefined, 'organizations', null),
    ).toThrow();
  });
});
