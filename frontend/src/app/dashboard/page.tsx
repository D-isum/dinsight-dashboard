'use client';

import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Database,
  Eye,
  Gauge,
  History,
  ListChecks,
  Radio,
  RefreshCw,
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
import { useI18n } from '@/i18n/client';
import { buildSparklinePath } from '@/lib/dashboard-overview';
import type { DinsightDatasetSummary } from '@/lib/dataset-normalizers';
import { cn } from '@/utils/cn';

type HealthState = 'OK' | 'Deteriorating' | 'Failing';
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type Primitive = string | number | boolean | null | undefined;
type Translate = (key: string, values?: Record<string, Primitive>) => string;

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

const formatRelativeTime = (value: string | number | Date | null | undefined, t: Translate) => {
  if (value == null) return t('health.noRecentSignal');
  const timestamp =
    value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return t('health.unknownTime');

  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (diff < minute) return t('health.justNow');
  if (diff < hour) return t('health.minutesAgo', { count: Math.floor(diff / minute) });
  if (diff < day) return t('health.hoursAgo', { count: Math.floor(diff / hour) });
  return t('health.daysAgo', { count: Math.floor(diff / day) });
};

const formatSourceKind = (dataset: DinsightDatasetSummary | null | undefined, t: Translate) => {
  if (!dataset) return t('dashboard.noSource');
  if (dataset.source.source === 'auto') return t('dashboard.iotHubStream');
  if (dataset.source.source === 'manual') return t('dashboard.manualUpload');
  return t('dashboard.unknownSource');
};

const getDatasetLabel = (dataset: DinsightDatasetSummary | null | undefined, t: Translate) => {
  if (!dataset) return t('dashboard.noProcessedDataSelected');
  return (
    dataset.source.originalFileName ??
    dataset.source.deviceName ??
    dataset.source.deviceSlug ??
    dataset.source.iotHubDeviceId ??
    t('dashboard.selectedDataset', { id: dataset.dinsight_id })
  );
};

