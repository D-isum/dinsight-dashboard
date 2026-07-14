import { describe, expect, it } from 'vitest';
import {
  deriveDistanceThresholds,
  parseDistanceThresholdConfigFromUiPrefs,
  sanitizeDistanceThresholdConfig,
} from '@/lib/distance-thresholds';

describe('distance thresholds', () => {
  it('derives adaptive warning and danger levels from baseline spread', () => {
    const result = deriveDistanceThresholds(
      [0.2, 0.25, 0.3, 0.35, 0.4],
      0.3,
      sanitizeDistanceThresholdConfig({
        mode: 'adaptive',
        warningSpreadMultiplier: 1.5,
        dangerSpreadMultiplier: 2.5,
      })
    );

    expect(result.source).toBe('baseline-adaptive');
    expect(result.warning).toBeGreaterThan(0.3);
    expect(result.danger).toBeGreaterThan(result.warning);
  });

  it('falls back to relative thresholds when baseline spread is unavailable', () => {
    const result = deriveDistanceThresholds(
      [],
      0.5,
      sanitizeDistanceThresholdConfig({
        mode: 'adaptive',
        warningRelativePercent: 30,
        dangerRelativePercent: 60,
      })
    );

    expect(result.source).toBe('baseline-relative-fallback');
    expect(result.warning).toBeCloseTo(0.65);
    expect(result.danger).toBeCloseTo(0.8);
  });

  it('keeps statistical danger above warning for a flat baseline', () => {
    const result = deriveDistanceThresholds(
      [0.4, 0.4, 0.4, 0.4],
      0.4,
      sanitizeDistanceThresholdConfig({
        mode: 'statistical',
        warningSpreadMultiplier: 1.5,
        dangerSpreadMultiplier: 2.5,
      })
    );

    expect(result.source).toBe('baseline-statistical');
    expect(result.warning).toBeCloseTo(0.4);
    expect(result.danger).toBeGreaterThan(result.warning);
  });

  it('reads and sanitizes the shared UI preference payload', () => {
    const parsed = parseDistanceThresholdConfigFromUiPrefs(
      JSON.stringify({
        distanceThresholdConfig: {
          mode: 'relative',
          warningRelativePercent: 20,
          dangerRelativePercent: 10,
        },
      })
    );

    expect(parsed.mode).toBe('relative');
    expect(parsed.dangerRelativePercent).toBeGreaterThan(parsed.warningRelativePercent);
  });
});
