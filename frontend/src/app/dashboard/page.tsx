'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EChartsOption } from 'echarts';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Database,
  Gauge,
  History,
  Radio,
  RefreshCw,
  ShieldAlert,
  Upload,
  Waves,
  type LucideIcon,
} from 'lucide-react';
import { EChartsCanvas } from '@/components/charts/echarts-canvas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { WorkflowState } from '@/components/ui/workflow-state';
import {
  type DashboardActivity,
  useDashboardWorkspace,
} from '@/context/dashboard-workspace-context';
import { useDashboardOverview } from '@/hooks/useDashboardOverview';
import { useI18n } from '@/i18n/client';
import type { DashboardAlert } from '@/lib/dashboard-overview';
import { DEFAULT_MACHINE_HEALTH_THRESHOLDS, type MachineHealthState } from '@/lib/health-status';
import type { DinsightDatasetSummary } from '@/lib/dataset-normalizers';
import { cn } from '@/utils/cn';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type Primitive = string | number | boolean | null | undefined;
type Translate = (key: string, values?: Record<string, Primitive>) => string;

const healthTone: Record<MachineHealthState, string> = {
  Unknown: 'border-border bg-surface text-fg',
  OK: 'border-success-border bg-success-bg text-success-text',
  Deteriorating: 'border-warning-border bg-warning-bg text-warning-text',
  Failing: 'border-danger-border bg-danger-bg text-danger-text',
};

