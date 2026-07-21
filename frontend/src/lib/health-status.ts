export type MachineHealthState = 'Unknown' | 'OK' | 'Deteriorating' | 'Failing';

export interface MachineHealthInput {
  anomalyPercentage?: number | null;
  wearTrendScore?: number | null;
  wearThresholdState?: 'normal' | 'warning' | 'danger' | null;
  wearLatestDistance?: number | null;
  wearWarningThreshold?: number | null;
  wearDangerThreshold?: number | null;
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
  const latestDistance = isFiniteNumber(input.wearLatestDistance) ? input.wearLatestDistance : null;
  const warningThreshold = isFiniteNumber(input.wearWarningThreshold)
    ? input.wearWarningThreshold
    : null;
  const dangerThreshold = isFiniteNumber(input.wearDangerThreshold)
    ? input.wearDangerThreshold
    : null;
  const hasAdaptiveWearState = input.wearThresholdState != null;

  if (anomaly == null && wear == null && latestDistance == null && !hasAdaptiveWearState) {
    return {
      state: 'Unknown',
      recommendation:
        'Add monitoring data and configure a healthy baseline before assessing condition.',
      reasons: ['No monitoring evidence is available for a condition assessment.'],
      recommendationKey: 'health.recommendationUnknown',
      reasonsI18n: [{ key: 'health.reasonUnknown' }],
    };
  }

  const reasons: string[] = [];

  const isAnomalyFailing = anomaly != null && anomaly >= thresholds.anomalyFailing;
  const isWearFailing = hasAdaptiveWearState
    ? input.wearThresholdState === 'danger'
    : wear != null && wear >= thresholds.wearFailing;
  if (isAnomalyFailing) {
    reasons.push(`High abnormal behavior (${anomaly.toFixed(1)}%).`);
  }
  if (isWearFailing) {
    reasons.push(
      latestDistance != null && dangerThreshold != null
        ? `Latest deterioration distance (${latestDistance.toFixed(3)}) exceeds the danger threshold (${dangerThreshold.toFixed(3)}).`
        : `Accelerating wear trend (${wear?.toFixed(2) ?? 'n/a'}).`
    );
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
          ? latestDistance != null && dangerThreshold != null
            ? [
                {
                  key: 'health.reasonDistanceDanger',
                  values: {
                    value: latestDistance.toFixed(3),
                    threshold: dangerThreshold.toFixed(3),
                  },
                },
              ]
            : [
                {
                  key: 'health.reasonAcceleratingWear',
                  values: { value: wear?.toFixed(2) ?? 'n/a' },
                },
              ]
          : []),
      ],
    };
  }

  const isAnomalyDeteriorating = anomaly != null && anomaly >= thresholds.anomalyDeteriorating;
  const isWearDeteriorating = hasAdaptiveWearState
    ? input.wearThresholdState === 'warning'
    : wear != null && wear >= thresholds.wearDeteriorating;

  if (isAnomalyDeteriorating) {
    reasons.push(`Elevated abnormal behavior (${anomaly.toFixed(1)}%).`);
  }
  if (isWearDeteriorating) {
    reasons.push(
      latestDistance != null && warningThreshold != null
        ? `Latest deterioration distance (${latestDistance.toFixed(3)}) exceeds the warning threshold (${warningThreshold.toFixed(3)}).`
        : `Wear trend rising (${wear?.toFixed(2) ?? 'n/a'}).`
    );
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
          ? latestDistance != null && warningThreshold != null
            ? [
                {
                  key: 'health.reasonDistanceWarning',
                  values: {
                    value: latestDistance.toFixed(3),
                    threshold: warningThreshold.toFixed(3),
                  },
                },
              ]
            : [
                {
                  key: 'health.reasonWearRising',
                  values: { value: wear?.toFixed(2) ?? 'n/a' },
                },
              ]
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
