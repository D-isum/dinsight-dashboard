'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  Upload,
  Waves,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DatasetSourceSelect } from '@/components/datasets/dataset-source-select';
import { useDashboardOverview } from '@/hooks/useDashboardOverview';
import { buildSparklinePath } from '@/lib/dashboard-overview';
import { cn } from '@/utils/cn';

const stateTone: Record<'OK' | 'Deteriorating' | 'Failing', string> = {
  OK: 'border-success-border bg-success-bg text-success-text   ',
  Deteriorating: 'border-warning-border bg-warning-bg text-warning-text   ',
  Failing: 'border-danger-border bg-danger-bg text-danger-text   ',
};
const WEAR_PREVIEW_BASE_MAX = 2;

const formatRelativeTime = (iso: string) => {
  const value = new Date(iso).getTime();
  if (!Number.isFinite(value)) return 'Unknown time';
  const diff = Date.now() - value;
  const minute = 60_000;
  const hour = minute * 60;
  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  return `${Math.floor(diff / hour)}h ago`;
};

function Sparkline({ values, stroke }: { values: Array<number | null>; stroke: string }) {
  const path = useMemo(() => buildSparklinePath(values, 320, 64), [values]);

  return (
    <svg viewBox="0 0 320 64" className="h-20 w-full" role="img" aria-label="Trend sparkline">
      <path d="M0 63 L320 63" stroke="currentColor" className="text-border/60" strokeWidth="1" />
      {path ? (
        <path d={path} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinecap="round" />
      ) : (
        <text x="8" y="36" fill="currentColor" className="text-muted-foreground text-xs">
          Not enough samples yet
        </text>
      )}
    </svg>
  );
}

