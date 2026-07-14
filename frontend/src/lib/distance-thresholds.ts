export const INSIGHTS_UI_PREFS_KEY = 'insights-ui-prefs-v1';
export const INSIGHTS_DISTANCE_THRESHOLD_CONFIG_EVENT =
  'insights-distance-threshold-config-updated';

export const DISTANCE_WARNING_FALLBACK = 0.8;
export const DISTANCE_DANGER_FALLBACK = 1.2;

export type DistanceThresholdMode = 'adaptive' | 'statistical' | 'relative';

export interface DistanceThresholdConfig {
  mode: DistanceThresholdMode;
  warningSpreadMultiplier: number;
  dangerSpreadMultiplier: number;
  warningPercentile: number;
  dangerPercentile: number;
  warningRelativePercent: number;
  dangerRelativePercent: number;
}

export const DEFAULT_DISTANCE_THRESHOLD_CONFIG: DistanceThresholdConfig = {
  mode: 'adaptive',
  warningSpreadMultiplier: 1.5,
  dangerSpreadMultiplier: 2.5,
  warningPercentile: 95,
  dangerPercentile: 99,
  warningRelativePercent: 30,
  dangerRelativePercent: 60,
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
};

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const percentile = (values: number[], requestedPercentile: number) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }

  const rank = (clampNumber(requestedPercentile, 0, 100, 95) / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;

  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * weight;
};

const standardDeviation = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }

  const average = mean(values);
  if (average == null) {
    return null;
  }

  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const robustBaselineSpread = (values: number[], center: number) => {
  const deviations = values.map((value) => Math.abs(value - center));
  const medianAbsoluteDeviation = percentile(deviations, 50);
  const robustSigma =
    medianAbsoluteDeviation != null && medianAbsoluteDeviation > 0
      ? medianAbsoluteDeviation * 1.4826
      : null;
  const stdDev = standardDeviation(values);

  if (robustSigma != null && Number.isFinite(robustSigma) && robustSigma > 0) {
    return robustSigma;
  }
  if (stdDev != null && Number.isFinite(stdDev) && stdDev > 0) {
    return stdDev;
  }

  return Math.max(center * 0.05, 0.000001);
};

export const sanitizeDistanceThresholdConfig = (
  input?: Partial<DistanceThresholdConfig> | null
): DistanceThresholdConfig => {
  const isLegacyStatisticalDefault =
    input?.mode === 'statistical' &&
    input.warningSpreadMultiplier == null &&
    input.dangerSpreadMultiplier == null &&
    (input.warningPercentile == null ||
      Number(input.warningPercentile) === DEFAULT_DISTANCE_THRESHOLD_CONFIG.warningPercentile) &&
    (input.dangerPercentile == null ||
      Number(input.dangerPercentile) === DEFAULT_DISTANCE_THRESHOLD_CONFIG.dangerPercentile);
  const mode: DistanceThresholdMode = isLegacyStatisticalDefault
    ? DEFAULT_DISTANCE_THRESHOLD_CONFIG.mode
    : input?.mode === 'relative'
      ? 'relative'
      : input?.mode === 'statistical'
        ? 'statistical'
        : DEFAULT_DISTANCE_THRESHOLD_CONFIG.mode;
  const warningSpreadMultiplier = clampNumber(
    input?.warningSpreadMultiplier,
    0.1,
    10,
    DEFAULT_DISTANCE_THRESHOLD_CONFIG.warningSpreadMultiplier
  );
  const dangerSpreadMultiplier = Math.max(
    warningSpreadMultiplier + 0.1,
    clampNumber(
      input?.dangerSpreadMultiplier,
      0.2,
      12,
      DEFAULT_DISTANCE_THRESHOLD_CONFIG.dangerSpreadMultiplier
    )
  );
  const warningPercentile = clampNumber(
    input?.warningPercentile,
    50,
    99.8,
    DEFAULT_DISTANCE_THRESHOLD_CONFIG.warningPercentile
  );
  const dangerPercentile = Math.max(
    warningPercentile + 0.1,
    clampNumber(
      input?.dangerPercentile,
      50.1,
      99.9,
      DEFAULT_DISTANCE_THRESHOLD_CONFIG.dangerPercentile
    )
  );
  const warningRelativePercent = clampNumber(
    input?.warningRelativePercent,
    1,
    300,
    DEFAULT_DISTANCE_THRESHOLD_CONFIG.warningRelativePercent
  );
  const dangerRelativePercent = Math.max(
    warningRelativePercent + 1,
    clampNumber(
      input?.dangerRelativePercent,
      2,
      400,
      DEFAULT_DISTANCE_THRESHOLD_CONFIG.dangerRelativePercent
    )
  );

  return {
    mode,
    warningSpreadMultiplier,
    dangerSpreadMultiplier: Math.min(dangerSpreadMultiplier, 12),
    warningPercentile,
    dangerPercentile: Math.min(dangerPercentile, 99.9),
    warningRelativePercent,
    dangerRelativePercent: Math.min(dangerRelativePercent, 400),
  };
};

export const parseDistanceThresholdConfigFromUiPrefs = (payload: string | null) => {
  if (!payload) {
    return sanitizeDistanceThresholdConfig();
  }
  try {
    const parsed = JSON.parse(payload) as {
      distanceThresholdConfig?: Partial<DistanceThresholdConfig>;
    };
    return sanitizeDistanceThresholdConfig(parsed.distanceThresholdConfig);
  } catch {
    return sanitizeDistanceThresholdConfig();
  }
};

export const deriveDistanceThresholds = (
  baselineDistances: number[],
  baselineMean: number | null,
  config: DistanceThresholdConfig
) => {
  const finiteBaselineDistances = baselineDistances.filter(
    (value) => Number.isFinite(value) && value >= 0
  );

  if (config.mode === 'adaptive' && finiteBaselineDistances.length > 0) {
    const baselineCenter = percentile(finiteBaselineDistances, 50) ?? baselineMean;
    if (baselineCenter != null && Number.isFinite(baselineCenter) && baselineCenter >= 0) {
      const spread = robustBaselineSpread(finiteBaselineDistances, baselineCenter);
      const warning = baselineCenter + config.warningSpreadMultiplier * spread;
      const danger = baselineCenter + config.dangerSpreadMultiplier * spread;

      return {
        warning,
        danger: Math.max(danger, warning),
        source: 'baseline-adaptive' as const,
      };
    }
  }

  if (config.mode === 'statistical' && finiteBaselineDistances.length > 0) {
    const warning = percentile(finiteBaselineDistances, config.warningPercentile);
    const danger = percentile(finiteBaselineDistances, config.dangerPercentile);
    if (warning != null && danger != null && warning >= 0) {
      const minimumDangerGap = Math.max(
        robustBaselineSpread(finiteBaselineDistances, warning),
        Math.abs(warning) * 0.01,
        0.000001
      );
      return {
        warning,
        danger: danger > warning ? danger : warning + minimumDangerGap,
        source: 'baseline-statistical' as const,
      };
    }
  }

  if (baselineMean != null && Number.isFinite(baselineMean) && baselineMean > 0) {
    const warning = baselineMean * (1 + config.warningRelativePercent / 100);
    return {
      warning,
      danger: Math.max(warning, baselineMean * (1 + config.dangerRelativePercent / 100)),
      source:
        config.mode === 'relative'
          ? ('baseline-relative' as const)
          : ('baseline-relative-fallback' as const),
    };
  }

  return {
    warning: DISTANCE_WARNING_FALLBACK,
    danger: DISTANCE_DANGER_FALLBACK,
    source: 'fallback' as const,
  };
};