function Sparkline({
  values,
  stroke,
  ariaLabel,
  emptyLabel,
}: {
  values: Array<number | null>;
  stroke: string;
  ariaLabel: string;
  emptyLabel: string;
}) {
  const path = useMemo(() => buildSparklinePath(values, 320, 64), [values]);

  return (
    <svg viewBox="0 0 320 64" className="h-16 w-full" role="img" aria-label={ariaLabel}>
      <path d="M0 63 L320 63" stroke="currentColor" className="text-border/70" strokeWidth="1" />
      {path ? (
        <path d={path} fill="none" stroke={stroke} strokeWidth="2.4" strokeLinecap="round" />
      ) : (
        <text x="8" y="36" fill="currentColor" className="text-muted-foreground text-xs">
          {emptyLabel}
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
  const { t } = useI18n();

  return (
    <Card className="self-start">
      <SectionTitle
        icon={<ListChecks className="h-5 w-5" />}
        title={t('dashboard.nextSteps')}
        description={t('dashboard.nextStepsDescription')}
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
  const { t } = useI18n();
  const badgeLabel =
    tone === 'success'
      ? t('common.ready')
      : tone === 'warning'
        ? t('common.warning')
        : tone === 'danger'
          ? t('common.danger')
          : tone;
  const content = (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 transition-colors hover:bg-surface-hover">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-fg">{label}</div>
        <div className="truncate text-xs text-fg-muted">{value}</div>
      </div>
      <Badge variant={toneBadge[tone]}>{badgeLabel}</Badge>
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
  const { t, formatNumber } = useI18n();
  const formatNumberValue = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value)
      ? formatNumber(value)
      : t('common.notAvailable');

  return (
    <Card>
      <SectionTitle
        icon={<Gauge className="h-5 w-5" />}
        title={t('dashboard.datasetQueue')}
        description={t('dashboard.datasetQueueDescription')}
      />
      <CardContent className="space-y-2 p-4 pt-0">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
            {t('dashboard.noProcessedDatasets')}
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
                    <span className="font-semibold text-fg">
                      {t('dashboard.selectedDataset', { id: item.id })}
                    </span>
                    {item.isActive && <Badge variant="accent">{t('common.selected')}</Badge>}
                    <Badge variant={toneBadge[item.tone]}>{item.status}</Badge>
                  </div>
                  <div className="mt-1 truncate text-sm text-fg-muted">{item.label}</div>
                  <div className="mt-1 text-xs text-fg-muted">
                    {t('dashboard.pointsDetail', {
                      source: item.source,
                      points: formatNumberValue(item.records),
                    })}
                  </div>
                </div>
                <div className="min-w-[112px] text-right">
                  <div className="text-xs font-medium uppercase text-fg-muted">
                    {t('dashboard.priority')}
                  </div>
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
              {t('dashboard.openCatalog')}
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ activity }: { activity: DashboardActivity }) {
  const { t } = useI18n();
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
          {formatRelativeTime(activity.timestamp, t)}
          {activity.datasetId
            ? ` · ${t('dashboard.selectedDataset', { id: activity.datasetId })}`
            : ''}
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
    wearError,
    refetchAll,
  } = useDashboardOverview();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { t, formatNumber } = useI18n();
  const formatNumberValue = useCallback(
    (value: number | null | undefined) =>
      typeof value === 'number' && Number.isFinite(value)
        ? formatNumber(value)
        : t('common.notAvailable'),
    [formatNumber, t]
  );
  const formatPercentValue = useCallback(
    (value: number | null | undefined, digits = 1) =>
      typeof value === 'number' && Number.isFinite(value)
        ? `${value.toFixed(digits)}%`
        : t('common.notAvailable'),
    [t]
  );
  const formatHealthState = useCallback(
    (state: HealthState) =>
      state === 'OK'
        ? t('health.ok')
        : state === 'Deteriorating'
          ? t('health.deteriorating')
          : t('health.failing'),
    [t]
  );
  const formatWearDirection = useCallback(
    (direction: string) =>
      direction === 'up'
        ? t('health.up')
        : direction === 'down'
          ? t('health.down')
          : t('health.stable'),
    [t]
  );

  const machineRecommendation = useMemo(
    () => t(machineStatus.recommendationKey),
    [machineStatus.recommendationKey, t]
  );
  const machineReasons = useMemo(
    () =>
      machineStatus.reasonsI18n && machineStatus.reasonsI18n.length > 0
        ? machineStatus.reasonsI18n.map((reason) => t(reason.key, reason.values))
        : [machineRecommendation],
    [machineRecommendation, machineStatus.reasonsI18n, t]
  );

  useEffect(() => {
    setMachineHealthSnapshot({
      state: machineStatus.state,
      recommendation: machineRecommendation,
      reasons: machineReasons,
      updatedAt: new Date().toISOString(),
    });
  }, [machineReasons, machineRecommendation, machineStatus.state, setMachineHealthSnapshot]);

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
      ? t('dashboard.streaming')
      : streamingStatus?.status === 'completed'
        ? t('common.completed')
        : t('dashboard.notStarted');
  const sourceLabel = getDatasetLabel(selectedDataset, t);
  const sourceKindLabel = formatSourceKind(selectedDataset, t);
  const anomalySeries = history.map((point) => point.anomalyPercentage);
  const wearSeries = history.map((point) => point.wearScore);
  const readinessItems = useMemo(
    () => [
      {
        label: t('dashboard.datasetSelected'),
        value: selectedLiveDatasetId
          ? t('dashboard.selectedDataset', { id: selectedLiveDatasetId })
          : t('dashboard.useHeaderPicker'),
        tone: selectedLiveDatasetId ? ('success' as Tone) : ('danger' as Tone),
        href: '/dashboard/data?catalog=open',
      },
      {
        label: t('dashboard.sourceAttribution'),
        value: selectedDataset ? sourceKindLabel : t('dashboard.noSourceSelected'),
        tone:
          selectedDataset && selectedDataset.source.source !== 'unknown'
            ? ('success' as Tone)
            : ('warning' as Tone),
        href: '/dashboard/data?catalog=open',
      },
      {
        label: t('dashboard.liveStream'),
        value: t('dashboard.streamedStatus', {
          status: streamStatusLabel,
          points: formatNumberValue(streamingStatus?.streamed_points),
        }),
        tone: hasStreamingData ? ('success' as Tone) : ('warning' as Tone),
        href: '/dashboard/live',
      },
      {
        label: t('dashboard.anomalySignal'),
        value:
          realtimeAnomaly && realtimeAnomaly.totalPoints > 0
            ? `${formatPercentValue(realtimeAnomaly.anomalyPercentage)} / ${formatNumberValue(realtimeAnomaly.totalPoints)} ${t('common.points')}`
            : t('dashboard.waitingForSignal'),
        tone:
          realtimeAnomaly && realtimeAnomaly.totalPoints > 0
            ? ('success' as Tone)
            : ('warning' as Tone),
        href: '/dashboard/live',
      },
      {
        label: t('dashboard.wearBaseline'),
        value: hasWearConfig
          ? appliedWearConfig?.baselineRange
            ? `${appliedWearConfig.baselineRange.start} → ${appliedWearConfig.baselineRange.end}`
            : t('dashboard.selectedIntervals', {
                count: appliedWearConfig?.baselineClusterValues?.length ?? 0,
              })
          : t('dashboard.configureInInsights'),
        tone: hasWearConfig ? ('success' as Tone) : ('warning' as Tone),
        href: '/dashboard/insights',
      },
      {
        label: t('dashboard.wearResult'),
        value: wearSnapshot
          ? `${wearSnapshot.score.toFixed(3)} · ${formatWearDirection(wearDirection)}`
          : wearError
            ? t('dashboard.calculationFailed')
            : t('dashboard.noDeteriorationResult'),
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
      formatNumberValue,
      formatPercentValue,
      formatWearDirection,
      hasStreamingData,
      hasWearConfig,
      realtimeAnomaly,
      selectedDataset,
      selectedLiveDatasetId,
      sourceKindLabel,
      streamStatusLabel,
      streamingStatus?.streamed_points,
      t,
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
        const status = isActive
          ? formatHealthState(machineStatus.state)
          : unknownSource
            ? t('dashboard.needsSource')
            : t('dashboard.standby');

        return {
          id: dataset.dinsight_id,
          label: getDatasetLabel(dataset, t),
          source: formatSourceKind(dataset, t),
          records: dataset.records ?? null,
          score,
          tone,
          status,
          isActive,
        };
      })
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.score - a.score || b.id - a.id)
      .slice(0, 4);
  }, [
    datasets,
    formatHealthState,
    hasCriticalAlerts,
    latestAnomalyPercentage,
    latestDatasetId,
    machineStatus.state,
    selectedLiveDatasetId,
    t,
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
        title: t('dashboard.createFirstDataset'),
        detail: t('dashboard.createFirstDatasetDetail'),
        href: '/dashboard/data',
        label: t('dashboard.openData'),
        tone: 'info',
        icon: <Upload className="h-5 w-5" />,
      });
    }

    if (hasDatasets && !hasSelectedDataset) {
      nextActions.push({
        title: t('dashboard.chooseActiveDataset'),
        detail: t('dashboard.chooseActiveDatasetDetail'),
        href: '/dashboard/data?catalog=open',
        label: t('dashboard.reviewCatalog'),
        tone: 'warning',
        icon: <Database className="h-5 w-5" />,
      });
    }

    if (hasCriticalAlerts || machineStatus.state === 'Failing') {
      nextActions.push({
        title: t('dashboard.investigateAbnormal'),
        detail: t('dashboard.investigateAbnormalDetail'),
        href: '/dashboard/live',
        label: t('dashboard.openLive'),
        tone: 'danger',
        icon: <ShieldAlert className="h-5 w-5" />,
      });
    }

    if (hasDatasets && !hasWearConfig) {
      nextActions.push({
        title: t('dashboard.setHealthyBaseline'),
        detail: t('dashboard.setHealthyBaselineDetail'),
        href: '/dashboard/insights',
        label: t('common.configure'),
        tone: 'warning',
        icon: <Settings2 className="h-5 w-5" />,
      });
    }

    if (hasDatasets && hasWearConfig && !wearSnapshot) {
      nextActions.push({
        title: t('dashboard.runDeterioration'),
        detail: t('dashboard.runDeteriorationDetail'),
        href: '/dashboard/insights',
        label: t('dashboard.runInsights'),
        tone: wearError ? 'danger' : 'info',
        icon: <Gauge className="h-5 w-5" />,
      });
    }

    if (hasDatasets && !hasStreamingData) {
      nextActions.push({
        title: t('dashboard.startLiveVerification'),
        detail: t('dashboard.startLiveVerificationDetail'),
        href: '/dashboard/live',
        label: t('dashboard.openLive'),
        tone: 'info',
        icon: <Radio className="h-5 w-5" />,
      });
    }

    if (nextActions.length === 0) {
      nextActions.push({
        title: t('dashboard.reviewCurrentResult'),
        detail: t('dashboard.reviewCurrentResultDetail'),
        href: '/dashboard/insights',
        label: t('dashboard.openInsights'),
        tone: machineStatus.state === 'OK' ? 'success' : 'warning',
        icon: <Eye className="h-5 w-5" />,
      });
      nextActions.push({
        title: t('dashboard.reviewDataFiles'),
        detail: t('dashboard.reviewDataFilesDetail'),
        href: '/dashboard/data?catalog=open',
        label: t('dashboard.openCatalog'),
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
        title: t('dashboard.reviewDeteriorationTrend'),
        detail: t('dashboard.reviewDeteriorationTrendDetail'),
        href: '/dashboard/insights',
        label: t('dashboard.openInsights'),
        tone: machineStatus.state === 'OK' ? 'info' : 'warning',
        icon: <Gauge className="h-5 w-5" />,
      });
    }

    if (hasDatasets && nextActions.length < 3 && !hasCatalogAction) {
      nextActions.push({
        title: t('dashboard.reviewDataFiles'),
        detail: t('dashboard.reviewDataFilesForIdDetail'),
        href: '/dashboard/data?catalog=open',
        label: t('dashboard.openCatalog'),
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
    t,
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
        title: t('dashboard.datasetSelected'),
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
        title: t('dashboard.liveSignalUpdated'),
        description: t('dashboard.streamedStatus', {
          status: streamStatusLabel,
          points: formatNumberValue(streamingStatus?.streamed_points),
        }),
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
    formatNumberValue,
    t,
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
                    {t('dashboard.machineStatus')}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-semibold tracking-normal">
                      {formatHealthState(machineStatus.state)}
                    </h1>
                    <Badge variant={stateBadgeVariant[machineStatus.state]}>
                      {(selectedLiveDatasetId ?? latestDatasetId)
                        ? t('dashboard.selectedDataset', {
                            id: selectedLiveDatasetId ?? latestDatasetId ?? '',
                          })
                        : t('common.notAvailable')}
                    </Badge>
                  </div>
                  <p className="mt-2 max-w-3xl text-sm opacity-90">{machineRecommendation}</p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing}
                >
                  <RefreshCw className={cn('mr-2 h-4 w-4', isRefreshing && 'animate-spin')} />
                  {t('common.refresh')}
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-[minmax(250px,1.55fr)_repeat(3,minmax(130px,1fr))]">
                <SummaryMetric
                  label={t('dashboard.source')}
                  value={sourceLabel}
                  detail={sourceKindLabel}
                  valueClassName="line-clamp-2 text-base"
                />
                <SummaryMetric
                  label={t('dashboard.stream')}
                  value={streamStatusLabel}
                  detail={`${formatNumberValue(streamingStatus?.streamed_points)}/${formatNumberValue(streamingStatus?.total_points)} ${t('common.points')}`}
                  tone={hasStreamingData ? 'success' : 'warning'}
                />
                <SummaryMetric
                  label={t('dashboard.anomaly')}
                  value={formatPercentValue(latestAnomalyPercentage)}
                  detail={
                    anomalySource === 'manual-boundary'
                      ? t('dashboard.manualBoundary')
                      : t('dashboard.modelSignal')
                  }
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
                  label={t('dashboard.readiness')}
                  value={`${readinessScore}%`}
                  detail={t('dashboard.checksReady', {
                    ready: readinessItems.filter((item) => item.tone === 'success').length,
                    total: readinessItems.length,
                  })}
                  tone={
                    readinessScore >= 80 ? 'success' : readinessScore >= 50 ? 'warning' : 'danger'
                  }
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="rounded-md border border-current/20 bg-white/30 p-3 text-sm dark:bg-black/10">
                  <div className="text-xs font-semibold uppercase">
                    {t('dashboard.stateDrivers')}
                  </div>
                  <div className="mt-2 grid gap-2">
                    {machineReasons.map((reason) => (
                      <div key={reason} className="rounded-md border border-current/15 px-3 py-2">
                        {reason}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-current/20 bg-white/30 p-3 text-sm dark:bg-black/10">
                  <div className="text-xs font-semibold uppercase">{t('dashboard.lastSignal')}</div>
                  <div className="mt-2 text-lg font-semibold">
                    {lastTimelinePoint != null
                      ? formatRelativeTime(new Date(lastTimelinePoint), t)
                      : t('dashboard.noLiveSync')}
                  </div>
                  <div className="mt-1 text-xs opacity-80">
                    {t('dashboard.dashboardCadence', { seconds: Math.round(liveRefreshMs / 1000) })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <PriorityQueue items={priorityItems} />

          <Card>
            <SectionTitle
              icon={<Waves className="h-5 w-5" />}
              title={t('dashboard.liveSignal')}
              description={t('dashboard.liveSignalDescription')}
            />
            <CardContent className="grid gap-4 p-4 pt-0 lg:grid-cols-2">
              <div className="rounded-md border border-border bg-surface px-3 py-3">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium uppercase text-fg-muted">
                    {t('dashboard.anomalyRate')}
                  </span>
                  <span className="font-semibold text-fg">
                    {formatPercentValue(latestAnomalyPercentage)}
                  </span>
                </div>
                <Sparkline
                  values={anomalySeries}
                  stroke="#dc2626"
                  ariaLabel={t('dashboard.trendSparkline')}
                  emptyLabel={t('dashboard.waitingForSamples')}
                />
                <div className="mt-2 text-xs text-fg-muted">
                  {realtimeAnomaly
                    ? t('dashboard.abnormalOfPoints', {
                        abnormal: formatNumberValue(realtimeAnomaly.anomalyCount),
                        total: formatNumberValue(realtimeAnomaly.totalPoints),
                      })
                    : t('dashboard.noAnomalySample')}
                </div>
              </div>
              <div className="rounded-md border border-border bg-surface px-3 py-3">
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium uppercase text-fg-muted">
                    {t('dashboard.wearScore')}
                  </span>
                  <span className="font-semibold text-fg">
                    {wearSnapshot ? wearSnapshot.score.toFixed(3) : t('common.notAvailable')}
                  </span>
                </div>
                <Sparkline
                  values={wearSeries}
                  stroke="#7c3aed"
                  ariaLabel={t('dashboard.trendSparkline')}
                  emptyLabel={t('dashboard.waitingForSamples')}
                />
                <div className="mt-2 text-xs text-fg-muted">
                  {wearSnapshot
                    ? `${wearSnapshot.metadataColumn || wearColumn || t('dashboard.metadata')} · ${formatWearDirection(wearDirection)}`
                    : wearError || t('dashboard.noWearScore')}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <SectionTitle
              icon={<Radio className="h-5 w-5" />}
              title={t('dashboard.streamSettings')}
              description={t('dashboard.streamSettingsDescription')}
            />
            <CardContent className="grid gap-3 p-4 pt-0 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryMetric
                label={t('dashboard.progress')}
                value={formatPercentValue(streamingStatus?.progress_percentage)}
                detail={t('dashboard.streamedPoints', {
                  count: formatNumberValue(streamingStatus?.streamed_points),
                })}
                tone={hasStreamingData ? 'success' : 'neutral'}
              />
              <SummaryMetric
                label={t('dashboard.batchSize')}
                value={formatNumberValue(streamingStatus?.batch_size)}
                detail={t('dashboard.delay', {
                  value: streamingStatus
                    ? `${streamingStatus.delay_seconds}s`
                    : t('common.notAvailable'),
                })}
              />
              <SummaryMetric
                label={t('dashboard.glowPoints')}
                value={formatNumberValue(streamingStatus?.latest_glow_count)}
                detail={t('dashboard.glowPointsDescription')}
                tone="info"
              />
              <SummaryMetric
                label={t('dashboard.trailPoints')}
                value={formatNumberValue(streamingStatus?.trail_points)}
                detail={t('dashboard.trailPointsDescription')}
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
              title={t('dashboard.checks')}
              description={t('dashboard.checksDescription')}
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
              title={t('dashboard.recentActivity')}
              description={t('dashboard.recentActivityDescription')}
            />
            <CardContent className="space-y-2 p-4 pt-0">
              {recentOperations.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-4 text-sm text-fg-muted">
                  {t('dashboard.noRecentActivity')}
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
    </div>
  );
}
