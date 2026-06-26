export type MachineHealthState = 'OK' | 'Deteriorating' | 'Failing';

export interface MachineHealthInput {
  anomalyPercentage?: number | null;
  wearTrendScore?: number | null;
}

export interface MachineHealthThresholds {
  anomalyDeteriorating: number;
  anomalyFailing: number;
  wearDeteriorating: number;
  wearFailing: number;
}

export interface MachineHealthResult {
  state: MachineHealthState;
  recommendation: string;
  reasons: string[];
  recommendationKey: string;
  reasonsI18n: Array<{ key: string; values?: Record<string, string> }>;
}

export const DEFAULT_MACHINE_HEALTH_THRESHOLDS: MachineHealthThresholds = {
  anomalyDeteriorating: 5,
  anomalyFailing: 15,
  wearDeteriorating: 0.5,
  wearFailing: 1.2,
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const deriveMachineHealthStatus = (
  input: MachineHealthInput,
  thresholds: MachineHealthThresholds = DEFAULT_MACHINE_HEALTH_THRESHOLDS
): MachineHealthResult => {
  const anomaly = isFiniteNumber(input.anomalyPercentage) ? input.anomalyPercentage : null;
  const wear = isFiniteNumber(input.wearTrendScore) ? input.wearTrendScore : null;

  const reasons: string[] = [];

  const isAnomalyFailing = anomaly != null && anomaly >= thresholds.anomalyFailing;
  const isWearFailing = wear != null && wear >= thresholds.wearFailing;
  if (isAnomalyFailing) {
    reasons.push(`High abnormal behavior (${anomaly.toFixed(1)}%).`);
  }
  if (isWearFailing) {
    reasons.push(`Accelerating wear trend (${wear.toFixed(2)}).`);
  }

  if (isAnomalyFailing || isWearFailing) {
    return {
      state: 'Failing',
      recommendation: 'Escalate to maintenance immediately and inspect machine condition.',
      reasons,
      recommendationKey: 'health.recommendationFailing',
      reasonsI18n: [
        ...(isAnomalyFailing
          ? [{ key: 'health.reasonHighAbnormal', values: { value: anomaly!.toFixed(1) } }]
          : []),
        ...(isWearFailing
          ? [{ key: 'health.reasonAcceleratingWear', values: { value: wear!.toFixed(2) } }]
          : []),
      ],
    };
  }

  const isAnomalyDeteriorating = anomaly != null && anomaly >= thresholds.anomalyDeteriorating;
  const isWearDeteriorating = wear != null && wear >= thresholds.wearDeteriorating;

  if (isAnomalyDeteriorating) {
    reasons.push(`Elevated abnormal behavior (${anomaly.toFixed(1)}%).`);
  }
  if (isWearDeteriorating) {
    reasons.push(`Wear trend rising (${wear.toFixed(2)}).`);
  }

  if (isAnomalyDeteriorating || isWearDeteriorating) {
    return {
      state: 'Deteriorating',
      recommendation: 'Schedule maintenance window soon and continue close monitoring.',
      reasons,
      recommendationKey: 'health.recommendationDeteriorating',
      reasonsI18n: [
        ...(isAnomalyDeteriorating
          ? [{ key: 'health.reasonElevatedAbnormal', values: { value: anomaly!.toFixed(1) } }]
          : []),
        ...(isWearDeteriorating
          ? [{ key: 'health.reasonWearRising', values: { value: wear!.toFixed(2) } }]
          : []),
      ],
    };
  }

  return {
    state: 'OK',
    recommendation: 'Continue normal operation and monitor routinely.',
    reasons: ['Machine behavior is within normal range.'],
    recommendationKey: 'health.recommendationOk',
    reasonsI18n: [{ key: 'health.reasonNormal' }],
  };
};
