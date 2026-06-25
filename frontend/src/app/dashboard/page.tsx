'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  Eye,
  Gauge,
  History,
  ListChecks,
  Radio,
  RefreshCw,
  Server,
  Settings2,
  ShieldAlert,
  Upload,
  Waves,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DeploymentStatusCard } from '@/components/deployment/deployment-status-card';
import {
  type DashboardActivity,
  useDashboardWorkspace,
} from '@/context/dashboard-workspace-context';
import { useDashboardOverview } from '@/hooks/useDashboardOverview';
import { buildSparklinePath } from '@/lib/dashboard-overview';
import type { DinsightDatasetSummary } from '@/lib/dataset-normalizers';
import { cn } from '@/utils/cn';

type HealthState = 'OK' | 'Deteriorating' | 'Failing';
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const stateTone: Record<HealthState, string> = {
  OK: 'border-success-border bg-success-bg text-success-text',
  Deteriorating: 'border-warning-border bg-warning-bg text-warning-text',
  Failing: 'border-danger-border bg-danger-bg text-danger-text',
};

const stateBadgeVariant: Record<HealthState, 'success' | 'warning' | 'danger'> = {
  OK: 'success',
  Deteriorating: 'warning',
  Failing: 'danger',
};

const toneClasses: Record<Tone, string> = {
  success: 'border-success-border bg-success-bg text-success-text',
  warning: 'border-warning-border bg-warning-bg text-warning-text',
  danger: 'border-danger-border bg-danger-bg text-danger-text',
  info: 'border-info-border bg-info-bg text-info-text',
  neutral: 'border-border bg-surface-muted text-fg',
};

const toneBadge: Record<Tone, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  neutral: 'neutral',
};

const formatNumber = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : 'N/A';

const formatPercent = (value: number | null | undefined, digits = 1) =>
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}%` : 'N/A';

const formatRelativeTime = (value: string | number | Date | null | undefined) => {
  if (value == null) return 'No recent signal';
  const timestamp =
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Unknown time';

  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diff < minute) return 'Just now';
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return `${Math.floor(diff / day)}d ago`;
};

const formatSourceKind = (dataset: DinsightDatasetSummary | null | undefined) => {
  if (!dataset) return 'No source';
  if (dataset.source.source === 'auto') return 'IoT Hub stream';
  if (dataset.source.source === 'manual') return 'Manual upload';
  return 'Unknown source';
};

const getDatasetLabel = (dataset: DinsightDatasetSummary | null | undefined) => {
  if (!dataset) return 'No processed data selected';
  return (
    dataset.source.originalFileName ??
    dataset.source.deviceName ??
    dataset.source.deviceSlug ??
    dataset.source.iotHubDeviceId ??
    `Dataset #${dataset.dinsight_id}`
  );
};

function Sparkline({ values, stroke }: { values: Array<number | null>; stroke: string }) {
  const path = useMemo(() => buildSparklinePath(values, 320, 64), [values]);

  return (
    <svg viewBox="0 0 320 64" className="h-16 w-full" role="img" aria-label="Trend sparkline">
      <path d="M0 63 L320 63" stroke="currentColor" className="text-border/70" strokeWidth="1" />
      {path ? (
        <path d={path} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
      ) : (
        <text x="8" y="36" fill="currentColor" className="text-muted-foreground text-xs">
          Waiting for samples
        </text>
      )}
    </svg>
  );
}

function SectionTitle({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <CardHeader className="p-4 pb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base tracking-normal">
            <span className="text-fg-muted">{icon}</span>
            {title}
          </CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
      </div>
    </CardHeader>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  tone = 'neutral',
  className,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  tone?: Tone;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn('min-h-[88px] rounded-md border px-3 py-2', toneClasses[tone], className)}>
      <div className="text-xs font-medium uppercase">{label}</div>
      <div className={cn('mt-1 break-words text-lg font-semibold leading-snug', valueClassName)}>
        {value}
      </div>
      <div className="mt-1 break-words text-xs leading-snug opacity-80">{detail}</div>
    </div>
  );
}