const healthBadge: Record<MachineHealthState, 'neutral' | 'success' | 'warning' | 'danger'> = {
  Unknown: 'neutral',
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

const formatRelativeTime = (value: string | number | null | undefined, t: Translate) => {
  if (value == null) return t('health.noRecentSignal');
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return t('health.unknownTime');
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) return t('health.justNow');
  if (diff < 3_600_000) return t('health.minutesAgo', { count: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('health.hoursAgo', { count: Math.floor(diff / 3_600_000) });
  return t('health.daysAgo', { count: Math.floor(diff / 86_400_000) });
};

const getDatasetLabel = (dataset: DinsightDatasetSummary | null | undefined, t: Translate) =>
  dataset?.source.deviceName ??
  dataset?.source.deviceSlug ??
  dataset?.source.originalFileName ??
  dataset?.source.iotHubDeviceId ??
  (dataset
    ? t('dashboard.selectedDataset', { id: dataset.dinsight_id })
    : t('common.notAvailable'));

const getSourceLabel = (dataset: DinsightDatasetSummary | null | undefined, t: Translate) => {
  if (!dataset) return t('dashboard.noSource');
  if (dataset.source.source === 'auto') return t('dashboard.iotHubStream');
  if (dataset.source.source === 'manual') return t('dashboard.manualUpload');
  return t('dashboard.unknownSource');
};

function PanelHeader({
  icon,
  title,
  description,
  trailing,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  trailing?: ReactNode;
}) {
  return (
    <CardHeader className="p-4 pb-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base tracking-normal">
            <span className="text-fg-muted" aria-hidden="true">
              {icon}
            </span>
            {title}
          </CardTitle>
          {description && (
            <CardDescription className="mt-1 leading-5">{description}</CardDescription>
          )}
        </div>
        {trailing && <div className="shrink-0">{trailing}</div>}
      </div>
    </CardHeader>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={cn('min-h-[94px] min-w-0 rounded-lg border px-3 py-2.5', toneClasses[tone])}>
      <div className="text-[11px] font-semibold uppercase leading-4">{label}</div>
      <div className="mt-1 break-words text-xl font-semibold leading-tight">{value}</div>
      <div className="mt-1 break-words text-xs leading-4 opacity-80">{detail}</div>
    </div>
  );
}

function ReadinessRow({
  label,
  detail,
  ready,
  error,
  href,
}: {
  label: string;
  detail: string;
  ready: boolean;
  error?: boolean;
  href: string;
}) {
  const { t } = useI18n();
  const Icon = error ? AlertCircle : ready ? CheckCircle2 : CircleDashed;
  const tone: Tone = error ? 'danger' : ready ? 'success' : 'neutral';
  return (
    <Link
      href={href}
      className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0',
          error ? 'text-danger-text' : ready ? 'text-success-text' : 'text-fg-muted'
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-fg">{label}</div>
        <div className="truncate text-xs text-fg-muted">{detail}</div>
      </div>
      <Badge variant={toneBadge[tone]}>
        {error
          ? t('dashboard.unavailable')
          : ready
            ? t('dashboard.available')
            : t('dashboard.missing')}
      </Badge>
    </Link>
  );
}

function ActivityRow({ activity }: { activity: DashboardActivity }) {
  const { t } = useI18n();
  const content = (
    <div className="flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-hover">
      <span
        className={cn(
          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
          activity.status === 'danger'
            ? 'bg-danger'
            : activity.status === 'warning'
              ? 'bg-warning'
              : activity.status === 'success'
                ? 'bg-success'
                : 'bg-info'
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg">{activity.title}</div>
        {activity.description && (
          <div className="mt-0.5 line-clamp-2 text-xs leading-4 text-fg-muted">
            {activity.description}
          </div>
        )}
      </div>
      <time className="shrink-0 text-xs text-fg-muted" dateTime={activity.timestamp}>
        {formatRelativeTime(activity.timestamp, t)}
      </time>
    </div>
  );
  return activity.href ? <Link href={activity.href}>{content}</Link> : content;
}

function AlertRow({ alert }: { alert: DashboardAlert }) {
  const { t } = useI18n();
  const localized = alert.kind ? wearAlertKeys[alert.kind] : null;
  const title = localized ? t(localized.title) : alert.title;
  const message = localized ? t(localized.message, alert.messageValues) : alert.message;
  const tone: Tone =
    alert.severity === 'critical' || alert.severity === 'high'
      ? 'danger'
      : alert.severity === 'medium'
        ? 'warning'
        : 'neutral';
  const severity =
    alert.severity === 'critical'
      ? t('settings.severityCritical')
      : alert.severity === 'high'
        ? t('settings.severityHigh')
        : alert.severity === 'medium'
          ? t('settings.severityMedium')
          : t('settings.severityLow');

  return (
    <div className={cn('rounded-lg border p-3', toneClasses[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold leading-5">{title}</div>
          <p className="mt-1 text-xs leading-5 opacity-85">{message}</p>
        </div>
        <Badge variant={toneBadge[tone]}>{severity}</Badge>
      </div>
      <div className="mt-2 text-xs opacity-70">{formatRelativeTime(alert.createdAt, t)}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { activities, selectDataset, setMachineHealthSnapshot } = useDashboardWorkspace();
  const {
    datasets,
    selectedLiveDatasetId,
    streamingStatus,
    alerts,
    alertSummary,
    wearSnapshot,
    wearThresholds,
    machineStatus,
    history,
    latestAnomalyPercentage,
    realtimeAnomaly,
    anomalySource,
    appliedWearConfig,
    wearError,
    isLoading,
    refetchAll,
  } = useDashboardOverview();
  const { t, formatDate, formatNumber } = useI18n();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const selectedDataset =
    datasets.find((dataset) => dataset.dinsight_id === selectedLiveDatasetId) ?? null;
  const hasDatasets = datasets.length > 0;
  const hasMonitoring = (streamingStatus?.streamed_points ?? 0) > 0;
  const hasWearConfig = Boolean(
    appliedWearConfig?.metadataColumn &&
    ((appliedWearConfig.baselineClusterValues?.length ?? 0) > 0 ||
      (appliedWearConfig.baselineRange?.start && appliedWearConfig.baselineRange?.end))
  );
  const hasWearResult = Boolean(
    wearSnapshot && (wearSnapshot.monitoringDistance.sampleCount ?? 0) > 0
  );
  const latestSampleAt = streamingStatus?.last_data_at || null;
  const activeAlerts = alerts.filter((alert) => alert.status === 'active');
  const sourceLabel = getSourceLabel(selectedDataset, t);
  const datasetLabel = getDatasetLabel(selectedDataset, t);

  const formatHealthState = useCallback(
    (state: MachineHealthState) =>
      state === 'Unknown'
        ? t('health.unknown')
        : state === 'OK'
          ? t('health.normal')
          : state === 'Deteriorating'
            ? t('health.deteriorating')
            : t('health.critical'),
    [t]
  );
  const formatNumeric = useCallback(
    (value: number | null | undefined, digits = 3) =>
      typeof value === 'number' && Number.isFinite(value)
        ? formatNumber(value, { minimumFractionDigits: digits, maximumFractionDigits: digits })
        : t('common.notAvailable'),
    [formatNumber, t]
  );

  const recommendation = t(machineStatus.recommendationKey);
  const reasons = useMemo(
    () =>
      machineStatus.reasonsI18n.length > 0
        ? machineStatus.reasonsI18n.map((reason) => t(reason.key, reason.values))
        : machineStatus.reasons,
    [machineStatus.reasons, machineStatus.reasonsI18n, t]
  );

  useEffect(() => {
    setMachineHealthSnapshot({
      state: machineStatus.state,
      recommendation,
      reasons,
      updatedAt: latestSampleAt ?? wearSnapshot?.capturedAt,
    });
  }, [
    latestSampleAt,
    machineStatus.state,
    reasons,
    recommendation,
    setMachineHealthSnapshot,
    wearSnapshot?.capturedAt,
  ]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchAll();
    } finally {
      setIsRefreshing(false);
    }
  };

  const freshness = streamingStatus?.is_active
    ? { label: t('dashboard.live'), tone: 'info' as Tone }
    : hasMonitoring
      ? { label: t('dashboard.historicalResult'), tone: 'neutral' as Tone }
      : { label: t('dashboard.noMonitoringSample'), tone: 'warning' as Tone };

  const primaryAction = useMemo<{
    title: string;
    detail: string;
    label: string;
    href: string;
    tone: Tone;
    icon: LucideIcon;
  }>(() => {
    if (!hasDatasets) {
      return {
        title: t('dashboard.emptyOverviewTitle'),
        detail: t('dashboard.emptyOverviewDescription'),
        label: t('dashboard.addFirstData'),
        href: '/dashboard/data',
        tone: 'info',
        icon: Upload,
      };
    }
    if (machineStatus.state === 'Failing') {
      return {
        title: t('dashboard.inspectCriticalCondition'),
        detail: t('dashboard.inspectCriticalConditionDetail'),
        label: t('dashboard.viewAssetMonitor'),
        href: '/dashboard/monitor?view=compare',
        tone: 'danger',
        icon: ShieldAlert,
      };
    }
    if (!hasMonitoring) {
      return {
        title: t('dashboard.addMonitoringData'),
        detail: t('dashboard.addMonitoringDataDetail'),
        label: t('dashboard.openData'),
        href: '/dashboard/data',
        tone: 'warning',
        icon: Radio,
      };
    }
    if (!hasWearConfig) {
      return {
        title: t('dashboard.configureHealthyBaseline'),
        detail: t('dashboard.configureHealthyBaselineDetail'),
        label: t('common.configure'),
        href: '/dashboard/monitor?view=deterioration',
        tone: 'warning',
        icon: Gauge,
      };
    }
    if (wearError) {
      return {
        title: t('dashboard.resolveAnalysisIssue'),
        detail: t('dashboard.resolveAnalysisIssueDetail'),
        label: t('dashboard.openInsights'),
        href: '/dashboard/monitor?view=deterioration',
        tone: 'danger',
        icon: AlertCircle,
      };
    }
    if (machineStatus.state === 'Deteriorating') {
      return {
        title: t('dashboard.reviewDeteriorationEvidence'),
        detail: t('dashboard.reviewDeteriorationEvidenceDetail'),
        label: t('dashboard.viewAssetMonitor'),
        href: '/dashboard/monitor?view=compare',
        tone: 'warning',
        icon: Waves,
      };
    }
    return {
      title: t('dashboard.reviewCurrentCondition'),
      detail: t('dashboard.reviewCurrentConditionDetail'),
      label: t('dashboard.viewAssetMonitor'),
      href: '/dashboard/monitor?view=compare',
      tone: machineStatus.state === 'OK' ? 'success' : 'neutral',
      icon: Activity,
    };
  }, [hasDatasets, hasMonitoring, hasWearConfig, machineStatus.state, t, wearError]);

  const trendOption = useMemo<EChartsOption>(() => {
    const anomalyData = history
      .filter((point) => point.anomalyPercentage != null)
      .map((point) => [point.timestamp, point.anomalyPercentage]);
    const distanceData = history
      .filter((point) => point.wearScore != null)
      .map((point) => [point.timestamp, point.wearScore]);
    const showSymbols = Math.max(anomalyData.length, distanceData.length) < 20;

    return {
      animationDuration: 250,
      color: ['#2563eb', '#7c3aed'],
      grid: { left: 58, right: 58, top: 56, bottom: 72, containLabel: true },
      legend: {
        top: 8,
        left: 8,
        itemWidth: 18,
        itemHeight: 8,
        textStyle: { color: '#64748b', fontSize: 12 },
      },
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      toolbox: {
        right: 8,
        feature: { dataZoom: { yAxisIndex: 'none' }, restore: {}, saveAsImage: {} },
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        { type: 'slider', xAxisIndex: 0, height: 18, bottom: 12, filterMode: 'none' },
      ],
      xAxis: {
        type: 'time',
        axisLabel: { color: '#64748b', hideOverlap: true },
        axisLine: { lineStyle: { color: '#94a3b8' } },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: t('dashboard.abnormalPointRate'),
          nameLocation: 'middle',
          nameGap: 44,
          nameRotate: 90,
          min: 0,
          max: 100,
          axisLabel: { color: '#64748b', formatter: '{value}%' },
          nameTextStyle: { color: '#64748b' },
          splitLine: { lineStyle: { color: '#e2e8f0', opacity: 0.65 } },
        },
        {
          type: 'value',
          name: t('dashboard.meanDistance'),
          nameLocation: 'middle',
          nameGap: 50,
          nameRotate: -90,
          axisLabel: { color: '#64748b' },
          nameTextStyle: { color: '#64748b' },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: t('dashboard.abnormalPointRate'),
          type: 'line',
          yAxisIndex: 0,
          data: anomalyData,
          showSymbol: showSymbols,
          symbolSize: 7,
          lineStyle: { width: 2.5 },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            label: { show: false },
            data: [
              {
                yAxis: DEFAULT_MACHINE_HEALTH_THRESHOLDS.anomalyDeteriorating,
                lineStyle: { color: '#d97706', type: 'dashed', width: 1.5 },
              },
              {
                yAxis: DEFAULT_MACHINE_HEALTH_THRESHOLDS.anomalyFailing,
                lineStyle: { color: '#b91c1c', type: 'dashed', width: 1.5 },
              },
            ],
          },
        },
        {
          name: t('dashboard.meanBaselineDistance'),
          type: 'line',
          yAxisIndex: 1,
          data: distanceData,
          showSymbol: showSymbols,
          symbolSize: 7,
          lineStyle: { width: 2.5 },
          markLine:
            hasWearConfig &&
            Number.isFinite(wearThresholds.warningThreshold) &&
            Number.isFinite(wearThresholds.dangerThreshold)
              ? {
                  silent: true,
                  symbol: ['none', 'none'],
                  label: { show: false },
                  data: [
                    {
                      yAxis: wearThresholds.warningThreshold,
                      lineStyle: { color: '#d97706', type: 'dotted', width: 1.5 },
                    },
                    {
                      yAxis: wearThresholds.dangerThreshold,
                      lineStyle: { color: '#b91c1c', type: 'dotted', width: 1.5 },
                    },
                  ],
                }
              : undefined,
        },
      ],
    };
  }, [hasWearConfig, history, t, wearThresholds.dangerThreshold, wearThresholds.warningThreshold]);

  const recentDatasets = useMemo(
    () =>
      [...datasets]
        .sort(
          (left, right) =>
            Number(right.dinsight_id === selectedLiveDatasetId) -
              Number(left.dinsight_id === selectedLiveDatasetId) ||
            right.dinsight_id - left.dinsight_id
        )
        .slice(0, 6),
    [datasets, selectedLiveDatasetId]
  );

  if (!hasDatasets && !isLoading) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal text-fg">
            {t('dashboard.operationsOverview')}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {t('dashboard.operationsOverviewDescription')}
          </p>
        </div>
        <Card>
          <CardContent className="p-4">
            <WorkflowState
              icon={<Database className="h-5 w-5" aria-hidden="true" />}
              title={t('dashboard.emptyOverviewTitle')}
              description={t('dashboard.emptyOverviewDescription')}
              action={
                <Button asChild>
                  <Link href="/dashboard/data">
                    <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
                    {t('dashboard.addFirstData')}
                  </Link>
                </Button>
              }
              className="min-h-[360px]"
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const PrimaryActionIcon = primaryAction.icon;
  const anomalyTone: Tone =
    latestAnomalyPercentage == null
      ? 'neutral'
      : latestAnomalyPercentage >= DEFAULT_MACHINE_HEALTH_THRESHOLDS.anomalyFailing
        ? 'danger'
        : latestAnomalyPercentage >= DEFAULT_MACHINE_HEALTH_THRESHOLDS.anomalyDeteriorating
          ? 'warning'
          : 'success';
  const distanceTone: Tone =
    wearThresholds.state === 'danger'
      ? 'danger'
      : wearThresholds.state === 'warning'
        ? 'warning'
        : wearThresholds.state === 'normal'
          ? 'success'
          : 'neutral';

  return (
    <div className="min-w-0 space-y-5" aria-busy={isLoading || isRefreshing}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-normal text-fg">
            {t('dashboard.operationsOverview')}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {t('dashboard.operationsOverviewDescription')}
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
        >
          <RefreshCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} aria-hidden="true" />
        </Button>
      </div>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.85fr)]">
        <Card className={cn('min-w-0 border', healthTone[machineStatus.state])}>
          <CardContent className="space-y-4 p-4">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase opacity-75">
                  {t('dashboard.conditionAssessment')}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-3xl font-semibold tracking-normal">
                    {formatHealthState(machineStatus.state)}
                  </h2>
                  <Badge variant={healthBadge[machineStatus.state]}>
                    {selectedLiveDatasetId
                      ? t('dashboard.selectedDataset', { id: selectedLiveDatasetId })
                      : t('common.notAvailable')}
                  </Badge>
                  <Badge variant={toneBadge[freshness.tone]}>{freshness.label}</Badge>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 opacity-90">{recommendation}</p>
              </div>
              <div className="min-w-0 w-full text-sm sm:w-auto sm:min-w-[210px]">
                <div className="break-words font-medium">{datasetLabel}</div>
                <div className="mt-1 text-xs opacity-75">{sourceLabel}</div>
                <div className="mt-2 flex items-center gap-1.5 text-xs opacity-75">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  {latestSampleAt
                    ? `${t('dashboard.latestSample')}: ${formatRelativeTime(latestSampleAt, t)}`
                    : hasMonitoring
                      ? t('dashboard.historicalResult')
                      : t('dashboard.noMonitoringSample')}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              <Metric
                label={t('dashboard.latestDistance')}
                value={formatNumeric(wearSnapshot?.monitoringDistance.latest)}
                detail={
                  hasWearConfig &&
                  Number.isFinite(wearThresholds.warningThreshold) &&
                  Number.isFinite(wearThresholds.dangerThreshold)
                    ? t('dashboard.thresholdDetail', {
                        warning: formatNumeric(wearThresholds.warningThreshold),
                        danger: formatNumeric(wearThresholds.dangerThreshold),
                      })
                    : t('dashboard.configureHealthyBaseline')
                }
                tone={distanceTone}
              />
              <Metric
                label={t('dashboard.abnormalPoints')}
                value={
                  latestAnomalyPercentage == null
                    ? t('common.notAvailable')
                    : `${latestAnomalyPercentage.toFixed(1)}%`
                }
                detail={
                  realtimeAnomaly.totalPoints > 0
                    ? t('dashboard.abnormalOfPoints', {
                        abnormal: formatNumber(realtimeAnomaly.anomalyCount),
                        total: formatNumber(realtimeAnomaly.totalPoints),
                      })
                    : t('dashboard.waitingForSignal')
                }
                tone={anomalyTone}
              />
              <Metric
                label={t('dashboard.monitoringPoints')}
                value={formatNumber(streamingStatus?.streamed_points ?? 0)}
                detail={
                  streamingStatus?.total_points
                    ? `${formatNumber(streamingStatus.streamed_points)} / ${formatNumber(streamingStatus.total_points)}`
                    : t('dashboard.noMonitoringSample')
                }
                tone={hasMonitoring ? 'info' : 'neutral'}
              />
              <Metric
                label={t('dashboard.activeAlerts')}
                value={formatNumber(alertSummary.activeTotal)}
                detail={
                  alertSummary.bySeverity.critical > 0 || alertSummary.bySeverity.high > 0
                    ? `${formatNumber(alertSummary.bySeverity.critical + alertSummary.bySeverity.high)} ${t('settings.severityHigh')}`
                    : t('dashboard.noActiveAlerts')
                }
                tone={
                  alertSummary.bySeverity.critical > 0 || alertSummary.bySeverity.high > 0
                    ? 'danger'
                    : alertSummary.activeTotal > 0
                      ? 'warning'
                      : 'success'
                }
              />
            </div>

            <div className="rounded-lg border border-current/20 bg-white/35 p-3 dark:bg-black/10">
              <div className="text-xs font-semibold uppercase opacity-75">
                {t('dashboard.whyThisStatus')}
              </div>
              <ul className="mt-2 grid gap-1.5 text-sm leading-5 md:grid-cols-2">
                {reasons.map((reason) => (
                  <li key={reason} className="flex items-start gap-2">
                    <span
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current"
                      aria-hidden="true"
                    />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-5">
          <Card className={cn('border', toneClasses[primaryAction.tone])}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase">
                <PrimaryActionIcon className="h-4 w-4" aria-hidden="true" />
                {t('dashboard.recommendedAction')}
              </div>
              <h2 className="mt-3 text-lg font-semibold tracking-normal">{primaryAction.title}</h2>
              <p className="mt-1 text-sm leading-6 opacity-85">{primaryAction.detail}</p>
              <Button asChild className="mt-4 w-full">
                <Link href={primaryAction.href}>
                  {primaryAction.label}
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <PanelHeader
              icon={<ShieldAlert className="h-5 w-5" />}
              title={t('dashboard.currentAlerts')}
              description={t('dashboard.currentAlertsDescription')}
              trailing={
                activeAlerts.length > 0 ? (
                  <Badge variant="danger">{formatNumber(activeAlerts.length)}</Badge>
                ) : null
              }
            />
            <CardContent className="space-y-2 p-4 pt-0">
              {activeAlerts.length > 0 ? (
                activeAlerts.slice(0, 3).map((alert) => <AlertRow key={alert.id} alert={alert} />)
              ) : (
                <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-muted px-3 py-3">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-success-text"
                    aria-hidden="true"
                  />
                  <div>
                    <div className="text-sm font-medium text-fg">
                      {t('dashboard.noActiveAlerts')}
                    </div>
                    <div className="mt-0.5 text-xs leading-5 text-fg-muted">
                      {t('dashboard.noActiveAlertsDescription')}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="min-w-0">
        <PanelHeader
          icon={<Waves className="h-5 w-5" />}
          title={t('dashboard.conditionTrend')}
          description={t('dashboard.conditionTrendDescription')}
          trailing={
            <Badge variant="outline">
              {anomalySource === 'manual-boundary'
                ? t('dashboard.manualBoundary')
                : t('dashboard.modelSignal')}
            </Badge>
          }
        />
        <CardContent className="p-4 pt-0">
          {hasMonitoring &&
          history.some((point) => point.anomalyPercentage != null || point.wearScore != null) ? (
            <EChartsCanvas
              option={trendOption}
              className="h-[360px] w-full"
              preserveDataZoom
              dataZoomStorageKey={`dinsight:overview-trend:${selectedLiveDatasetId ?? 'none'}`}
            />
          ) : (
            <WorkflowState
              icon={<Waves className="h-5 w-5" aria-hidden="true" />}
              title={t('dashboard.noTrendData')}
              description={t('dashboard.noTrendDataDescription')}
              className="min-h-[280px]"
            />
          )}
        </CardContent>
      </Card>

      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="min-w-0 space-y-5">
          <Card className="min-w-0">
            <PanelHeader
              icon={<Database className="h-5 w-5" />}
              title={t('dashboard.recentAssets')}
              description={t('dashboard.recentAssetsDescription')}
              trailing={
                <Button asChild variant="outline" size="sm">
                  <Link href="/dashboard/data?catalog=open">{t('dashboard.openCatalog')}</Link>
                </Button>
              }
            />
            <CardContent className="p-4 pt-0">
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="hidden grid-cols-[minmax(0,1fr)_110px_120px_84px] gap-3 border-b border-border bg-surface-muted px-3 py-2 text-[11px] font-semibold uppercase text-fg-muted md:grid">
                  <div>{t('dashboard.assetOrSource')}</div>
                  <div>{t('common.points')}</div>
                  <div>{t('dashboard.assessment')}</div>
                  <div />
                </div>
                {recentDatasets.map((dataset) => {
                  const isCurrent = dataset.dinsight_id === selectedLiveDatasetId;
                  return (
                    <div
                      key={dataset.dinsight_id}
                      className={cn(
                        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_110px_120px_84px]',
                        isCurrent && 'bg-accent-subtle'
                      )}
                    >
                      <div className="min-w-0">
                        <div
                          className="truncate text-sm font-medium text-fg"
                          title={getDatasetLabel(dataset, t)}
                        >
                          {getDatasetLabel(dataset, t)}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-muted">
                          <span>#{dataset.dinsight_id}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{getSourceLabel(dataset, t)}</span>
                        </div>
                      </div>
                      <div className="hidden text-sm text-fg md:block">
                        {dataset.records == null
                          ? t('common.notAvailable')
                          : formatNumber(dataset.records)}
                      </div>
                      <div className="hidden md:block">
                        <Badge variant={isCurrent ? healthBadge[machineStatus.state] : 'neutral'}>
                          {isCurrent
                            ? formatHealthState(machineStatus.state)
                            : t('dashboard.notAssessed')}
                        </Badge>
                      </div>
                      {isCurrent ? (
                        <Badge variant="accent">{t('dashboard.current')}</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => selectDataset(dataset.dinsight_id)}
                        >
                          {t('dashboard.assess')}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <PanelHeader
              icon={<History className="h-5 w-5" />}
              title={t('dashboard.workspaceActivity')}
              description={t('dashboard.workspaceActivityDescription')}
            />
            <CardContent className="grid gap-1 p-2 pt-0 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {activities.length > 0 ? (
                activities
                  .slice(0, 6)
                  .map((activity) => <ActivityRow key={activity.id} activity={activity} />)
              ) : (
                <div className="px-2 py-4 text-sm text-fg-muted md:col-span-2 xl:col-span-1 2xl:col-span-2">
                  {t('dashboard.noWorkspaceActivity')}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0">
          <PanelHeader
            icon={<Gauge className="h-5 w-5" />}
            title={t('dashboard.monitoringReadiness')}
            description={t('dashboard.monitoringReadinessDescription')}
          />
          <CardContent className="space-y-2 p-4 pt-0">
            <ReadinessRow
              label={t('dashboard.sourceAttribution')}
              detail={sourceLabel}
              ready={Boolean(selectedDataset && selectedDataset.source.source !== 'unknown')}
              href="/dashboard/data?catalog=open"
            />
            <ReadinessRow
              label={t('dashboard.liveStream')}
              detail={
                hasMonitoring
                  ? t('dashboard.streamedPoints', {
                      count: formatNumber(streamingStatus?.streamed_points ?? 0),
                    })
                  : t('dashboard.noMonitoringSample')
              }
              ready={hasMonitoring}
              href="/dashboard/monitor?view=map"
            />
            <ReadinessRow
              label={t('dashboard.healthyReference')}
              detail={hasWearConfig ? t('dashboard.configured') : t('dashboard.missing')}
              ready={hasWearConfig}
              href="/dashboard/monitor?view=deterioration"
            />
            <ReadinessRow
              label={t('dashboard.deteriorationAnalysis')}
              detail={
                wearError
                  ? t('dashboard.calculationFailed')
                  : hasWearResult
                    ? t('dashboard.available')
                    : t('dashboard.unavailable')
              }
              ready={hasWearResult}
              error={Boolean(wearError)}
              href="/dashboard/monitor?view=deterioration"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
