'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Columns2,
  GripVertical,
  Map,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { LiveMonitorWorkspace } from '@/components/monitor/live-monitor-workspace';
import { HealthInsightsWorkspace } from '@/components/monitor/health-insights-workspace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { WorkflowState } from '@/components/ui/workflow-state';
import { useAuth } from '@/context/auth-context';
import {
  DASHBOARD_COMMAND_EVENT,
  useDashboardWorkspace,
} from '@/context/dashboard-workspace-context';
import { useDashboardOverview } from '@/hooks/useDashboardOverview';
import { useI18n } from '@/i18n/client';
import { readScoped, writeScoped } from '@/lib/scoped-storage';
import { cn } from '@/utils/cn';

type AssetMonitorView = 'compare' | 'map' | 'deterioration';
type AssetMonitorControlPanel = 'map' | 'analysis' | null;

const ASSET_MONITOR_VIEW_KEY = 'asset-monitor:view:v1';
const ASSET_MONITOR_SPLIT_KEY = 'asset-monitor:compare-split:v1';
const MIN_COMPARE_SPLIT = 35;
const MAX_COMPARE_SPLIT = 65;

const isAssetMonitorView = (value: string | null): value is AssetMonitorView =>
  value === 'compare' || value === 'map' || value === 'deterioration';

const stateAccent = {
  OK: 'border-l-success-text',
  Deteriorating: 'border-l-warning-text',
  Failing: 'border-l-danger-text',
} as const;

const stateBadge = {
  OK: 'success',
  Deteriorating: 'warning',
  Failing: 'danger',
} as const;

const alertTone = {
  low: 'border-border bg-surface-muted',
  medium: 'border-warning-border bg-warning-bg',
  high: 'border-danger-border bg-danger-bg',
  critical: 'border-danger-border bg-danger-bg',
} as const;

const wearAlertKeys = {
  'wear-failing': {
    title: 'assetMonitor.failingTrendRisk',
    message: 'assetMonitor.failingTrendRiskMessage',
  },
  'wear-deteriorating': {
    title: 'assetMonitor.deteriorationAlert',
    message: 'assetMonitor.deteriorationAlertMessage',
  },
  'wear-early-warning': {
    title: 'assetMonitor.earlyWarning',
    message: 'assetMonitor.earlyWarningMessage',
  },
} as const;

