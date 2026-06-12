import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardPage from '@/app/dashboard/page';

vi.mock('@/hooks/useDashboardOverview', () => ({
  useDashboardOverview: () => ({
    datasetSourceGroups: [],
    selectedSourceKey: null,
    setSelectedSourceKey: vi.fn(),
    selectedLiveDatasetId: 14,
    streamingStatus: {
      total_points: 500,
      streamed_points: 240,
      progress_percentage: 48,
      latest_glow_count: 5,
      is_active: true,
      status: 'streaming',
    },
    alerts: [],
    alertSummary: {
      activeTotal: 1,
      bySeverity: { low: 0, medium: 1, high: 0, critical: 0 },
    },
    wearSnapshot: {
      score: 0.52,
      transitionMean: 0.31,
      metadataColumn: 'cycle',
      capturedAt: new Date().toISOString(),
      previewSeries: [
        { label: 'A', sortIndex: 1, distance: 0.2, datasetType: 'baseline' },
        { label: 'B', sortIndex: 2, distance: 0.5, datasetType: 'monitoring' },
      ],
      monitoringDistance: { mean: 0.5, latest: 0.5, max: 0.5, sampleCount: 1 },
      datasetId: 14,
    },
    wearDirection: 'up',
    machineStatus: { state: 'Deteriorating', recommendation: 'Inspect machine soon.' },
    history: [
      {
        timestamp: Date.now() - 1000,
        anomalyPercentage: 2.1,
        wearScore: 0.4,
        throughputPerMinute: null,
      },
      { timestamp: Date.now(), anomalyPercentage: 3.2, wearScore: 0.52, throughputPerMinute: null },
    ],
    latestAnomalyPercentage: 3.2,
    realtimeAnomaly: { anomalyPercentage: 3.2, anomalyCount: 8, totalPoints: 240 },
    anomalySource: 'model-detection',
    wearColumn: 'cycle',
    liveRefreshMs: 2000,
    appliedWearConfig: {
      datasetId: 14,
      metadataColumn: 'cycle',
      includeMonitoring: true,
      baselineClusterValues: ['A'],
      baselineRange: null,
      appliedAt: new Date().toISOString(),
    },
    isLoading: false,
    isRefreshingWear: false,
    wearError: null,
    refetchAll: vi.fn(),
  }),
}));

describe('Dashboard page integration', () => {
  it('renders operator-critical cards and actions', () => {
    render(<DashboardPage />);

    expect(screen.getByText('Operations Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Machine state')).toBeInTheDocument();
    expect(screen.getByText('Deteriorating')).toBeInTheDocument();
    expect(screen.getByText(/Real-time anomaly rate/i)).toBeInTheDocument();
    expect(screen.getByText(/Wear Trend Preview \(G0→Gi\)/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Live Monitor/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Insights/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Upload Data/i })).toBeInTheDocument();
  });
});
