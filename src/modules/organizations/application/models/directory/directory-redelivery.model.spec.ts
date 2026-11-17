import { describe, expect, it } from 'vitest';

import { DIRECTORY_REDELIVERY } from './directory-redelivery.model.js';

describe('DIRECTORY_REDELIVERY', () => {
  it('is the schedule of decision 3: 1 s, 5 s, 30 s, 2 min, 10 min, 30 min, then hourly, 32 deliveries', () => {
    expect(DIRECTORY_REDELIVERY).toEqual({
      delaysMs: [1_000, 5_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000],
      maxDeliveries: 32,
    });
  });

  it('keeps trying a failing event for more than 24 hours before its dead letter', () => {
    const { delaysMs, maxDeliveries } = DIRECTORY_REDELIVERY;
    const waits: number[] = Array.from(
      { length: maxDeliveries - 1 },
      (_: unknown, index: number) => delaysMs[Math.min(index, delaysMs.length - 1)] ?? 0,
    );
    const waited: number = waits.reduce((total: number, delay: number) => total + delay, 0);

    expect(waited).toBe(92_556_000);
    expect(waited).toBeGreaterThan(24 * 60 * 60_000);
  });
});
