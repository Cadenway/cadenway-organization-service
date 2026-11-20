import { ProblemException } from '@cadenway/nest-common';
import { describe, expect, it } from 'vitest';

import { LogoDeclarationPipe, logoExpectedVersion, logoRequestKey } from './logo.validation.js';

function problem(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ProblemException);
    return (error as ProblemException).getResponse();
  }
  throw new Error('Expected a problem response.');
}

describe('organization logo HTTP validation', () => {
  const pipe = new LogoDeclarationPipe();
  const metadata = { type: 'body' } as const;

  it('accepts both declared formats and the exact maximum size', () => {
    expect(pipe.transform({ contentType: 'image/png', sizeBytes: 5_242_880 }, metadata)).toEqual({
      contentType: 'image/png',
      sizeBytes: 5_242_880,
    });
    expect(pipe.transform({ contentType: 'image/svg+xml', sizeBytes: 1 }, metadata)).toEqual({
      contentType: 'image/svg+xml',
      sizeBytes: 1,
    });
  });

  it('reports supported media refusals with the specified 422 codes', () => {
    for (const sizeBytes of [5_242_881, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        problem(() => pipe.transform({ contentType: 'image/png', sizeBytes }, metadata)),
      ).toMatchObject({ status: 422, code: 'media.file-too-large' });
    }
    expect(
      problem(() => pipe.transform({ contentType: 'image/jpeg', sizeBytes: 50 }, metadata)),
    ).toMatchObject({ status: 422, code: 'media.unsupported-type' });
  });

  it('refuses invalid or additional body fields using the contract validator', () => {
    for (const value of [
      { contentType: 'image/png', sizeBytes: 0 },
      { contentType: 'image/png', sizeBytes: 5_242_880.5 },
      { contentType: 'image/png', sizeBytes: 1, organizationId: 'other' },
      { contentType: 'image/png' },
    ]) {
      expect(problem(() => pipe.transform(value, metadata))).toMatchObject({
        status: 400,
        code: 'request.invalid',
      });
    }
  });

  it('validates request keys and accepts only a single strong ETag', () => {
    expect(logoRequestKey(undefined)).toBeUndefined();
    expect(logoRequestKey('same-request')).toBe('same-request');
    expect(logoExpectedVersion(undefined)).toBeUndefined();
    expect(logoExpectedVersion('"7"')).toBe(7);
    for (const header of ['*', 'W/"7"', '"07"', '"1", "2"']) {
      expect(problem(() => logoExpectedVersion(header))).toMatchObject({
        status: 400,
        code: 'request.invalid',
        details: { issues: [expect.objectContaining({ in: 'header', path: 'If-Match' })] },
      });
    }
    expect(problem(() => logoRequestKey(''))).toMatchObject({
      status: 400,
      code: 'request.invalid',
      details: { issues: [expect.objectContaining({ in: 'header', path: 'Idempotency-Key' })] },
    });
  });
});
