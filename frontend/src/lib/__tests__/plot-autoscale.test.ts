import { describe, expect, it } from 'vitest';
import { axisRangeRevisionPart, buildPaddedAxisRange } from '@/lib/plot-autoscale';

describe('plot-autoscale', () => {
  it('builds padded ranges from finite values only', () => {
    const range = buildPaddedAxisRange([0, 10, Number.NaN, undefined, null], {
      paddingRatio: 0.1,
    });

    expect(range).toEqual([-1, 11]);
  });

  it('keeps non-negative chart axes at or above the lower bound', () => {
    const range = buildPaddedAxisRange([0.4, 1.2, 2], {
      includeZero: true,
      lowerBound: 0,
      paddingRatio: 0.1,
    });

    expect(range?.[0]).toBe(0);
    expect(range?.[1]).toBeGreaterThan(2);
  });

  it('expands single-point ranges so Plotly has a usable span', () => {
    const range = buildPaddedAxisRange([3], { minSpan: 2 });

    expect(range).toEqual([1.5, 4.5]);
  });

  it('creates stable revision parts for axis ranges', () => {
    expect(axisRangeRevisionPart(undefined)).toBe('auto');
    expect(axisRangeRevisionPart([0, 1])).toBe('0.0000000:1.0000000');
  });
});
