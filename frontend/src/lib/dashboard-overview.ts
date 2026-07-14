import { deriveMachineHealthStatus, MachineHealthResult } from '@/lib/health-status';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved';

export interface DashboardAlert {
  id: number;
  datasetId?: number | null;
  title: string;
  message: string;
  kind?: 'wear-failing' | 'wear-deteriorating' | 'wear-early-warning';
  messageValues?: Record<string, string | number>;
  severity: AlertSeverity;
  status: AlertStatus;
  anomalyPercentage: number;
  createdAt: string;
}

export interface AlertSummary {
  activeTotal: number;
  bySeverity: Record<AlertSeverity, number>;
}

export interface DashboardHistoryPoint {
  timestamp: number;
  anomalyPercentage: number | null;
  wearScore: number | null;
  throughputPerMinute: number | null;
}

export interface WearTrendAlertInput {
  datasetId: number | null;
  metadataColumn: string;
  baselineMean: number | null;
  monitoringMean: number | null;
  monitoringLatest: number | null;
  monitoringMax: number | null;
  sampleCount: number;
  warningThreshold: number;
  dangerThreshold: number;
}

const ALERT_SEVERITY_RANK: Record<AlertSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export const sortDashboardAlerts = (alerts: DashboardAlert[]): DashboardAlert[] =>
  [...alerts].sort((a, b) => {
    const severityDelta = ALERT_SEVERITY_RANK[b.severity] - ALERT_SEVERITY_RANK[a.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

export const summarizeAlerts = (alerts: DashboardAlert[]): AlertSummary => {
  const bySeverity: Record<AlertSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  let activeTotal = 0;
  alerts.forEach((alert) => {
    if (alert.status !== 'active') {
      return;
    }
    activeTotal += 1;
    bySeverity[alert.severity] += 1;
  });

  return { activeTotal, bySeverity };
};

export const buildWearTrendAlerts = (input: WearTrendAlertInput): DashboardAlert[] => {
  if (
    input.datasetId == null ||
    input.sampleCount === 0 ||
    input.monitoringMean == null ||
    input.monitoringLatest == null
  ) {
    return [];
  }

  const nowIso = new Date().toISOString();
  const warningThreshold = Number.isFinite(input.warningThreshold) ? input.warningThreshold : 0.8;
  const dangerThreshold = Number.isFinite(input.dangerThreshold) ? input.dangerThreshold : 1.2;
  const earlyWarningThreshold =
    input.baselineMean != null && Number.isFinite(input.baselineMean)
      ? input.baselineMean + Math.max(0, warningThreshold - input.baselineMean) * 0.5
      : warningThreshold * 0.56;
  const syntheticIdBase = input.datasetId * 10;

  if (input.monitoringLatest >= dangerThreshold) {
    return [
      {
        id: -(syntheticIdBase + 3),
        datasetId: input.datasetId,
        title: 'Failing trend risk',
        message: `Latest monitoring distance ${input.monitoringLatest.toFixed(3)} exceeds the danger threshold ${dangerThreshold.toFixed(3)} (mean ${input.monitoringMean.toFixed(3)}).`,
        kind: 'wear-failing',
        messageValues: {
          latest: input.monitoringLatest.toFixed(3),
          mean: input.monitoringMean.toFixed(3),
          danger: dangerThreshold.toFixed(3),
        },
        severity: 'critical',
        status: 'active',
        anomalyPercentage: 0,
        createdAt: nowIso,
      },
    ];
  }

  if (input.monitoringLatest >= warningThreshold) {
    return [
      {
        id: -(syntheticIdBase + 2),
        datasetId: input.datasetId,
        title: 'Deterioration alert',
        message: `Latest monitoring distance ${input.monitoringLatest.toFixed(3)} exceeds the warning threshold ${warningThreshold.toFixed(3)} (mean ${input.monitoringMean.toFixed(3)}).`,
        kind: 'wear-deteriorating',
        messageValues: {
          latest: input.monitoringLatest.toFixed(3),
          mean: input.monitoringMean.toFixed(3),
          warning: warningThreshold.toFixed(3),
        },
        severity: 'high',
        status: 'active',
        anomalyPercentage: 0,
        createdAt: nowIso,
      },
    ];
  }

  if (input.monitoringLatest >= earlyWarningThreshold) {
    return [
      {
        id: -(syntheticIdBase + 1),
        datasetId: input.datasetId,
        title: 'Early warning',
        message: `Latest monitoring distance ${input.monitoringLatest.toFixed(3)} is approaching the warning threshold ${warningThreshold.toFixed(3)} (mean ${input.monitoringMean.toFixed(3)}).`,
        kind: 'wear-early-warning',
        messageValues: {
          latest: input.monitoringLatest.toFixed(3),
          mean: input.monitoringMean.toFixed(3),
          warning: warningThreshold.toFixed(3),
        },
        severity: 'medium',
        status: 'active',
        anomalyPercentage: 0,
        createdAt: nowIso,
      },
    ];
  }

  return [];
};

export const getLatestAnomalyPercentage = (alerts: DashboardAlert[]): number | null => {
  if (alerts.length === 0) {
    return null;
  }

  const sorted = [...alerts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  for (const alert of sorted) {
    if (Number.isFinite(alert.anomalyPercentage)) {
      return alert.anomalyPercentage;
    }
  }

  return null;
};

export const deriveWearDirection = (
  previous: number | null,
  current: number | null
): 'up' | 'down' | 'stable' => {
  if (previous == null || current == null) {
    return 'stable';
  }

  const delta = current - previous;
  if (Math.abs(delta) < 0.01) {
    return 'stable';
  }

  return delta > 0 ? 'up' : 'down';
};

export const deriveDashboardMachineState = (input: {
  anomalyPercentage: number | null;
  wearScore: number | null;
  wearThresholdState?: 'normal' | 'warning' | 'danger' | null;
  wearLatestDistance?: number | null;
  wearWarningThreshold?: number | null;
  wearDangerThreshold?: number | null;
}): MachineHealthResult =>
  deriveMachineHealthStatus({
    anomalyPercentage: input.anomalyPercentage,
    wearTrendScore: input.wearScore,
    wearThresholdState: input.wearThresholdState,
    wearLatestDistance: input.wearLatestDistance,
    wearWarningThreshold: input.wearWarningThreshold,
    wearDangerThreshold: input.wearDangerThreshold,
  });

export const appendHistoryPoint = (
  history: DashboardHistoryPoint[],
  next: DashboardHistoryPoint,
  maxItems = 10_000
): DashboardHistoryPoint[] => {
  const merged = [...history, next];
  if (merged.length <= maxItems) {
    return merged;
  }
  return merged.slice(merged.length - maxItems);
};

export const buildSparklinePath = (
  values: Array<number | null>,
  width: number,
  height: number
): string => {
  const finite = values.filter((value): value is number => typeof value === 'number');
  if (finite.length < 2) {
    return '';
  }

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min || 1;

  let path = '';
  values.forEach((value, index) => {
    if (value == null || Number.isNaN(value)) {
      return;
    }

    const x = (index / Math.max(values.length - 1, 1)) * width;
    const normalized = (value - min) / range;
    const y = height - normalized * height;
    path += `${path ? ' L' : 'M'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  return path;
};