function ActionQueue({
  actions,
}: {
  actions: Array<{
    title: string;
    detail: string;
    href: string;
    label: string;
    tone: Tone;
    icon: ReactNode;
  }>;
}) {
  return (
    <Card className="self-start">
      <SectionTitle
        icon={<ListChecks className="h-5 w-5" />}
        title="Action queue"
        description="Highest-value next steps for the selected dataset."
      />
      <CardContent className="space-y-3 p-4 pt-0">
        {actions.map((action) => (
          <div key={action.title} className={cn('rounded-md border p-3', toneClasses[action.tone])}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">{action.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{action.title}</div>
                <div className="mt-1 text-sm opacity-85">{action.detail}</div>
              </div>
            </div>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="mt-3 bg-white/35 dark:bg-black/10"
            >
              <Link href={action.href}>
                {action.label}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ReadinessRow({
  label,
  value,
  tone,
  href,
}: {
  label: string;
  value: string;
  tone: Tone;
  href?: string;
}) {
  const content = (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:bg-surface-hover">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-fg">{label}</div>
        <div className="truncate text-xs text-fg-muted">{value}</div>
      </div>
      <Badge variant={toneBadge[tone]}>{tone === 'success' ? 'Ready' : tone}</Badge>
    </div>
  );

  if (!href) return content;
  return (
    <Link
      href={href}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      {content}
    </Link>
  );
}

function PriorityQueue({
  items,
}: {
  items: Array<{
    id: number;
    label: string;
    source: string;
    records: number | null;
    score: number;
    tone: Tone;
    status: string;
    isActive: boolean;
  }>;
}) {
  return (
    <Card className="h-full">
      <SectionTitle
        icon={<Gauge className="h-5 w-5" />}
        title="Asset priority"
        description="Datasets ranked by operational attention."
      />
      <CardContent className="space-y-2 p-4 pt-0">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
            No processed datasets yet.
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className={cn(
                'rounded-md border bg-surface px-3 py-3',
                item.isActive ? 'border-accent/60 shadow-sm' : 'border-border'
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-fg">Dataset #{item.id}</span>
                    {item.isActive && <Badge variant="accent">Selected</Badge>}
                    <Badge variant={toneBadge[item.tone]}>{item.status}</Badge>
                  </div>
                  <div className="mt-1 truncate text-sm text-fg-muted">{item.label}</div>
                  <div className="mt-1 text-xs text-fg-muted">
                    {item.source} · {formatNumber(item.records)} points
                  </div>
                </div>
                <div className="min-w-[112px] text-right">
                  <div className="text-xs font-medium uppercase text-fg-muted">Priority</div>
                  <div className="mt-1 text-lg font-semibold text-fg">{item.score}</div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        item.tone === 'danger'
                          ? 'bg-danger'
                          : item.tone === 'warning'
                            ? 'bg-warning'
                            : item.tone === 'success'
                              ? 'bg-success'
                              : 'bg-accent'
                      )}
                      style={{ width: `${Math.max(6, Math.min(item.score, 100))}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
        {items.length > 0 && (
          <Button asChild variant="outline" className="mt-2 w-full">
            <Link href="/dashboard/data?catalog=open">
              <Database className="mr-2 h-4 w-4" />
              Open catalog
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ activity }: { activity: DashboardActivity }) {
  const tone: Tone =
    activity.status === 'danger'
      ? 'danger'
      : activity.status === 'warning'
        ? 'warning'
        : activity.status === 'success'
          ? 'success'
          : 'neutral';
  const row = (
    <div className="flex min-w-0 items-start gap-3 rounded-md border border-border bg-surface px-3 py-2">
      <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full border', toneClasses[tone])} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{activity.title}</div>
        {activity.description && (
          <div className="mt-0.5 truncate text-xs text-fg-muted">{activity.description}</div>
        )}
        <div className="mt-1 text-xs text-fg-muted">
          {formatRelativeTime(activity.timestamp)}
          {activity.datasetId ? ` · Dataset #${activity.datasetId}` : ''}
        </div>
      </div>
    </div>
  );

  if (!activity.href) return row;
  return (
    <Link
      href={activity.href}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      {row}
    </Link>
  );
}

export default function DashboardPage() {
  const { activities, setMachineHealthSnapshot } = useDashboardWorkspace();
  const {
    datasets,
    latestDatasetId,
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

  const machineReasons = useMemo(
    () =>
      machineStatus.reasons && machineStatus.reasons.length > 0
        ? machineStatus.reasons
        : [machineStatus.recommendation],
    [machineStatus.reasons, machineStatus.recommendation]
  );

  useEffect(() => {
    setMachineHealthSnapshot({
      state: machineStatus.state,
      recommendation: machineStatus.recommendation,
      reasons: machineReasons,
      updatedAt: new Date().toISOString(),
    });
  }, [machineReasons, machineStatus.recommendation, machineStatus.state, setMachineHealthSnapshot]);

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      await refetchAll();
    } finally {
      setIsRefreshing(false);
    }
  };

  const selectedDataset =
    datasets.find((dataset) => dataset.dinsight_id === selectedLiveDatasetId) ?? null;
  const hasDatasets = datasets.length > 0;
  const hasSelectedDataset = Boolean(selectedLiveDatasetId);
  const hasWearConfig = Boolean(
    appliedWearConfig?.metadataColumn &&
    ((appliedWearConfig.baselineClusterValues?.length ?? 0) > 0 ||
      (appliedWearConfig.baselineRange?.start && appliedWearConfig.baselineRange?.end))
  );
  const hasStreamingData = (streamingStatus?.streamed_points ?? 0) > 0;
  const hasCriticalAlerts = alerts.some(
    (alert) => alert.severity === 'critical' && alert.status === 'active'
  );
  const lastTimelinePoint = history[history.length - 1]?.timestamp ?? null;
  const streamStatusLabel =
    streamingStatus?.status === 'streaming'
      ? 'Streaming'
      : streamingStatus?.status === 'completed'
        ? 'Completed'
        : 'Not started';
  const sourceLabel = getDatasetLabel(selectedDataset);
  const sourceKindLabel = formatSourceKind(selectedDataset);
  const anomalySeries = history.map((point) => point.anomalyPercentage);
  const wearSeries = history.map((point) => point.wearScore);
  const readinessItems = useMemo(
    () => [
      {
        label: 'Dataset selected',
        value: selectedLiveDatasetId
          ? `Dataset #${selectedLiveDatasetId}`
          : 'Use the header picker',
        tone: selectedLiveDatasetId ? ('success' as Tone) : ('danger' as Tone),
        href: '/dashboard/data?catalog=open',
      },
      {
        label: 'Source attribution',
        value: selectedDataset ? sourceKindLabel : 'No source selected',
        tone:
          selectedDataset && selectedDataset.source.source !== 'unknown'
            ? ('success' as Tone)
            : ('warning' as Tone),
        href: '/dashboard/data?catalog=open',
      },
      {
        label: 'Live stream',
        value: `${streamStatusLabel} · ${formatNumber(streamingStatus?.streamed_points)} points`,
        tone: hasStreamingData ? ('success' as Tone) : ('warning' as Tone),
        href: '/dashboard/live',
      },
      {
        label: 'Anomaly signal',
        value:
          realtimeAnomaly && realtimeAnomaly.totalPoints > 0
            ? `${formatPercent(realtimeAnomaly.anomalyPercentage)} from ${formatNumber(realtimeAnomaly.totalPoints)} points`
            : 'Waiting for live/model signal',
        tone:
          realtimeAnomaly && realtimeAnomaly.totalPoints > 0
            ? ('success' as Tone)
            : ('warning' as Tone),
        href: '/dashboard/live',
      },
      {
        label: 'Wear baseline',
        value: hasWearConfig
          ? appliedWearConfig?.baselineRange
            ? `${appliedWearConfig.baselineRange.start} → ${appliedWearConfig.baselineRange.end}`
            : `${appliedWearConfig?.baselineClusterValues?.length ?? 0} selected interval(s)`
          : 'Configure in Health Insights',
        tone: hasWearConfig ? ('success' as Tone) : ('warning' as Tone),
        href: '/dashboard/insights',
      },
      {
        label: 'Wear result',
        value: wearSnapshot
          ? `${wearSnapshot.score.toFixed(3)} · ${wearDirection}`
          : wearError
            ? 'Calculation failed'
            : 'No deterioration result',
        tone: wearError
          ? ('danger' as Tone)
          : wearSnapshot
            ? ('success' as Tone)
            : ('warning' as Tone),
        href: '/dashboard/insights',
      },
    ],
    [
      appliedWearConfig?.baselineClusterValues?.length,
      appliedWearConfig?.baselineRange,
      hasStreamingData,
      hasWearConfig,
      realtimeAnomaly,
      selectedDataset,
      selectedLiveDatasetId,
      sourceKindLabel,
      streamStatusLabel,
      streamingStatus?.streamed_points,
      wearDirection,
      wearError,
      wearSnapshot,
    ]
  );
  const readinessScore = Math.round(
    (readinessItems.filter((item) => item.tone === 'success').length / readinessItems.length) * 100
  );

  const priorityItems = useMemo(() => {
    const stateScore: Record<HealthState, number> = {
      OK: 24,
      Deteriorating: 68,
      Failing: 94,
    };
    return datasets
      .map((dataset) => {
        const isActive = dataset.dinsight_id === selectedLiveDatasetId;
        const unknownSource = dataset.source.source === 'unknown';
        const currentScore = isActive
          ? stateScore[machineStatus.state] +
            (hasCriticalAlerts ? 6 : 0) +
            (latestAnomalyPercentage != null && latestAnomalyPercentage > 10 ? 6 : 0)
          : dataset.dinsight_id === latestDatasetId
            ? 30
            : 16;
        const score = Math.max(
          0,
          Math.min(100, Math.round(currentScore + (unknownSource ? 8 : 0)))
        );
        const tone: Tone = isActive
          ? machineStatus.state === 'Failing'
            ? 'danger'
            : machineStatus.state === 'Deteriorating'
              ? 'warning'
              : 'success'
          : unknownSource
            ? 'warning'
            : 'neutral';
        const status = isActive ? machineStatus.state : unknownSource ? 'Needs source' : 'Standby';

        return {
          id: dataset.dinsight_id,
          label: getDatasetLabel(dataset),
          source: formatSourceKind(dataset),
          records: dataset.records ?? null,
          score,
          tone,
          status,
          isActive,
        };
      })
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.score - a.score || b.id - a.id)
      .slice(0, 7);
  }, [
    datasets,
    hasCriticalAlerts,
    latestAnomalyPercentage,
    latestDatasetId,
    machineStatus.state,
    selectedLiveDatasetId,
  ]);

  const actions = useMemo(() => {
    const nextActions: Array<{
      title: string;
      detail: string;
      href: string;
      label: string;
      tone: Tone;
      icon: ReactNode;
    }> = [];

    if (!hasDatasets) {
      nextActions.push({
        title: 'Create the first processed dataset',
        detail: 'Upload split files or a combined CSV before live monitoring or insights can run.',
        href: '/dashboard/data',
        label: 'Open data',
        tone: 'info',
        icon: <Upload className="h-5 w-5" />,
      });
    }

    if (hasDatasets && !hasSelectedDataset) {
      nextActions.push({
        title: 'Choose an active dataset',
        detail: 'Use the header dataset picker so every workspace page follows the same ID.',
        href: '/dashboard/data?catalog=open',
        label: 'Review catalog',
        tone: 'warning',
        icon: <Database className="h-5 w-5" />,
      });
    }

    if (hasCriticalAlerts || machineStatus.state === 'Failing') {
      nextActions.push({
        title: 'Investigate abnormal behavior',
        detail: 'Open the live monitor and validate recent red points, boundaries, and metadata.',
        href: '/dashboard/live',
        label: 'Open live',
        tone: 'danger',
        icon: <ShieldAlert className="h-5 w-5" />,
      });
    }

    if (hasDatasets && !hasWearConfig) {
      nextActions.push({
        title: 'Set the healthy baseline',
        detail: 'Configure the timestamp/interval baseline so deterioration scores are meaningful.',
        href: '/dashboard/insights',
        label: 'Configure',
        tone: 'warning',
        icon: <Settings2 className="h-5 w-5" />,
      });
    }

    if (hasDatasets && hasWearConfig && !wearSnapshot) {
      nextActions.push({
        title: 'Run deterioration analysis',
        detail: 'Generate distance-from-baseline results for the selected dataset.',
        href: '/dashboard/insights',
        label: 'Run insights',
        tone: wearError ? 'danger' : 'info',
        icon: <Gauge className="h-5 w-5" />,
      });
    }

    if (hasDatasets && !hasStreamingData) {
      nextActions.push({
        title: 'Start live verification',
        detail: 'Stream monitoring points to confirm current machine movement.',
        href: '/dashboard/live',
        label: 'Open live',
        tone: 'info',
        icon: <Radio className="h-5 w-5" />,
      });
    }

    if (nextActions.length === 0) {
      nextActions.push({
        title: 'Review the current result',
        detail: 'Compare live movement and deterioration trend before the next operating decision.',
        href: '/dashboard/insights',
        label: 'Open insights',
        tone: machineStatus.state === 'OK' ? 'success' : 'warning',
        icon: <Eye className="h-5 w-5" />,
      });
      nextActions.push({
        title: 'Audit dataset outputs',
        detail: 'Export or delete generated files from the catalog when a run is complete.',
        href: '/dashboard/data?catalog=open',
        label: 'Open catalog',
        tone: 'neutral',
        icon: <Database className="h-5 w-5" />,
      });
    }

    const hasCatalogAction = nextActions.some((action) => action.href.includes('/dashboard/data'));
    const hasInsightsAction = nextActions.some((action) =>
      action.href.includes('/dashboard/insights')
    );

    if (hasDatasets && nextActions.length < 3 && !hasInsightsAction) {
      nextActions.push({
        title: 'Review deterioration trend',
        detail: 'Check baseline-relative movement, thresholds, and interval transitions.',
        href: '/dashboard/insights',
        label: 'Open insights',
        tone: machineStatus.state === 'OK' ? 'info' : 'warning',
        icon: <Gauge className="h-5 w-5" />,
      });
    }

    if (hasDatasets && nextActions.length < 3 && !hasCatalogAction) {
      nextActions.push({
        title: 'Audit generated outputs',
        detail: 'Open the catalog to export, inspect, or delete files tied to this dataset ID.',
        href: '/dashboard/data?catalog=open',
        label: 'Open catalog',
        tone: 'neutral',
        icon: <Database className="h-5 w-5" />,
      });
    }

    return nextActions.slice(0, 4);
  }, [
    hasCriticalAlerts,
    hasDatasets,
    hasSelectedDataset,
    hasStreamingData,
    hasWearConfig,
    machineStatus.state,
    wearError,
    wearSnapshot,
  ]);

  const recentOperations = useMemo<DashboardActivity[]>(() => {
    if (activities.length > 0) return activities.slice(0, 6);
    const fallback: DashboardActivity[] = [];
    if (selectedLiveDatasetId) {
      fallback.push({
        id: 'selected-dataset',
        type: 'dataset',
        title: `Dataset #${selectedLiveDatasetId} selected`,
        description: sourceLabel,
        datasetId: selectedLiveDatasetId,
        timestamp: new Date().toISOString(),
        href: '/dashboard/data?catalog=open',
        status: 'info',
      });
    }
    if (lastTimelinePoint != null) {
      fallback.push({
        id: 'live-sync',
        type: 'streaming',
        title: 'Live signal updated',
        description: `${streamStatusLabel} · ${formatNumber(streamingStatus?.streamed_points)} streamed points`,
        datasetId: selectedLiveDatasetId ?? undefined,
        timestamp: new Date(lastTimelinePoint).toISOString(),
        href: '/dashboard/live',
        status: 'success',
      });
    }
    return fallback;
  }, [
    activities,
    lastTimelinePoint,
    selectedLiveDatasetId,
    sourceLabel,
    streamStatusLabel,
    streamingStatus?.streamed_points,
  ]);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)]">
        <div className="space-y-5">
          <Card className={cn('border', stateTone[machineStatus.state])}>
            <CardContent className="space-y-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase">
                    <Activity className="h-4 w-4" />
                    Operations command center
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-semibold tracking-normal">
                      {machineStatus.state}
                    </h1>
                    <Badge variant={stateBadgeVariant[machineStatus.state]}>
                      Dataset #{selectedLiveDatasetId ?? latestDatasetId ?? 'N/A'}
                    </Badge>
                  </div>
                  <p className="mt-2 max-w-3xl text-sm opacity-90">
                    {machineStatus.recommendation}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing}
                >
                  <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
                  Refresh
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-[minmax(250px,1.55fr)_repeat(3,minmax(130px,1fr))]">
                <SummaryMetric
                  label="Source"
                  value={sourceLabel}
                  detail={sourceKindLabel}
                  valueClassName="line-clamp-2 text-base"
                />
                <SummaryMetric
                  label="Stream"
                  value={streamStatusLabel}
                  detail={`${formatNumber(streamingStatus?.streamed_points)}/${formatNumber(streamingStatus?.total_points)} points`}
                  tone={hasStreamingData ? 'success' : 'warning'}
                />
                <SummaryMetric
                  label="Anomaly"
                  value={formatPercent(latestAnomalyPercentage)}
                  detail={anomalySource === 'manual-boundary' ? 'Manual boundary' : 'Model signal'}
                  tone={
                    latestAnomalyPercentage == null
                      ? 'neutral'
                      : latestAnomalyPercentage > 10
                        ? 'danger'
                        : latestAnomalyPercentage > 3
                          ? 'warning'
                          : 'success'
                  }
                />
                <SummaryMetric
                  label="Readiness"
                  value={`${readinessScore}%`}
                  detail={`${readinessItems.filter((item) => item.tone === 'success').length}/${readinessItems.length} checks ready`}
                  tone={
                    readinessScore >= 80 ? 'success' : readinessScore >= 50 ? 'warning' : 'danger'
                  }
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="rounded-md border border-current/20 bg-white/30 p-3 text-sm dark:bg-black/10">
                  <div className="text-xs font-semibold uppercase">State drivers</div>
                  <div className="mt-2 grid gap-2">
                    {machineReasons.map((reason) => (
                      <div key={reason} className="rounded-md border border-current/15 px-3 py-2">
                        {reason}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-current/20 bg-white/30 p-3 text-sm dark:bg-black/10">
                  <div className="text-xs font-semibold uppercase">Last signal</div>
                  <div className="mt-2 text-lg font-semibold">
                    {lastTimelinePoint != null
                      ? formatRelativeTime(new Date(lastTimelinePoint))
                      : 'No live sync'}
                  </div>
                  <div className="mt-1 text-xs opacity-80">
                    Dashboard cadence: {Math.round(liveRefreshMs / 1000)}s
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <PriorityQueue items={priorityItems} />

          <Card>
            <SectionTitle
              icon={<Waves className="h-5 w-5" />}
              title="Live signal"
              description="Compact trend preview for the selected dataset."
            />
            <CardContent className="grid gap-4 p-4 pt-0 lg:grid-cols-2">
              <div className="rounded-md border border-border bg-surface px-3 py-3">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium uppercase text-fg-muted">Anomaly rate</span>
                  <span className="font-semibold text-fg">
                    {formatPercent(latestAnomalyPercentage)}
                  </span>
                </div>
                <Sparkline values={anomalySeries} stroke="#dc2626" />
                <div className="mt-2 text-xs text-fg-muted">
                  {realtimeAnomaly
                    ? `${formatNumber(realtimeAnomaly.anomalyCount)} abnormal of ${formatNumber(realtimeAnomaly.totalPoints)} points`
                    : 'No anomaly sample available'}
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface px-3 py-3">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium uppercase text-fg-muted">Wear score</span>
                  <span className="font-semibold text-fg">
                    {wearSnapshot ? wearSnapshot.score.toFixed(3) : 'N/A'}
                  </span>
                </div>
                <Sparkline values={wearSeries} stroke="#7c3aed" />
                <div className="mt-2 text-xs text-fg-muted">
                  {wearSnapshot
                    ? `${wearSnapshot.metadataColumn || wearColumn || 'metadata'} · ${wearDirection}`
                    : wearError || 'No wear score available'}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <SectionTitle
              icon={<Radio className="h-5 w-5" />}
              title="Streaming detail"
              description="Simulator flags currently reported by the API."
            />
            <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryMetric
                label="Progress"
                value={formatPercent(streamingStatus?.progress_percentage)}
                detail={`${formatNumber(streamingStatus?.streamed_points)} streamed points`}
                tone={hasStreamingData ? 'success' : 'neutral'}
              />
              <SummaryMetric
                label="Batch size"
                value={formatNumber(streamingStatus?.batch_size)}
                detail={`Delay ${streamingStatus ? `${streamingStatus.delay_seconds}s` : 'N/A'}`}
              />
              <SummaryMetric
                label="Glow points"
                value={formatNumber(streamingStatus?.latest_glow_count)}
                detail="Latest highlighted stream points"
                tone="info"
              />
              <SummaryMetric
                label="Trail points"
                value={formatNumber(streamingStatus?.trail_points)}
                detail="Recent trajectory history"
                tone="info"
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <ActionQueue actions={actions} />

          <Card>
            <SectionTitle
              icon={<CheckCircle2 className="h-5 w-5" />}
              title="Readiness"
              description="The checks that make live decisions defensible."
            />
            <CardContent className="space-y-2 p-4 pt-0">
              {readinessItems.map((item) => (
                <ReadinessRow
                  key={item.label}
                  label={item.label}
                  value={item.value}
                  tone={item.tone}
                  href={item.href}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <SectionTitle
              icon={<History className="h-5 w-5" />}
              title="Recent operations"
              description="Workspace events from uploads, streams, and analyses."
            />
            <CardContent className="space-y-2 p-4 pt-0">
              {recentOperations.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
                  No recent workspace activity.
                </div>
              ) : (
                recentOperations.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))
              )}
            </CardContent>
          </Card>

          <DeploymentStatusCard compact />
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-4">
          <Button asChild>
            <Link href="/dashboard/live">
              <Eye className="mr-2 h-4 w-4" />
              Live Monitor
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/insights">
              <ShieldAlert className="mr-2 h-4 w-4" />
              Health Insights
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/data">
              <Upload className="mr-2 h-4 w-4" />
              Data Ingestion
            </Link>
          </Button>
          <div className="ml-auto flex items-center text-sm text-fg-muted">
            {isRefreshingWear || isLoading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                Updating dashboard
              </>
            ) : lastTimelinePoint != null ? (
              <>
                <Clock className="mr-2 h-4 w-4 text-success-text" />
                Synced {formatRelativeTime(new Date(lastTimelinePoint))}
              </>
            ) : (
              <>
                <Server className="mr-2 h-4 w-4 text-info-text" />
                Awaiting live signal
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {hasCriticalAlerts && (
        <Card className="border-danger-border bg-danger-bg text-danger-text">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5" />
            <div>
              <p className="font-semibold">Critical alerts require immediate action.</p>
              <p className="text-sm opacity-85">
                Validate the latest monitoring points in Live Monitor and review deterioration in
                Health Insights.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
