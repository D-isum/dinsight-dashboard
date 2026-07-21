import { describe, expect, it } from 'vitest';
import { deriveMachineHealthStatus } from '@/lib/health-status';

describe('deriveMachineHealthStatus', () => {
  it('returns Unknown when no monitoring evidence is available', () => {
    const result = deriveMachineHealthStatus({});

    expect(result.state).toBe('Unknown');
    expect(result.recommendationKey).toBe('health.recommendationUnknown');
  });

  it('returns OK when inputs are below thresholds', () => {
    const result = deriveMachineHealthStatus({ anomalyPercentage: 2, wearTrendScore: 0.2 });
    expect(result.state).toBe('OK');
  });

  it('returns Deteriorating when anomaly exceeds deteriorating threshold', () => {
    const result = deriveMachineHealthStatus({ anomalyPercentage: 8, wearTrendScore: 0.2 });
    expect(result.state).toBe('Deteriorating');
  });

  it('returns Failing when wear exceeds failing threshold', () => {
    const result = deriveMachineHealthStatus({ anomalyPercentage: 2, wearTrendScore: 1.4 });
    expect(result.state).toBe('Failing');
  });

  it('uses the adaptive distance band when one is available', () => {
    const result = deriveMachineHealthStatus({
      anomalyPercentage: 8,
      wearTrendScore: 0.7,
      wearThresholdState: 'danger',
      wearLatestDistance: 1.55,
      wearWarningThreshold: 0.603,
      wearDangerThreshold: 0.778,
    });

    expect(result.state).toBe('Failing');
    expect(result.reasonsI18n).toContainEqual({
      key: 'health.reasonDistanceDanger',
      values: { value: '1.550', threshold: '0.778' },
    });
  });
});