export default function AssetMonitorPage() {
  const { user } = useAuth();
  const { t, formatNumber, formatTime } = useI18n();
  const { selectedDatasetId, selectedDataset, setMachineHealthSnapshot } = useDashboardWorkspace();
  const {
    streamingStatus,
    alerts,
    wearSnapshot,
    machineStatus,
    latestAnomalyPercentage,
    history,
    isLoading,
    refetchAll,
  } = useDashboardOverview();
  const [view, setView] = useState<AssetMonitorView>('compare');
  const [controlPanel, setControlPanel] = useState<AssetMonitorControlPanel>(null);
  const [compareSplit, setCompareSplit] = useState(50);
  const [isResizingCompare, setIsResizingCompare] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const compareContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const queryView = new URLSearchParams(window.location.search).get('view');
    if (isAssetMonitorView(queryView)) {
      setView(queryView);
    } else {
      const stored = readScoped(ASSET_MONITOR_VIEW_KEY, user?.id);
      if (isAssetMonitorView(stored)) {
        setView(stored);
      }
    }

    const storedSplit = Number(readScoped(ASSET_MONITOR_SPLIT_KEY, user?.id));
    if (Number.isFinite(storedSplit)) {
      setCompareSplit(Math.min(MAX_COMPARE_SPLIT, Math.max(MIN_COMPARE_SPLIT, storedSplit)));
    }
  }, [user?.id]);

  useEffect(() => {
    writeScoped(ASSET_MONITOR_VIEW_KEY, user?.id, view);
  }, [user?.id, view]);

  useEffect(() => {
    writeScoped(ASSET_MONITOR_SPLIT_KEY, user?.id, String(compareSplit));
  }, [compareSplit, user?.id]);

  useEffect(() => {
    if (!controlPanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setControlPanel(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controlPanel]);

  const changeView = useCallback((nextView: AssetMonitorView) => {
    setView(nextView);
    setControlPanel(null);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('view', nextView);
    window.history.replaceState(window.history.state, '', nextUrl);
  }, []);

  const updateCompareSplit = useCallback((clientX: number) => {
    const bounds = compareContainerRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) return;
    const percentage = ((clientX - bounds.left) / bounds.width) * 100;
    setCompareSplit(
      Math.round(Math.min(MAX_COMPARE_SPLIT, Math.max(MIN_COMPARE_SPLIT, percentage)))
    );
  }, []);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === 'run-wear-trend') {
        changeView('deterioration');
      }
    };
    window.addEventListener(DASHBOARD_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(DASHBOARD_COMMAND_EVENT, onCommand);
  }, [changeView]);

  const healthStateLabel =
    machineStatus.state === 'OK'
      ? t('health.ok')
      : machineStatus.state === 'Deteriorating'
        ? t('health.deteriorating')
        : t('health.failing');
  const recommendation = t(machineStatus.recommendationKey);
  const reasons = useMemo(
    () =>
      machineStatus.reasonsI18n.length > 0
        ? machineStatus.reasonsI18n.map((reason) => t(reason.key, reason.values))
        : [recommendation],
    [machineStatus.reasonsI18n, recommendation, t]
  );

  useEffect(() => {
    setMachineHealthSnapshot({
      state: machineStatus.state,
      recommendation,
      reasons,
      updatedAt: new Date().toISOString(),
    });
  }, [machineStatus.state, reasons, recommendation, setMachineHealthSnapshot]);

  const streamLabel =
    streamingStatus?.status === 'streaming'
      ? t('dashboard.streaming')
      : streamingStatus?.status === 'completed'
        ? t('common.completed')
        : t('dashboard.notStarted');
  const lastUpdate = history.at(-1)?.timestamp ?? null;
  const assetName =
    selectedDataset?.source.deviceName ??
    selectedDataset?.source.deviceSlug ??
    (selectedDatasetId
      ? t('assetMonitor.manualAsset', { id: selectedDatasetId })
      : t('assetMonitor.title'));
  const assetDetail =
    selectedDataset?.source.originalFileName ??
    selectedDataset?.source.iotHubDeviceId ??
    selectedDataset?.source.iotHubName ??
    (selectedDatasetId ? t('dashboard.selectedDataset', { id: selectedDatasetId }) : '');
  const primaryAlert = alerts[0] ?? null;
  const primaryAlertTitle = primaryAlert
    ? primaryAlert.kind
      ? t(wearAlertKeys[primaryAlert.kind].title)
      : primaryAlert.title
    : null;
  const primaryAlertMessage = primaryAlert
    ? primaryAlert.kind
      ? t(wearAlertKeys[primaryAlert.kind].message, primaryAlert.messageValues)
      : primaryAlert.message
    : null;

  const refreshWorkspace = async () => {
    setIsRefreshing(true);
    try {
      await refetchAll();
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!selectedDatasetId && !isLoading) {
    return (
      <WorkflowState
        icon={<Activity className="h-5 w-5" aria-hidden="true" />}
        title={t('assetMonitor.noDatasetTitle')}
        description={t('assetMonitor.noDatasetDescription')}
        action={
          <Button asChild>
            <Link href="/dashboard/data">{t('assetMonitor.openData')}</Link>
          </Button>
        }
        className="min-h-[28rem]"
      />
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="bg-canvas pb-1">
        <Card
          className={cn(
            'overflow-visible border border-l-4 border-border bg-surface shadow-sm',
            stateAccent[machineStatus.state]
          )}
        >
          <CardContent className="p-3">
            <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase text-fg-muted">
                    {t('assetMonitor.title')}
                  </span>
                  <Badge variant={stateBadge[machineStatus.state]}>{healthStateLabel}</Badge>
                  {selectedDatasetId && <Badge variant="outline">#{selectedDatasetId}</Badge>}
                </div>
                <h1 className="mt-1 truncate text-lg font-semibold text-fg" title={assetName}>
                  {assetName}
                </h1>
                <p className="truncate text-xs text-fg-muted" title={assetDetail}>
                  {assetDetail}
                </p>
              </div>

              <div className="grid min-w-0 flex-[1.5] grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-4">
                <StatusMetric
                  label={t('assetMonitor.stream')}
                  value={streamLabel}
                  detail={`${formatNumber(streamingStatus?.streamed_points ?? 0)} / ${formatNumber(
                    streamingStatus?.total_points ?? 0
                  )}`}
                />
                <StatusMetric
                  label={t('assetMonitor.anomaly')}
                  value={
                    latestAnomalyPercentage == null
                      ? t('common.notAvailable')
                      : `${latestAnomalyPercentage.toFixed(1)}%`
                  }
                />
                <StatusMetric
                  label={t('assetMonitor.latestDistance')}
                  value={
                    wearSnapshot?.monitoringDistance.latest == null
                      ? t('common.notAvailable')
                      : wearSnapshot.monitoringDistance.latest.toFixed(3)
                  }
                />
                <StatusMetric
                  label={t('assetMonitor.lastUpdate')}
                  value={lastUpdate ? formatTime(lastUpdate) : t('common.notAvailable')}
                />
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <details className="relative">
                  <summary className="flex h-10 cursor-pointer list-none items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                    {t('assetMonitor.whyThisState')}
                  </summary>
                  <div className="absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[min(32rem,calc(100vw-2rem))] rounded-md border border-border bg-surface p-3 text-sm text-fg shadow-xl">
                    <p className="font-medium">{recommendation}</p>
                    <ul className="mt-2 grid gap-1 text-fg-muted">
                      {reasons.map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                </details>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void refreshWorkspace()}
                  disabled={isRefreshing}
                  aria-label={t('assetMonitor.refreshWorkspace')}
                  title={t('assetMonitor.refreshWorkspace')}
                >
                  <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
                </Button>
              </div>
            </div>

            {primaryAlert && primaryAlertTitle && primaryAlertMessage && (
              <div
                className={cn(
                  'mt-2 flex flex-wrap items-center gap-2 border-t px-1 pt-2 text-sm',
                  primaryAlert.severity === 'critical' || primaryAlert.severity === 'high'
                    ? 'border-danger-border text-danger-text'
                    : 'border-warning-border text-warning-text'
                )}
              >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="font-semibold">{primaryAlertTitle}</span>
                <span className="min-w-0 flex-1 text-fg-muted">{primaryAlertMessage}</span>
                <Link
                  href="#active-asset-alerts"
                  className="rounded-md px-2 py-1 font-medium text-fg underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  {t('assetMonitor.viewAlertDetails')}
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col items-stretch gap-2 rounded-lg border border-border bg-surface p-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="grid w-full min-w-0 grid-cols-3 gap-1 sm:flex sm:w-auto sm:flex-none">
          <ViewButton
            active={view === 'compare'}
            onClick={() => changeView('compare')}
            icon={<Columns2 className="h-4 w-4" />}
            label={t('assetMonitor.overview')}
          />
          <ViewButton
            active={view === 'map'}
            onClick={() => changeView('map')}
            icon={<Map className="h-4 w-4" />}
            label={t('assetMonitor.coordinateMap')}
          />
          <ViewButton
            active={view === 'deterioration'}
            onClick={() => changeView('deterioration')}
            icon={<BarChart3 className="h-4 w-4" />}
            label={t('assetMonitor.wearTrend')}
          />
        </div>
        <div
          className={cn(
            'grid w-full gap-2 sm:flex sm:w-auto',
            view === 'compare' ? 'grid-cols-2' : 'grid-cols-1'
          )}
        >
          {view !== 'deterioration' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setControlPanel((current) => (current === 'map' ? null : 'map'))}
              className="h-10 min-w-0"
              aria-expanded={controlPanel === 'map'}
              aria-controls="asset-monitor-map-controls"
            >
              <Settings2 className="mr-2 h-4 w-4" />
              <span className="truncate">{t('assetMonitor.configureMap')}</span>
            </Button>
          )}
          {view !== 'map' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setControlPanel((current) => (current === 'analysis' ? null : 'analysis'))
              }
              className="h-10 min-w-0"
              aria-expanded={controlPanel === 'analysis'}
              aria-controls="asset-monitor-analysis-controls"
            >
              <Settings2 className="mr-2 h-4 w-4" />
              <span className="truncate">{t('assetMonitor.configureAnalysis')}</span>
            </Button>
          )}
        </div>
      </div>

      <div
        ref={compareContainerRef}
        className={cn(
          'min-w-0',
          view === 'compare' && 'grid gap-4 xl:flex xl:items-start xl:gap-0'
        )}
      >
        <section
          className={cn(
            'min-w-0',
            view === 'deterioration' && 'hidden',
            view === 'compare' && 'xl:flex-none'
          )}
          style={view === 'compare' ? { flexBasis: `calc(${compareSplit}% - 0.5rem)` } : undefined}
        >
          <LiveMonitorWorkspace
            controlsMode="managed"
            controlsPresentation="drawer"
            controlsOpen={controlPanel === 'map'}
            onControlsOpenChange={(open) => setControlPanel(open ? 'map' : null)}
            compactChart={view === 'compare'}
            embedded
            hideFooter
            hideWorkspaceHeader
            healthStatusOverride={machineStatus}
            publishHealthSnapshot={false}
          />
        </section>

        {view === 'compare' && (
          <button
            type="button"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('assetMonitor.resizeComparison')}
            aria-valuemin={MIN_COMPARE_SPLIT}
            aria-valuemax={MAX_COMPARE_SPLIT}
            aria-valuenow={compareSplit}
            title={t('assetMonitor.resizeComparison')}
            className={cn(
              'group hidden h-[clamp(420px,56vh,620px)] w-4 shrink-0 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus xl:flex',
              isResizingCompare && 'bg-accent-subtle'
            )}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setIsResizingCompare(true);
              updateCompareSplit(event.clientX);
            }}
            onPointerMove={(event) => {
              if (isResizingCompare) updateCompareSplit(event.clientX);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              setIsResizingCompare(false);
            }}
            onPointerCancel={() => setIsResizingCompare(false)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                setCompareSplit((current) => Math.max(MIN_COMPARE_SPLIT, current - 5));
              }
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                setCompareSplit((current) => Math.min(MAX_COMPARE_SPLIT, current + 5));
              }
              if (event.key === 'Home') {
                event.preventDefault();
                setCompareSplit(50);
              }
            }}
          >
            <span className="flex h-16 w-2 items-center justify-center rounded-full border border-border bg-surface text-fg-muted shadow-sm transition-colors group-hover:border-control-border-focus group-hover:text-fg">
              <GripVertical className="h-4 w-4" aria-hidden="true" />
            </span>
          </button>
        )}

        <section
          className={cn(
            'min-w-0',
            view === 'map' && 'hidden',
            view === 'compare' && 'hidden md:block xl:flex-none'
          )}
          style={
            view === 'compare' ? { flexBasis: `calc(${100 - compareSplit}% - 0.5rem)` } : undefined
          }
        >
          <HealthInsightsWorkspace
            controlsMode="managed"
            controlsPresentation="drawer"
            controlsOpen={controlPanel === 'analysis'}
            onControlsOpenChange={(open) => setControlPanel(open ? 'analysis' : null)}
            compactChart={view === 'compare'}
            embedded
            hideFooter
            hideWorkspaceHeader
            publishHealthSnapshot={false}
          />
        </section>
      </div>

      <Card id="active-asset-alerts" className="scroll-mt-4 border-border/70">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-fg">{t('assetMonitor.activeAlerts')}</h2>
              <p className="text-sm text-fg-muted">{t('assetMonitor.activeAlertsDescription')}</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/account?section=active-alerts">
                {t('assetMonitor.organizationAlerts')}
              </Link>
            </Button>
          </div>
          {alerts.length > 0 ? (
            <div className="grid gap-2 xl:grid-cols-3">
              {alerts.slice(0, 3).map((alert) => (
                <div
                  key={alert.id}
                  className={cn('rounded-md border p-3 text-sm', alertTone[alert.severity])}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-medium text-fg">
                        {alert.kind ? t(wearAlertKeys[alert.kind].title) : alert.title}
                      </p>
                      <p className="mt-1 line-clamp-2 text-fg-muted">
                        {alert.kind
                          ? t(wearAlertKeys[alert.kind].message, alert.messageValues)
                          : alert.message}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-border bg-surface-muted px-3 py-4 text-sm text-fg-muted">
              {t('assetMonitor.noActiveAlerts')}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusMetric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 border-l border-border pl-3 odd:border-l-0 odd:pl-0 sm:odd:border-l sm:odd:pl-3 sm:first:border-l-0 sm:first:pl-0">
      <p className="text-[10px] font-semibold uppercase text-fg-muted">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-fg" title={value}>
        {value}
      </p>
      {detail && (
        <p className="truncate text-[11px] text-fg-muted" title={detail}>
          {detail}
        </p>
      )}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'ghost'}
      size="sm"
      onClick={onClick}
      className="h-12 w-full min-w-0 flex-col gap-1 px-1 text-xs sm:h-9 sm:w-auto sm:flex-row sm:gap-2 sm:px-3 sm:text-sm"
      aria-pressed={active}
      title={label}
    >
      {icon}
      <span className="whitespace-normal text-center leading-tight sm:truncate">{label}</span>
    </Button>
  );
}
