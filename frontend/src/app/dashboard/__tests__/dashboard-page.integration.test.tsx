import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardPage from '@/app/dashboard/page';
import { I18nProvider } from '@/i18n/client';

vi.mock('@/context/dashboard-workspace-context', () => ({
  useDashboardWorkspace: () => ({
    selectedDatasetId: 14,
    selectDataset: () => undefined,
    selectSource: () => undefined,
    activities: [
      {
        id: 'activity-1',
        type: 'streaming',
        title: 'Monitor batch completed',
        description: 'Streaming simulator uploaded the latest batch.',
        datasetId: 14,
        timestamp: new Date().toISOString(),
        href: '/dashboard/live',
        status: 'success',
      },
    ],
    setMachineHealthSnapshot: () => undefined,
  }),
}));

vi.mock('@/hooks/useDeploymentStatus', () => ({
  useDeploymentStatus: () => ({
    runtime: {
      apiBaseUrl: 'http://localhost:8080/api/v1',
      browserHost: 'localhost:3000',
      label: 'Local dev',
      isSharedVm: false,
      isLocal: true,
      devLicenseExtensionDays: null,
    },
    license: {
      isValid: true,
      daysUntilExpiry: 30,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      customerId: 'test-customer',
      version: 'test',
      registeredDevices: 1,
      maxDevices: 5,
    },
    isLoadingLicense: false,
    licenseError: null,
  }),
}));

vi.mock('@/hooks/useDashboardOverview', () => ({
  useDashboardOverview: () => ({
    datasets: [
      {
        dinsight_id: 14,
        name: 'Dataset #14',
        type: 'dinsight',
        records: 240,
        source: {
          source: 'manual',
          originalFileName: 'bearing-baseline.csv',
        },
      },
    ],
    latestDatasetId: 14,
    datasetSourceGroups: [],
    selectedSourceKey: null,
    setSelectedSourceKey: vi.fn(),
    selectedLiveDatasetId: 14,
    streamingStatus: {
      total_points: 500,
      streamed_points: 240,
      progress_percentage: 48,
      latest_glow_count: 5,
      trail_points: 5,
      batch_size: 1,
      delay_seconds: 2,
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
    machineStatus: {
      state: 'Deteriorating',
      recommendation: 'Inspect machine soon.',
      reasons: ['Anomaly is rising.'],
      recommendationKey: 'health.recommendationDeteriorating',
      reasonsI18n: [],
    },
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
    render(
      <I18nProvider initialLocale="en">
        <DashboardPage />
      </I18nProvider>
    );

    expect(screen.getByText('Machine status')).toBeInTheDocument();
    expect(screen.getAllByText('Deteriorating').length).toBeGreaterThan(0);
    expect(screen.getByText('Next steps')).toBeInTheDocument();
    expect(screen.getByText('Dataset queue')).toBeInTheDocument();
    expect(screen.getByText('Checks')).toBeInTheDocument();
    expect(screen.getByText('Live signal')).toBeInTheDocument();
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
    expect(screen.getByText('Stream settings')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Live stream/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Open insights/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /Open catalog/i }).length).toBeGreaterThan(0);
  });
});
