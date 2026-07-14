import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AssetMonitorPage from '@/app/dashboard/monitor/page';
import { I18nProvider } from '@/i18n/client';

vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ user: { id: 7 } }),
}));

vi.mock('@/context/dashboard-workspace-context', () => ({
  DASHBOARD_COMMAND_EVENT: 'dinsight:dashboard-command',
  useDashboardWorkspace: () => ({
    selectedDatasetId: 56,
    selectedDataset: {
      dinsight_id: 56,
      name: 'Dataset #56',
      type: 'dinsight',
      source: {
        source: 'manual',
        originalFileName: 'bearing-baseline.csv',
      },
    },
    setMachineHealthSnapshot: vi.fn(),
  }),
}));

vi.mock('@/hooks/useDashboardOverview', () => ({
  useDashboardOverview: () => ({
    streamingStatus: {
      total_points: 200,
      streamed_points: 120,
      status: 'streaming',
    },
    alerts: [
      {
        id: 'wear-deteriorating',
        kind: 'wear-deteriorating',
        severity: 'high',
        title: 'Deterioration alert',
        message: 'Wear is rising.',
        messageValues: { latest: '0.8', mean: '0.6' },
      },
    ],
    wearSnapshot: {
      metadataColumn: 'timestamp',
      monitoringDistance: { latest: 0.8 },
    },
    machineStatus: {
      state: 'Deteriorating',
      recommendationKey: 'health.recommendationDeteriorating',
      reasonsI18n: [],
    },
    latestAnomalyPercentage: 8,
    history: [{ timestamp: '2026-01-01T10:00:00Z' }],
    isLoading: false,
    refetchAll: vi.fn(),
  }),
}));

vi.mock('@/components/monitor/live-monitor-workspace', () => ({
  LiveMonitorWorkspace: ({ controlsOpen }: { controlsOpen?: boolean }) => (
    <div data-testid="map-workspace" data-controls-open={String(Boolean(controlsOpen))}>
      Coordinate workspace
    </div>
  ),
}));

vi.mock('@/components/monitor/health-insights-workspace', () => ({
  HealthInsightsWorkspace: ({ controlsOpen }: { controlsOpen?: boolean }) => (
    <div data-testid="wear-workspace" data-controls-open={String(Boolean(controlsOpen))}>
      Wear workspace
    </div>
  ),
}));

describe('Asset Monitor page', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/dashboard/monitor?view=compare');
    window.localStorage.clear();
  });

  it('keeps overview plots mounted while opening controls and supports focused views', () => {
    render(
      <I18nProvider initialLocale="en">
        <AssetMonitorPage />
      </I18nProvider>
    );

    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('map-workspace')).toBeVisible();
    expect(screen.getByTestId('wear-workspace')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Map controls' }));
    expect(screen.getByTestId('map-workspace')).toHaveAttribute('data-controls-open', 'true');
    expect(screen.getByTestId('wear-workspace')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Coordinate map' }));
    expect(screen.getByTestId('map-workspace')).toBeVisible();
    expect(screen.getByTestId('wear-workspace').parentElement).toHaveClass('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Wear trend' }));
    expect(screen.getByTestId('map-workspace').parentElement).toHaveClass('hidden');
    expect(screen.getByTestId('wear-workspace')).toBeVisible();
  });
});