function WearPreview({
  points,
}: {
  points: Array<{ label: string; sortIndex: number; distance: number; datasetType: string }>;
}) {
  const chart = useMemo(() => {
    const width = 640;
    const height = 260;
    const padding = { top: 24, right: 16, bottom: 28, left: 44 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const sortedPoints = [...points].sort((a, b) => a.sortIndex - b.sortIndex);
    const focusStart = 0;
    const visiblePoints = sortedPoints.slice(focusStart);
    const values = visiblePoints
      .map((point) => point.distance)
      .filter((value) => Number.isFinite(value));
    if (values.length === 0 || visiblePoints.length === 0) {
      return null;
    }

    const observedMax = Math.max(...values);
    const yAxisMax =
      observedMax <= WEAR_PREVIEW_BASE_MAX ? WEAR_PREVIEW_BASE_MAX : observedMax * 1.15;
    const minData = 0;
    const maxData = Math.max(yAxisMax, 0.1);
    const range = Math.max(0.1, maxData - minData);

    const toX = (index: number) =>
      padding.left + (index / Math.max(visiblePoints.length - 1, 1)) * plotWidth;
    const toY = (value: number) => padding.top + ((maxData - value) / range) * plotHeight;

    const polyline = visiblePoints
      .map((point, index) => `${toX(index).toFixed(2)},${toY(point.distance).toFixed(2)}`)
      .join(' ');
    const baselineY = toY(0);
    const selectedBaseline = sortedPoints
      .filter((point) => point.datasetType === 'baseline')
      .map((point) => point.distance);
    const monitoring = sortedPoints
      .filter((point) => point.datasetType === 'monitoring')
      .map((point) => point.distance);
    const mean = (arr: number[]) =>
      arr.length ? arr.reduce((sum, value) => sum + value, 0) / arr.length : null;
    const baselineMean = mean(selectedBaseline);
    const monitoringMean = mean(monitoring);

    return {
      width,
      height,
      padding,
      polyline,
      baselineY,
      baselineMeanY: baselineMean != null ? toY(baselineMean) : null,
      monitoringMeanY: monitoringMean != null ? toY(monitoringMean) : null,
      baselineMean,
      monitoringMean,
      firstLabel: visiblePoints[0]?.label || 'N/A',
      lastLabel: visiblePoints[visiblePoints.length - 1]?.label || 'N/A',
      count: visiblePoints.length,
    };
  }, [points]);

  return (
    <svg viewBox="0 0 640 260" className="h-72 w-full" role="img" aria-label="Wear trend preview">
      <path d="M0 258 L640 258" stroke="currentColor" className="text-border/70" strokeWidth="1" />
      <path d="M2 0 L2 260" stroke="currentColor" className="text-border/70" strokeWidth="1" />
      {chart ? (
        <>
          <line
            x1={chart.padding.left}
            y1={chart.baselineY}
            x2={640 - chart.padding.right}
            y2={chart.baselineY}
            stroke="#64748b"
            strokeDasharray="4 4"
            strokeWidth="1.5"
          />
          <polyline
            points={chart.polyline}
            fill="none"
            stroke="#2563eb"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          {chart.baselineMeanY != null && (
            <line
              x1={chart.padding.left}
              y1={chart.baselineMeanY}
              x2={640 - chart.padding.right}
              y2={chart.baselineMeanY}
              stroke="#1d4ed8"
              strokeDasharray="2 4"
              strokeWidth="1.5"
            />
          )}
          {chart.monitoringMeanY != null && (
            <line
              x1={chart.padding.left}
              y1={chart.monitoringMeanY}
              x2={640 - chart.padding.right}
              y2={chart.monitoringMeanY}
              stroke="#dc2626"
              strokeDasharray="6 4"
              strokeWidth="1.5"
            />
          )}
          <text x="8" y="16" fill="currentColor" className="text-xs text-muted-foreground">
            Intervals shown: {chart.count} · First: {chart.firstLabel} · Last: {chart.lastLabel}
          </text>
          <text x="8" y="34" fill="#64748b" className="text-xs">
            Baseline (G0) reference = 0.000
          </text>
          <text x="8" y="50" fill="#1d4ed8" className="text-xs">
            Selected baseline mean:{' '}
            {chart.baselineMean != null ? chart.baselineMean.toFixed(3) : 'N/A'}
          </text>
          <text x="8" y="66" fill="#dc2626" className="text-xs">
            Monitoring mean:{' '}
            {chart.monitoringMean != null ? chart.monitoringMean.toFixed(3) : 'N/A'}
          </text>
          <text x="520" y={chart.baselineY - 4} fill="#64748b" className="text-xs">
            G0=0
          </text>
          {chart.baselineMeanY != null && (
            <text x="520" y={chart.baselineMeanY - 4} fill="#1d4ed8" className="text-xs">
              Baseline mean
            </text>
          )}
          {chart.monitoringMeanY != null && (
            <text x="520" y={chart.monitoringMeanY - 4} fill="#dc2626" className="text-xs">
              Monitoring mean
            </text>
          )}
        </>
      ) : (
        <text x="8" y="24" fill="currentColor" className="text-xs text-muted-foreground">
          Wear trend preview will appear after deterioration intervals are available.
        </text>
      )}
    </svg>
  );
}

export default function DashboardPage() {
  const {
    datasetSourceGroups,
    selectedSourceKey,
    setSelectedSourceKey,
    selectedLiveDatasetId,
    streamingStatus,
    alerts,
    alertSummary,
    wearSnapshot,
    wearDirection,
    machineStatus,
    history,
    latestAnomalyPercentage,
    realtimeAnomaly,
    anomalySource,
    wearColumn,
    liveRefreshMs,
    appliedWearConfig,
    isLoading,
    isRefreshingWear,
    wearError,
    refetchAll,
  } = useDashboardOverview();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      await refetchAll();
    } finally {
      setIsRefreshing(false);
    }
  };

  const anomalySeries = history.map((point) => point.anomalyPercentage);
  const wearSeries = history.map((point) => point.wearScore);

  const streamStatusLabel =
    streamingStatus?.status === 'streaming'
      ? 'Active'
      : streamingStatus?.status === 'completed'
        ? 'Completed'
        : 'Not started';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Operations Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Live stream health, deterioration trend, and prioritized alerts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DatasetSourceSelect
            groups={datasetSourceGroups}
            selectedSourceKey={selectedSourceKey}
            onChange={setSelectedSourceKey}
            className="min-w-56 rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <Button variant="outline" onClick={() => void handleRefresh()} disabled={isRefreshing}>
            <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className={cn('border', stateTone[machineStatus.state])}>
          <CardHeader className="pb-2">
            <CardDescription>Machine state</CardDescription>
            <CardTitle className="text-2xl">{machineStatus.state}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="text-sm">{machineStatus.recommendation}</p>
            <p className="text-xs">
              Real-time anomaly rate:{' '}
              <span className="font-semibold">
                {latestAnomalyPercentage != null ? `${latestAnomalyPercentage.toFixed(1)}%` : 'N/A'}
              </span>
              {realtimeAnomaly?.totalPoints ? ` (${realtimeAnomaly.totalPoints} pts)` : ''}
            </p>
            <p className="text-xs">
              Source:{' '}
              {anomalySource === 'manual-boundary' ? 'Manual boundaries' : 'Model detection'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Live streaming</CardDescription>
            <CardTitle className="text-2xl">{streamStatusLabel}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>Dataset: {selectedLiveDatasetId ?? 'Not selected'}</p>
            <p>
              Points: {streamingStatus?.streamed_points ?? 0}/{streamingStatus?.total_points ?? 0}
            </p>
            <p>Progress: {(streamingStatus?.progress_percentage ?? 0).toFixed(1)}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Alert load</CardDescription>
            <CardTitle className="text-2xl">{alertSummary.activeTotal}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>Critical: {alertSummary.bySeverity.critical}</p>
            <p>High: {alertSummary.bySeverity.high}</p>
            <p>Medium: {alertSummary.bySeverity.medium}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Wear trend (G0→Gi)</CardDescription>
            <CardTitle className="flex items-center gap-2 text-2xl">
              {wearSnapshot ? wearSnapshot.score.toFixed(3) : 'N/A'}
              <Badge variant="outline">{wearDirection}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>Column: {wearSnapshot?.metadataColumn || wearColumn || 'Not configured'}</p>
            <p>
              Last run:{' '}
              {wearSnapshot?.capturedAt
                ? formatRelativeTime(wearSnapshot.capturedAt)
                : 'No run yet'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Waves className="h-5 w-5" />
              Live Condition Timeline
            </CardTitle>
            <CardDescription>Latest samples for anomaly rate and wear score.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">Anomaly rate (%)</span>
                <span className="text-muted-foreground">
                  {latestAnomalyPercentage != null ? latestAnomalyPercentage.toFixed(1) : 'N/A'}
                </span>
              </div>
              <Sparkline values={anomalySeries} stroke="#dc2626" />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">Wear trend score</span>
                <span className="text-muted-foreground">
                  {wearSnapshot ? wearSnapshot.score.toFixed(3) : 'N/A'}
                </span>
              </div>
              <Sparkline values={wearSeries} stroke="#7c3aed" />
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingDown className="h-5 w-5" />
              Wear Trend Preview (G0→Gi)
            </CardTitle>
            <CardDescription>
              Distance-from-baseline preview from deterioration intervals in real time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <WearPreview points={wearSnapshot?.previewSeries ?? []} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5" />
              Streaming Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Stream state: <span className="font-medium text-foreground">{streamStatusLabel}</span>
            </p>
            <p>
              Refresh cadence:{' '}
              <span className="font-medium text-foreground">
                {Math.round(liveRefreshMs / 1000)}s sync (matched to Live Monitor)
              </span>
            </p>
            <p>
              Latest glow points:{' '}
              <span className="font-medium text-foreground">
                {streamingStatus?.latest_glow_count ?? 0}
              </span>
            </p>
            <p>
              Stream completion:{' '}
              <span className="font-medium text-foreground">
                {(streamingStatus?.progress_percentage ?? 0).toFixed(1)}%
              </span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingDown className="h-5 w-5" />
              Wear Trend Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Column:{' '}
              <span className="font-medium text-foreground">
                {wearSnapshot?.metadataColumn || wearColumn || 'Not configured'}
              </span>
            </p>
            <p>
              Baseline mode:{' '}
              <span className="font-medium text-foreground">
                {appliedWearConfig?.baselineRange
                  ? `${appliedWearConfig.baselineRange.start} → ${appliedWearConfig.baselineRange.end}`
                  : appliedWearConfig?.baselineClusterValues?.length
                    ? `${appliedWearConfig.baselineClusterValues.length} selected cluster(s)`
                    : 'Not configured from Insights'}
              </span>
            </p>
            <p>
              Distance mean (G0→Gi):{' '}
              <span className="font-medium text-foreground">
                {wearSnapshot ? wearSnapshot.score.toFixed(3) : 'N/A'}
              </span>
            </p>
            <p>
              Transition mean (Gi→Gi+1):{' '}
              <span className="font-medium text-foreground">
                {wearSnapshot ? wearSnapshot.transitionMean.toFixed(3) : 'N/A'}
              </span>
            </p>
            {wearError && <p className="text-danger-text ">Wear trend error: {wearError}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Fast Actions</CardTitle>
          <CardDescription>Open the relevant workflow immediately.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/dashboard/live">
              <Activity className="mr-2 h-4 w-4" />
              Open Live Monitor
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/insights">
              <ShieldAlert className="mr-2 h-4 w-4" />
              Open Insights
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/data">
              <Upload className="mr-2 h-4 w-4" />
              Upload Data
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/insights">
              Run Wear Trend
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          {isRefreshingWear && (
            <div className="ml-auto flex items-center text-sm text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Refreshing wear trend...
            </div>
          )}
          {isLoading && !isRefreshingWear && (
            <div className="ml-auto flex items-center text-sm text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Loading overview...
            </div>
          )}
          {!isLoading && !isRefreshingWear && (
            <div className="ml-auto flex items-center text-sm text-muted-foreground">
              <CheckCircle2 className="mr-2 h-4 w-4 text-success-text" />
              Dashboard synced
            </div>
          )}
        </CardContent>
      </Card>

      {alerts.some((alert) => alert.severity === 'critical' && alert.status === 'active') && (
        <Card className="border-danger-border bg-danger-bg ">
          <CardContent className="flex items-start gap-3 py-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-danger-text" />
            <div>
              <p className="font-semibold text-danger-text">
                Critical alerts require immediate action.
              </p>
              <p className="text-sm text-danger-text">
                Open Live Monitor and Health Insights now to validate abnormal behavior and wear
                trend.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
