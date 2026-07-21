import { describe, expect, it } from 'vitest';
import {
  appendHistoryPoint,
  buildWearTrendAlerts,
  buildSparklinePath,
  deriveDashboardMachineState,
  deriveWearDirection,
  getLatestAnomalyPercentage,
  sortDashboardAlerts,
  summarizeAlerts,
  type DashboardAlert,
} from '@/lib/dashboard-overview';

describe('dashboard overview helpers', () => {
  it('summarizes active alerts by severity', () => {
    const alerts: DashboardAlert[] = [
      {
        id: 1,
        title: 'A',
        message: '',
        severity: 'critical',
        status: 'active',
        anomalyPercentage: 20,
        createdAt: '2026-02-24T10:00:00.000Z',
      },
      {
        id: 2,
        title: 'B',
        message: '',
        severity: 'high',
        status: 'active',
        anomalyPercentage: 10,
        createdAt: '2026-02-24T11:00:00.000Z',
      },
      {
        id: 3,
        title: 'C',
        message: '',
        severity: 'high',
        status: 'resolved',
        anomalyPercentage: 2,
        createdAt: '2026-02-24T12:00:00.000Z',
      },
    ];

    const summary = summarizeAlerts(alerts);
    expect(summary.activeTotal).toBe(2);
    expect(summary.bySeverity.critical).toBe(1);
    expect(summary.bySeverity.high).toBe(1);
  });

  it('uses newest anomaly percentage from alerts', () => {
    const anomaly = getLatestAnomalyPercentage([
      {
        id: 1,
        title: 'Old',
        message: '',
        severity: 'medium',
        status: 'active',
        anomalyPercentage: 5,
        createdAt: '2026-02-24T09:00:00.000Z',
      },
      {
        id: 2,
        title: 'New',
        message: '',
        severity: 'high',
        status: 'active',
        anomalyPercentage: 12,
        createdAt: '2026-02-24T10:00:00.000Z',
      },
    ]);

    expect(anomaly).toBe(12);
  });

  it('prioritizes alert severity before recency', () => {
    const sorted = sortDashboardAlerts([
      {
        id: 1,
        title: 'Recent warning',
        message: '',
        severity: 'medium',
        status: 'active',
        anomalyPercentage: 5,
        createdAt: '2026-02-24T12:00:00.000Z',
      },
      {
        id: 2,
        title: 'Critical condition',
        message: '',
        severity: 'critical',
        status: 'active',
        anomalyPercentage: 20,
        createdAt: '2026-02-24T10:00:00.000Z',
      },
    ]);

    expect(sorted.map((alert) => alert.id)).toEqual([2, 1]);
  });

  it('derives wear direction', () => {
    expect(deriveWearDirection(0.4, 0.7)).toBe('up');
    expect(deriveWearDirection(0.8, 0.5)).toBe('down');
    expect(deriveWearDirection(0.5, 0.505)).toBe('stable');
  });

  it('caps history length', () => {
    const history = Array.from({ length: 24 }, (_, index) => ({
      timestamp: index,
      anomalyPercentage: index,
      wearScore: index,
      throughputPerMinute: index,
    }));

    const updated = appendHistoryPoint(
      history,
      {
        timestamp: 25,
        anomalyPercentage: 25,
        wearScore: 25,
        throughputPerMinute: 25,
      },
      24
    );

    expect(updated).toHaveLength(24);
    expect(updated[0].timestamp).toBe(1);
    expect(updated[23].timestamp).toBe(25);
  });

  it('builds sparkline path and derives machine state', () => {
    const path = buildSparklinePath([1, 2, 3], 100, 20);
    expect(path.startsWith('M')).toBe(true);

    const state = deriveDashboardMachineState({ anomalyPercentage: 17, wearScore: 0.2 });
    expect(state.state).toBe('Failing');
  });

  it('does not report a healthy state without monitoring evidence', () => {
    const state = deriveDashboardMachineState({ anomalyPercentage: null, wearScore: null });

    expect(state.state).toBe('Unknown');
  });

  it('builds wear trend alert stages', () => {
    const early = buildWearTrendAlerts({
      datasetId: 14,
      metadataColumn: 'interval',
      baselineMean: 0.3,
      monitoringMean: 0.36,
      monitoringLatest: 0.46,
      monitoringMax: 0.52,
      sampleCount: 12,
      warningThreshold: 0.6,
      dangerThreshold: 0.9,
    });
    expect(early[0]?.severity).toBe('medium');

    const deteriorating = buildWearTrendAlerts({
      datasetId: 14,
      metadataColumn: 'interval',
      baselineMean: 0.3,
      monitoringMean: 0.71,
      monitoringLatest: 0.63,
      monitoringMax: 0.9,
      sampleCount: 12,
      warningThreshold: 0.6,
      dangerThreshold: 0.9,
    });
    expect(deteriorating[0]?.severity).toBe('high');

    const failing = buildWearTrendAlerts({
      datasetId: 14,
      metadataColumn: 'interval',
      baselineMean: 0.3,
      monitoringMean: 1.01,
      monitoringLatest: 0.94,
      monitoringMax: 1.6,
      sampleCount: 12,
      warningThreshold: 0.6,
      dangerThreshold: 0.9,
    });
    expect(failing[0]?.severity).toBe('critical');
    expect(failing[0]?.id).toBeLessThan(0);
  });
});
