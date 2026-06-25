'use client';

import Link from 'next/link';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Search,
  TrendingDown,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartFrame, ChartStat, ChartSwatch } from '@/components/charts/chart-frame';
import { WorkflowState } from '@/components/ui/workflow-state';
import { useActiveStreamingDataset } from '@/hooks/useActiveStreamingDataset';
import { api } from '@/lib/api-client';
import {
  axisRangeRevisionPart,
  buildPaddedAxisRange,
  plotRevisionFromParts,
} from '@/lib/plot-autoscale';
import { alphaColor, usePlotTheme } from '@/lib/plot-theme';
import { readScoped, writeScoped } from '@/lib/scoped-storage';
import { useAuth } from '@/context/auth-context';
import {
  DASHBOARD_COMMAND_EVENT,
  useDashboardWorkspace,
} from '@/context/dashboard-workspace-context';
import { STREAMING_MONITORING_EMPHASIS_POINTS } from '@/lib/chart-focus-config';
import { EChartsCanvas } from '@/components/charts/echarts-canvas';
import {
  AppliedWearTrendConfig,
  DraftWearTrendConfig,
  INSIGHTS_APPLIED_WEAR_CONFIG_EVENT,
  INSIGHTS_APPLIED_WEAR_CONFIG_KEY,
  INSIGHTS_DRAFT_WEAR_CONFIG_KEY,
  INSIGHTS_DRAFT_WEAR_PREFS_FIELD,
  INSIGHTS_WEAR_PREFS_FIELD,
  parseAppliedWearTrendConfig,
  parseAppliedWearTrendConfigFromUnknown,
  parseDraftWearTrendConfig,
  parseDraftWearTrendConfigFromUnknown,
  pickNewestDraftWearConfig,
  pickNewestWearConfig,
} from '@/lib/insights-wear-config';
import { cn } from '@/utils/cn';

import type { EChartsOption } from 'echarts';
const INSIGHTS_UI_PREFS_KEY = 'insights-ui-prefs-v1';
const DISTANCE_AXIS_BASE_MAX = 2;
const DISTANCE_WARNING_FALLBACK = 0.8;
const DISTANCE_DANGER_FALLBACK = 1.2;
const BASELINE_CLUSTER_PAGE_SIZE = 40;
const DEFAULT_DISTANCE_THRESHOLD_CONFIG = {
  mode: 'adaptive',
  warningSpreadMultiplier: 1.5,
  dangerSpreadMultiplier: 2.5,
  warningPercentile: 95,
  dangerPercentile: 99,
  warningRelativePercent: 30,
  dangerRelativePercent: 60,
} as const;

type DatasetType = 'baseline' | 'monitoring';
type DistanceThresholdMode = 'adaptive' | 'statistical' | 'relative';

interface DistanceThresholdConfig {
  mode: DistanceThresholdMode;
  warningSpreadMultiplier: number;
  dangerSpreadMultiplier: number;
  warningPercentile: number;
  dangerPercentile: number;
  warningRelativePercent: number;
  dangerRelativePercent: number;
}

interface DeteriorationInterval {
  label: string;
  metadata_value: string;
  dataset_type: DatasetType;
  sort_index: number;
  point_count: number;
  distance_from_g0: number;
  is_baseline_cluster: boolean;
}

interface DeteriorationTransition {
  from_label: string;
  to_label: string;
  from_dataset_type: DatasetType;
  to_dataset_type: DatasetType;
  distance: number;
}

interface DeteriorationResult {
  metadata_column: string;
  g0: {
    labels: string[];
    point_count: number;
  };
  intervals: DeteriorationInterval[];
  distances: {
    g0_to_gi: Array<{ label: string; dataset_type: DatasetType; distance: number }>;
    g0_to_gi_mean: number;
    gi_to_gi_plus_1: DeteriorationTransition[];
    gi_to_gi_plus_1_mean: number;
  };
  stats: {
    baseline_point_count: number;
    monitoring_point_count: number;
    skipped_baseline: number;
    skipped_monitoring: number;
  };
}

interface StreamingStatus {
  is_active: boolean;
  status: 'not_started' | 'streaming' | 'completed';
  streamed_points: number;
  total_points: number;
  progress_percentage: number;
  latest_glow_count: number;
  trail_points: number;
  batch_size: number;
  delay_seconds: number;
}

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
};

const percentile = (values: number[], requestedPercentile: number) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return null;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }

  const rank = (clampNumber(requestedPercentile, 0, 100, 95) / 100) * (sorted.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const weight = rank - lowerIndex;

  return sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * weight;
};

const standardDeviation = (values: number[]) => {
  if (values.length === 0) {
    return null;
  }

  const average = mean(values);
  if (average == null) {
    return null;
  }

  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
};

const robustBaselineSpread = (values: number[], center: number) => {
  const deviations = values.map((value) => Math.abs(value - center));
  const medianAbsoluteDeviation = percentile(deviations, 50);
  const robustSigma =
    medianAbsoluteDeviation != null && medianAbsoluteDeviation > 0
      ? medianAbsoluteDeviation * 1.4826
      : null;
  const stdDev = standardDeviation(values);

  if (robustSigma != null && Number.isFinite(robustSigma) && robustSigma > 0) {
    return robustSigma;
  }
  if (stdDev != null && Number.isFinite(stdDev) && stdDev > 0) {
    return stdDev;
  }

  return Math.max(center * 0.05, 0.000001);
};

const sanitizeDistanceThresholdConfig = (
  input?: Partial<DistanceThresholdConfig> | null
): DistanceThresholdConfig => {
  const isLegacyStatisticalDefault =
    input?.mode === 'statistical' &&
    input.warningSpreadMultiplier == null &&
    input.dangerSpreadMultiplier == null &&
    (input.warningPercentile == null ||
      Number(input.warningPercentile) === DEFAULT_DISTANCE_THRESHOLD_CONFIG.warningPercentile) &&
    (input.dangerPercentile == null ||
      Number(input.dangerPercentile) === DEFAULT_DISTANCE_THRESHOLD_CONFIG.dangerPercentile);
  const mode: DistanceThresholdMode = isLegacyStatisticalDefault
    ? DEFAULT_DISTANCE_THRESHOLD_CONFIG.mode
    : input?.mode === 'relative'
      ? 'relative'
      : input?.mode === 'statistical'
        ? 'statistical'
        : DEFAULT_DISTANCE_THRESHOLD_CONFIG.mode;
  const warningSpreadMultiplier = clampNumber(
    input?.warningSpreadMultiplier,
    0.1,
    10,
    DEFAULT_DISTANCE_THRESHOLD_CONFIG.warningSpreadMultiplier
  );
  const dangerSpreadMultiplier = Math.max(
    warningSpreadMultiplier + 0.1,
    clampNumber(
      input?.dangerSpreadMultiplier,
      0.2,
      12,
      DEFAULT_DISTANCE_THRESHOLD_CONFIG.dangerSpreadMultiplier
    )
  );
  const warningPercentile = clampNumber(
    input?.warningPercentile,
    50,
    99.8,
    DEFAULT_DISTANCE_THRESHOLD_CONFIG.warningPercentile
  );
  const dangerPercentile = Math.max(
    warningPercentile + 0.1,
    clampNumber(
      input?.dangerPercentile,
      50.1,
      99.9,
      DEFAULT_DISTANCE_THRESHOLD_CONFIG.dangerPercentile
    )
  );
  const warningRelativePercent = clampNumber(
    input?.warningRelativePercent,
    1,
    300,
    DEFAULT_DISTANCE_THRESHOLD_CONFIG.warningRelativePercent
  );
  const dangerRelativePercent = Math.max(
    warningRelativePercent + 1,
    clampNumber(
      input?.dangerRelativePercent,
      2,
      400,
      DEFAULT_DISTANCE_THRESHOLD_CONFIG.dangerRelativePercent
    )
  );

  return {
    mode,
    warningSpreadMultiplier,
    dangerSpreadMultiplier: Math.min(dangerSpreadMultiplier, 12),
    warningPercentile,
    dangerPercentile: Math.min(dangerPercentile, 99.9),
    warningRelativePercent,
    dangerRelativePercent: Math.min(dangerRelativePercent, 400),
  };
};

const deriveDistanceThresholds = (
  baselineDistances: number[],
  baselineMean: number | null,
  config: DistanceThresholdConfig
) => {
  const finiteBaselineDistances = baselineDistances.filter(
    (value) => Number.isFinite(value) && value >= 0
  );

  if (config.mode === 'adaptive' && finiteBaselineDistances.length > 0) {
    const baselineCenter = percentile(finiteBaselineDistances, 50) ?? baselineMean;
    if (baselineCenter != null && Number.isFinite(baselineCenter) && baselineCenter >= 0) {
      const spread = robustBaselineSpread(finiteBaselineDistances, baselineCenter);
      const warning = baselineCenter + config.warningSpreadMultiplier * spread;
      const danger = baselineCenter + config.dangerSpreadMultiplier * spread;

      return {
        warning,
        danger: Math.max(danger, warning),
        source: 'baseline-adaptive' as const,
      };
    }
  }

  if (config.mode === 'statistical' && finiteBaselineDistances.length > 0) {
    const warning = percentile(finiteBaselineDistances, config.warningPercentile);
    const danger = percentile(finiteBaselineDistances, config.dangerPercentile);
    if (warning != null && danger != null && danger > 0) {
      return {
        warning,
        danger: Math.max(danger, warning),
        source: 'baseline-statistical' as const,
      };
    }
  }

  if (baselineMean != null && Number.isFinite(baselineMean) && baselineMean > 0) {
    const warning = baselineMean * (1 + config.warningRelativePercent / 100);
    return {
      warning,
      danger: Math.max(warning, baselineMean * (1 + config.dangerRelativePercent / 100)),
      source:
        config.mode === 'relative'
          ? ('baseline-relative' as const)
          : ('baseline-relative-fallback' as const),
    };
  }

  return {
    warning: DISTANCE_WARNING_FALLBACK,
    danger: DISTANCE_DANGER_FALLBACK,
    source: 'fallback' as const,
  };
};

const rollingMean = (values: Array<number | null>, windowSize: number) =>
  values.map((value, index) => {
    if (value == null) {
      return null;
    }
    const windowValues = values
      .slice(Math.max(0, index - windowSize + 1), index + 1)
      .filter((entry): entry is number => entry != null && Number.isFinite(entry));
    return mean(windowValues);
  });

const formatIntervalTick = (value: string) => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  const timestamp = normalized.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2})?)?/
  );
  if (timestamp) {
    const [, , month, day, hour, minute] = timestamp;
    return hour && minute
      ? `${month.padStart(2, '0')}/${day.padStart(2, '0')}<br>${hour.padStart(2, '0')}:${minute}`
      : `${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
  }

  return normalized.length > 14 ? `${normalized.slice(0, 13)}...` : normalized;
};

export default function HealthInsightsPage() {
  const { user } = useAuth();
  const {
    selectedDatasetId: datasetId,
    filteredDatasetIds,
    filteredDatasets,
    isLoadingDatasets,
    logActivity,
    setMachineHealthSnapshot,
  } = useDashboardWorkspace();
  const plotTheme = usePlotTheme();
  const userId = user?.id;
  const [metadataColumn, setMetadataColumn] = useState<string>('');
  const [includeMonitoring, setIncludeMonitoring] = useState(true);
  const [selectedClusterValues, setSelectedClusterValues] = useState<string[]>([]);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [clusterFilterText, setClusterFilterText] = useState('');
  const [clusterPage, setClusterPage] = useState(1);
  const [hasUserAdjustedCluster, setHasUserAdjustedCluster] = useState(false);
  const [showIntervalTable, setShowIntervalTable] = useState(false);
  const [showTransitionTable, setShowTransitionTable] = useState(false);
  const [showWearSummaryMetrics, setShowWearSummaryMetrics] = useState(false);
  const [showDistanceGuide, setShowDistanceGuide] = useState(false);
  const [showTransitionGuide, setShowTransitionGuide] = useState(false);
  const [activePlotTab, setActivePlotTab] = useState<'distance' | 'transitions'>('distance');
  const [distanceThresholdConfig, setDistanceThresholdConfig] = useState<DistanceThresholdConfig>(
    () => sanitizeDistanceThresholdConfig()
  );
  const [isControlsCollapsed, setIsControlsCollapsed] = useState(false);
  const [intervalPage, setIntervalPage] = useState(1);
  const [transitionPage, setTransitionPage] = useState(1);
  const [intervalPageSize, setIntervalPageSize] = useState(10);
  const [transitionPageSize, setTransitionPageSize] = useState(10);
  const [clusterReadyContext, setClusterReadyContext] = useState<string | null>(null);
  const [appliedClusterSignature, setAppliedClusterSignature] = useState('[]');
  const [appliedRangeSignature, setAppliedRangeSignature] = useState('{"start":"","end":""}');
  const [appliedIncludeMonitoring, setAppliedIncludeMonitoring] = useState(true);
  const [hasAppliedWearTrendRun, setHasAppliedWearTrendRun] = useState(false);
  const [lastWearTrendRunAt, setLastWearTrendRunAt] = useState<string | null>(null);
  const hasHydratedUiPrefsRef = useRef(false);
  const hasHydratedPersistedConfigRef = useRef(false);
  const skipNextDatasetMetadataResetRef = useRef(false);
  const pendingDraftRef = useRef<DraftWearTrendConfig | null>(null);
  const draftPersistTimerRef = useRef<number | null>(null);
  const lastLoggedWearResultRef = useRef('');

  const { activeStreamingDatasetId } = useActiveStreamingDataset(filteredDatasetIds);
  const selectedDataset = filteredDatasets.find((dataset) => dataset.dinsight_id === datasetId);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    hasHydratedUiPrefsRef.current = false;

    try {
      const raw = readScoped(INSIGHTS_UI_PREFS_KEY, userId);
      if (!raw) {
        if (window.matchMedia('(max-width: 1279px)').matches) {
          setIsControlsCollapsed(true);
        }
        hasHydratedUiPrefsRef.current = true;
        return;
      }

      const parsed = JSON.parse(raw) as Partial<{
        includeMonitoring: boolean;
        showWearSummaryMetrics: boolean;
        activePlotTab: 'distance' | 'transitions';
        distanceThresholdConfig: Partial<DistanceThresholdConfig>;
        isControlsCollapsed: boolean;
      }>;

      if (typeof parsed.includeMonitoring === 'boolean') {
        setIncludeMonitoring(parsed.includeMonitoring);
      }
      if (typeof parsed.showWearSummaryMetrics === 'boolean') {
        setShowWearSummaryMetrics(parsed.showWearSummaryMetrics);
      }
      if (parsed.activePlotTab === 'distance' || parsed.activePlotTab === 'transitions') {
        setActivePlotTab(parsed.activePlotTab);
      }
      if (parsed.distanceThresholdConfig) {
        setDistanceThresholdConfig(sanitizeDistanceThresholdConfig(parsed.distanceThresholdConfig));
      }
      if (typeof parsed.isControlsCollapsed === 'boolean') {
        setIsControlsCollapsed(parsed.isControlsCollapsed);
      }
      hasHydratedUiPrefsRef.current = true;
    } catch {
      if (window.matchMedia('(max-width: 1279px)').matches) {
        setIsControlsCollapsed(true);
      }
      hasHydratedUiPrefsRef.current = true;
    }
  }, [userId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!hasHydratedUiPrefsRef.current) {
      return;
    }

    writeScoped(
      INSIGHTS_UI_PREFS_KEY,
      userId,
      JSON.stringify({
        includeMonitoring,
        showWearSummaryMetrics,
        activePlotTab,
        distanceThresholdConfig,
        isControlsCollapsed,
      })
    );
  }, [
    activePlotTab,
    distanceThresholdConfig,
    includeMonitoring,
    isControlsCollapsed,
    showWearSummaryMetrics,
    userId,
  ]);

  const metadataColumnsQuery = useQuery<string[]>({
    queryKey: ['deterioration-metadata-columns', datasetId],
    enabled: !!datasetId,
    queryFn: async () => {
      const response = await api.deterioration.getMetadata(datasetId as number);
      const columns = response?.data?.data?.columns;
      return Array.isArray(columns) ? columns : [];
    },
  });

  const { data: streamingStatus } = useQuery<StreamingStatus | null>({
    queryKey: ['insights-streaming-status', datasetId],
    enabled: !!datasetId,
    queryFn: async () => {
      if (!datasetId) {
        return null;
      }
      try {
        const response = await api.streaming.getStatus(datasetId);
        return response?.data?.success ? (response.data.data as StreamingStatus) : null;
      } catch {
        return null;
      }
    },
    staleTime: 3_000,
    refetchInterval: 3_000,
    retry: false,
  });

  const { data: userPreferences, isFetched: hasFetchedUserPreferences } = useQuery<
    Record<string, unknown>
  >({
    queryKey: ['insights-user-preferences'],
    queryFn: async () => {
      const response = await api.users.getLiveMonitorPreferences();
      return (response?.data?.data?.preferences ?? {}) as Record<string, unknown>;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const selectionContextKey = `${datasetId ?? 'none'}::${metadataColumn || 'none'}`;

  useEffect(() => {
    if (skipNextDatasetMetadataResetRef.current) {
      skipNextDatasetMetadataResetRef.current = false;
      return;
    }

    setSelectedClusterValues([]);
    setRangeStart('');
    setRangeEnd('');
    setHasUserAdjustedCluster(false);
    setClusterPage(1);
    setIntervalPage(1);
    setTransitionPage(1);
    setClusterReadyContext(null);
    setAppliedClusterSignature('[]');
    setAppliedRangeSignature('{"start":"","end":""}');
    setAppliedIncludeMonitoring(true);
    setHasAppliedWearTrendRun(false);
  }, [datasetId, metadataColumn]);

  useEffect(() => {
    if (hasHydratedPersistedConfigRef.current) {
      return;
    }
    if (!datasetId) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }

    const localConfig = parseAppliedWearTrendConfig(
      readScoped(INSIGHTS_APPLIED_WEAR_CONFIG_KEY, userId)
    );
    const localDraftConfig = parseDraftWearTrendConfig(
      readScoped(INSIGHTS_DRAFT_WEAR_CONFIG_KEY, userId)
    );
    const resolvedLocal = localDraftConfig ?? localConfig;
    if (!resolvedLocal) {
      hasHydratedPersistedConfigRef.current = true;
      return;
    }
    if (resolvedLocal.datasetId !== datasetId) {
      hasHydratedPersistedConfigRef.current = true;
      return;
    }

    skipNextDatasetMetadataResetRef.current = true;
    setMetadataColumn(resolvedLocal.metadataColumn);
    setIncludeMonitoring(resolvedLocal.includeMonitoring);
    setSelectedClusterValues(resolvedLocal.baselineClusterValues);
    setRangeStart(resolvedLocal.baselineRange?.start ?? '');
    setRangeEnd(resolvedLocal.baselineRange?.end ?? '');
    setHasUserAdjustedCluster(
      resolvedLocal.baselineClusterValues.length > 0 || resolvedLocal.baselineRange != null
    );
    setAppliedClusterSignature(
      JSON.stringify(Array.from(new Set(resolvedLocal.baselineClusterValues)).sort())
    );
    setAppliedRangeSignature(
      JSON.stringify({
        start: resolvedLocal.baselineRange?.start ?? '',
        end: resolvedLocal.baselineRange?.end ?? '',
      })
    );
    setAppliedIncludeMonitoring(resolvedLocal.includeMonitoring);

    if (localConfig) {
      setHasAppliedWearTrendRun(true);
      setLastWearTrendRunAt(localConfig.appliedAt);
    }
    hasHydratedPersistedConfigRef.current = true;
  }, [datasetId, userId]);

  useEffect(() => {
    if (!hasFetchedUserPreferences) {
      return;
    }
    if (!datasetId) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }

    const localConfig = parseAppliedWearTrendConfig(
      readScoped(INSIGHTS_APPLIED_WEAR_CONFIG_KEY, userId)
    );
    const serverConfig = parseAppliedWearTrendConfigFromUnknown(
      userPreferences?.[INSIGHTS_WEAR_PREFS_FIELD]
    );
    const localDraftConfig = parseDraftWearTrendConfig(
      readScoped(INSIGHTS_DRAFT_WEAR_CONFIG_KEY, userId)
    );
    const serverDraftConfig = parseDraftWearTrendConfigFromUnknown(
      userPreferences?.[INSIGHTS_DRAFT_WEAR_PREFS_FIELD]
    );
    const resolvedDraft = pickNewestDraftWearConfig(localDraftConfig, serverDraftConfig);
    const resolvedApplied = pickNewestWearConfig(localConfig, serverConfig);

    const resolved = resolvedDraft ?? resolvedApplied;
    if (!resolved) {
      return;
    }
    if (resolved.datasetId !== datasetId) {
      return;
    }

    skipNextDatasetMetadataResetRef.current = true;
    setMetadataColumn(resolved.metadataColumn);
    setIncludeMonitoring(resolved.includeMonitoring);
    setSelectedClusterValues(resolved.baselineClusterValues);
    setRangeStart(resolved.baselineRange?.start ?? '');
    setRangeEnd(resolved.baselineRange?.end ?? '');
    setHasUserAdjustedCluster(
      resolved.baselineClusterValues.length > 0 || resolved.baselineRange != null
    );

    const resolvedClusterSignature = JSON.stringify(
      Array.from(new Set(resolved.baselineClusterValues)).sort()
    );
    const resolvedRangeSignature = JSON.stringify({
      start: resolved.baselineRange?.start ?? '',
      end: resolved.baselineRange?.end ?? '',
    });
    setAppliedClusterSignature(resolvedClusterSignature);
    setAppliedRangeSignature(resolvedRangeSignature);
    setAppliedIncludeMonitoring(resolved.includeMonitoring);
    if (resolvedApplied) {
      setHasAppliedWearTrendRun(true);
      setLastWearTrendRunAt(resolvedApplied.appliedAt);
      writeScoped(INSIGHTS_APPLIED_WEAR_CONFIG_KEY, userId, JSON.stringify(resolvedApplied));
      window.dispatchEvent(new CustomEvent(INSIGHTS_APPLIED_WEAR_CONFIG_EVENT));
    }

    if (resolvedDraft) {
      writeScoped(INSIGHTS_DRAFT_WEAR_CONFIG_KEY, userId, JSON.stringify(resolvedDraft));
    }
  }, [datasetId, hasFetchedUserPreferences, userPreferences, userId]);

  const persistWearConfigToServer = useCallback(async (nextConfig: AppliedWearTrendConfig) => {
    try {
      const latest = await api.users.getLiveMonitorPreferences();
      const existing = (latest?.data?.data?.preferences ?? {}) as Record<string, unknown>;
      await api.users.updateLiveMonitorPreferences({
        ...existing,
        [INSIGHTS_WEAR_PREFS_FIELD]: nextConfig,
      });
    } catch {
      // Silent fallback: local persistence still applies.
    }
  }, []);

  const persistWearDraftToServer = useCallback(async (nextConfig: DraftWearTrendConfig) => {
    try {
      const latest = await api.users.getLiveMonitorPreferences();
      const existing = (latest?.data?.data?.preferences ?? {}) as Record<string, unknown>;
      await api.users.updateLiveMonitorPreferences({
        ...existing,
        [INSIGHTS_DRAFT_WEAR_PREFS_FIELD]: nextConfig,
      });
    } catch {
      // Silent fallback: local persistence still applies.
    }
  }, []);

  useEffect(() => {
    if (!datasetId || !metadataColumn) {
      return;
    }

    const nextDraftConfig: DraftWearTrendConfig = {
      datasetId,
      metadataColumn,
      includeMonitoring,
      baselineClusterValues: Array.from(new Set(selectedClusterValues)).sort(),
      baselineRange: rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null,
      updatedAt: new Date().toISOString(),
    };

    if (typeof window !== 'undefined') {
      writeScoped(INSIGHTS_DRAFT_WEAR_CONFIG_KEY, userId, JSON.stringify(nextDraftConfig));
    }

    pendingDraftRef.current = nextDraftConfig;

    if (draftPersistTimerRef.current) {
      window.clearTimeout(draftPersistTimerRef.current);
    }
    draftPersistTimerRef.current = window.setTimeout(() => {
      void persistWearDraftToServer(nextDraftConfig);
      draftPersistTimerRef.current = null;
    }, 700);

    return undefined;
  }, [
    datasetId,
    metadataColumn,
    includeMonitoring,
    selectedClusterValues,
    rangeStart,
    rangeEnd,
    persistWearDraftToServer,
    userId,
  ]);

  useEffect(
    () => () => {
      if (draftPersistTimerRef.current) {
        window.clearTimeout(draftPersistTimerRef.current);
        draftPersistTimerRef.current = null;
      }
      if (pendingDraftRef.current) {
        void persistWearDraftToServer(pendingDraftRef.current);
      }
    },
    [persistWearDraftToServer]
  );

  const clusterSignature = useMemo(
    () => JSON.stringify(Array.from(new Set(selectedClusterValues)).sort()),
    [selectedClusterValues]
  );
  const rangeSignature = useMemo(
    () => JSON.stringify({ start: rangeStart, end: rangeEnd }),
    [rangeEnd, rangeStart]
  );
  const deferredMetadataColumn = useDeferredValue(metadataColumn);
  const deferredIncludeMonitoring = useDeferredValue(appliedIncludeMonitoring);
  const deferredClusterSignature = useDeferredValue(appliedClusterSignature);
  const deferredRangeSignature = useDeferredValue(appliedRangeSignature);
  const shouldLiveRefreshWearTrend =
    hasAppliedWearTrendRun && Boolean(datasetId && deferredMetadataColumn);

  const wearTrendQuery = useQuery<DeteriorationResult | null>({
    queryKey: [
      'insights-wear-trend',
      datasetId,
      deferredMetadataColumn,
      deferredIncludeMonitoring,
      deferredClusterSignature,
      deferredRangeSignature,
    ],
    enabled: Boolean(datasetId && deferredMetadataColumn),
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    refetchInterval:
      streamingStatus?.is_active && shouldLiveRefreshWearTrend && deferredIncludeMonitoring
        ? 2_000
        : false,
    queryFn: async () => {
      if (!datasetId || !deferredMetadataColumn) {
        return null;
      }

      const parsedClusterValues = (() => {
        try {
          const parsed = JSON.parse(deferredClusterSignature) as string[];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [] as string[];
        }
      })();

      const parsedRange = (() => {
        try {
          const parsed = JSON.parse(deferredRangeSignature) as { start?: string; end?: string };
          return { start: parsed?.start ?? '', end: parsed?.end ?? '' };
        } catch {
          return { start: '', end: '' };
        }
      })();

      const payload: {
        metadata_column: string;
        include_monitoring: boolean;
        baseline_cluster: { values: string[]; range?: { start: string; end: string } };
      } = {
        metadata_column: deferredMetadataColumn,
        include_monitoring: deferredIncludeMonitoring,
        baseline_cluster: {
          values: parsedClusterValues,
        },
      };

      if (parsedRange.start && parsedRange.end) {
        payload.baseline_cluster.range = { start: parsedRange.start, end: parsedRange.end };
      }

      const response = await api.deterioration.analyze(datasetId, payload);
      if (!response?.data?.data) {
        throw new Error('Wear trend analysis returned no result for this dataset.');
      }

      return (response.data.data as DeteriorationResult) ?? null;
    },
  });

  const wearResult = wearTrendQuery.data ?? null;
  const wearError = wearTrendQuery.error
    ? (wearTrendQuery.error as any)?.response?.data?.message ||
      (wearTrendQuery.error as Error).message ||
      'Failed to run wear trend analysis.'
    : null;
  const { isFetching: isFetchingWearTrend } = wearTrendQuery;
  const isClusterSelectionReady =
    Boolean(metadataColumn) && clusterReadyContext === selectionContextKey;
  const hasSelectedClusterValues = selectedClusterValues.length > 0;
  const hasSelectedClusterRange = Boolean(rangeStart && rangeEnd);
  const hasPartialClusterRange = Boolean(rangeStart || rangeEnd) && !hasSelectedClusterRange;
  const isBaselineSelectionApplied =
    hasUserAdjustedCluster && (hasSelectedClusterValues || hasSelectedClusterRange);
  const isSelectionAppliedToQuery =
    clusterSignature === appliedClusterSignature &&
    rangeSignature === appliedRangeSignature &&
    includeMonitoring === appliedIncludeMonitoring;
  const hasPendingChanges = hasAppliedWearTrendRun && !isSelectionAppliedToQuery;
  const isUpdatingWearTrend = isFetchingWearTrend && Boolean(wearResult) && hasPendingChanges;
  const shouldRenderWearPlots =
    Boolean(wearResult) &&
    hasAppliedWearTrendRun &&
    isSelectionAppliedToQuery &&
    isBaselineSelectionApplied;
  const canRunWearTrend =
    Boolean(datasetId) &&
    Boolean(metadataColumn) &&
    isClusterSelectionReady &&
    !hasPartialClusterRange &&
    (hasSelectedClusterValues || hasSelectedClusterRange) &&
    !isFetchingWearTrend;

  useEffect(() => {
    if (!wearResult || !datasetId || !hasAppliedWearTrendRun) {
      return;
    }

    const signature = `${datasetId}:${wearResult.metadata_column}:${wearResult.intervals.length}:${wearResult.stats.monitoring_point_count}`;
    if (signature === lastLoggedWearResultRef.current) {
      return;
    }
    lastLoggedWearResultRef.current = signature;

    logActivity({
      type: 'analysis',
      title: `Wear trend result ready for dataset #${datasetId}`,
      description: `${wearResult.intervals.length.toLocaleString()} intervals analyzed: ${wearResult.stats.baseline_point_count.toLocaleString()} baseline points and ${wearResult.stats.monitoring_point_count.toLocaleString()} monitoring points.`,
      datasetId,
      href: '/dashboard/insights',
      status: 'success',
    });
  }, [datasetId, hasAppliedWearTrendRun, logActivity, wearResult]);

  useEffect(() => {
    if (!wearResult) {
      return;
    }
    setClusterReadyContext(selectionContextKey);
  }, [selectionContextKey, wearResult]);

  const baselineIntervalValues = useMemo(() => {
    const values = (wearResult?.intervals ?? [])
      .filter((interval) => interval.dataset_type === 'baseline')
      .map((interval) => interval.metadata_value);
    return Array.from(new Set(values));
  }, [wearResult?.intervals]);
  const activeBaselineClusterLabels = useMemo(
    () => new Set(wearResult?.g0?.labels ?? []),
    [wearResult?.g0?.labels]
  );
  const transitionRows = useMemo(() => {
    const rows = wearResult?.distances.gi_to_gi_plus_1 ?? [];
    if (activeBaselineClusterLabels.size === 0) {
      return rows;
    }

    return rows.filter((row) => {
      const fromAllowed =
        row.from_dataset_type !== 'baseline' || activeBaselineClusterLabels.has(row.from_label);
      const toAllowed =
        row.to_dataset_type !== 'baseline' || activeBaselineClusterLabels.has(row.to_label);
      return fromAllowed && toAllowed;
    });
  }, [activeBaselineClusterLabels, wearResult?.distances.gi_to_gi_plus_1]);

  const filteredBaselineIntervalValues = useMemo(() => {
    if (!clusterFilterText.trim()) {
      return baselineIntervalValues;
    }

    const search = clusterFilterText.toLowerCase();
    return baselineIntervalValues.filter((value) => value.toLowerCase().includes(search));
  }, [baselineIntervalValues, clusterFilterText]);
  const clusterTotalPages = Math.max(
    1,
    Math.ceil(filteredBaselineIntervalValues.length / BASELINE_CLUSTER_PAGE_SIZE)
  );
  const currentClusterPage = Math.min(Math.max(clusterPage, 1), clusterTotalPages);
  const clusterPageStartIndex = (currentClusterPage - 1) * BASELINE_CLUSTER_PAGE_SIZE;
  const pagedBaselineIntervalValues = useMemo(() => {
    return filteredBaselineIntervalValues.slice(
      clusterPageStartIndex,
      clusterPageStartIndex + BASELINE_CLUSTER_PAGE_SIZE
    );
  }, [clusterPageStartIndex, filteredBaselineIntervalValues]);
  const selectedClusterSet = useMemo(() => new Set(selectedClusterValues), [selectedClusterValues]);

  useEffect(() => {
    setClusterPage(1);
  }, [clusterFilterText, metadataColumn]);

  useEffect(() => {
    setClusterPage((page) => Math.min(Math.max(page, 1), clusterTotalPages));
  }, [clusterTotalPages]);

  const toggleClusterValue = (value: string) => {
    setSelectedClusterValues((current) => {
      if (current.includes(value)) {
        return current.filter((entry) => entry !== value);
      }
      return [...current, value];
    });
    setHasUserAdjustedCluster(true);
  };

  const selectAllClusters = () => {
    setSelectedClusterValues(baselineIntervalValues);
    setHasUserAdjustedCluster(true);
  };

  const clearAllClusters = () => {
    setSelectedClusterValues([]);
    setHasUserAdjustedCluster(true);
  };

  const selectFilteredClusters = () => {
    setSelectedClusterValues((current) => {
      const next = new Set(current);
      filteredBaselineIntervalValues.forEach((value) => next.add(value));
      return Array.from(next);
    });
    setHasUserAdjustedCluster(true);
  };

  const resetClusterSelection = () => {
    setSelectedClusterValues(wearResult?.g0?.labels ?? []);
    setRangeStart('');
    setRangeEnd('');
    setHasUserAdjustedCluster(true);
  };

  const applyWearTrendSelection = useCallback(() => {
    if (!datasetId || !metadataColumn) {
      return;
    }

    if (hasPartialClusterRange) {
      return;
    }

    if (!hasSelectedClusterValues && !hasSelectedClusterRange) {
      return;
    }

    setHasAppliedWearTrendRun(true);
    setAppliedClusterSignature(clusterSignature);
    setAppliedRangeSignature(rangeSignature);
    setAppliedIncludeMonitoring(includeMonitoring);
    setLastWearTrendRunAt(new Date().toISOString());
    setIntervalPage(1);
    setTransitionPage(1);
    logActivity({
      type: 'analysis',
      title: `Wear trend run for dataset #${datasetId}`,
      description: `${metadataColumn} with ${
        selectedClusterValues.length
      } selected baseline interval(s)${rangeStart && rangeEnd ? ' plus a baseline range' : ''}.`,
      datasetId,
      href: '/dashboard/insights',
      status: 'info',
    });

    if (typeof window !== 'undefined') {
      const dedupedValues = Array.from(new Set(selectedClusterValues)).sort();
      const baselineRange = rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : null;
      const nextConfig: AppliedWearTrendConfig = {
        datasetId,
        metadataColumn,
        includeMonitoring,
        baselineClusterValues: dedupedValues,
        baselineRange,
        appliedAt: new Date().toISOString(),
      };
      writeScoped(INSIGHTS_APPLIED_WEAR_CONFIG_KEY, userId, JSON.stringify(nextConfig));
      window.dispatchEvent(new CustomEvent(INSIGHTS_APPLIED_WEAR_CONFIG_EVENT));
      void persistWearConfigToServer(nextConfig);
    }
  }, [
    clusterSignature,
    datasetId,
    hasPartialClusterRange,
    hasSelectedClusterRange,
    hasSelectedClusterValues,
    includeMonitoring,
    metadataColumn,
    rangeSignature,
    rangeEnd,
    rangeStart,
    selectedClusterValues,
    persistWearConfigToServer,
    userId,
    logActivity,
  ]);

  const resetToLastAppliedSelection = () => {
    try {
      const parsedValues = JSON.parse(appliedClusterSignature) as string[];
      const parsedRange = JSON.parse(appliedRangeSignature) as { start?: string; end?: string };

      setSelectedClusterValues(Array.isArray(parsedValues) ? parsedValues : []);
      setRangeStart(parsedRange?.start ?? '');
      setRangeEnd(parsedRange?.end ?? '');
      setIncludeMonitoring(appliedIncludeMonitoring);
      setHasUserAdjustedCluster(true);
    } catch {
      setSelectedClusterValues([]);
      setRangeStart('');
      setRangeEnd('');
      setHasUserAdjustedCluster(false);
    }
  };

  const resetCurrentConfiguration = () => {
    setSelectedClusterValues([]);
    setRangeStart('');
    setRangeEnd('');
    setClusterFilterText('');
    setIncludeMonitoring(true);
    setHasUserAdjustedCluster(false);
    setHasAppliedWearTrendRun(false);
    setAppliedClusterSignature('[]');
    setAppliedRangeSignature('{"start":"","end":""}');
    setAppliedIncludeMonitoring(true);
    setLastWearTrendRunAt(null);
  };

  const updateDistanceThresholdConfig = (updates: Partial<DistanceThresholdConfig>) => {
    setDistanceThresholdConfig((current) =>
      sanitizeDistanceThresholdConfig({ ...current, ...updates })
    );
  };

  const resetDistanceThresholdConfig = () => {
    setDistanceThresholdConfig(sanitizeDistanceThresholdConfig());
  };

  const exportCSV = useCallback(
    (rows: Array<Record<string, string | number>>, filename: string) => {
      if (rows.length === 0) {
        return;
      }

      const columns = Object.keys(rows[0]);
      const escape = (value: string | number) => {
        const serialized = String(value ?? '');
        if (/[",\n]/.test(serialized)) {
          return `"${serialized.replace(/"/g, '""')}"`;
        }
        return serialized;
      };

      const csv =
        `${columns.join(',')}\n` +
        rows.map((row) => columns.map((column) => escape(row[column] ?? '')).join(',')).join('\n');

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },
    []
  );

  const distanceSummary = useMemo(() => {
    if (!wearResult?.intervals?.length) {
      const thresholds = deriveDistanceThresholds([], null, distanceThresholdConfig);
      return {
        baseline: null as number | null,
        monitoring: null as number | null,
        delta: null as number | null,
        warningDelta: null as number | null,
        warningThreshold: thresholds.warning,
        dangerThreshold: thresholds.danger,
        thresholdSource: thresholds.source,
      };
    }

    const selectedBaselineDistances = wearResult.intervals
      .filter((interval) => interval.dataset_type === 'baseline' && interval.is_baseline_cluster)
      .map((interval) => interval.distance_from_g0)
      .filter((value) => Number.isFinite(value));
    const allBaselineDistances = wearResult.intervals
      .filter((interval) => interval.dataset_type === 'baseline')
      .map((interval) => interval.distance_from_g0)
      .filter((value) => Number.isFinite(value));
    const monitoringDistances = wearResult.intervals
      .filter((interval) => interval.dataset_type === 'monitoring')
      .map((interval) => interval.distance_from_g0)
      .filter((value) => Number.isFinite(value));

    const baseline = mean(
      selectedBaselineDistances.length ? selectedBaselineDistances : allBaselineDistances
    );
    const monitoring = mean(monitoringDistances);
    const delta = baseline != null && monitoring != null ? monitoring - baseline : null;
    const thresholdBaselineDistances = selectedBaselineDistances.length
      ? selectedBaselineDistances
      : allBaselineDistances;
    const thresholds = deriveDistanceThresholds(
      thresholdBaselineDistances,
      baseline,
      distanceThresholdConfig
    );

    return {
      baseline,
      monitoring,
      delta,
      warningDelta:
        baseline != null && thresholds.warning >= baseline ? thresholds.warning - baseline : null,
      warningThreshold: thresholds.warning,
      dangerThreshold: thresholds.danger,
      thresholdSource: thresholds.source,
    };
  }, [distanceThresholdConfig, wearResult?.intervals]);

  const distanceEChart = useMemo(() => {
    if (!shouldRenderWearPlots || !wearResult?.intervals?.length) {
      return null;
    }

    const sorted = [...wearResult.intervals].sort((a, b) => a.sort_index - b.sort_index);
    const xValues = sorted.map((interval) => interval.sort_index);
    const labelByX = new Map(
      sorted.map((interval) => [interval.sort_index, interval.metadata_value])
    );
    const warningThreshold = distanceSummary.warningThreshold;
    const dangerThreshold = distanceSummary.dangerThreshold;
    const distanceValues = sorted
      .map((interval) => interval.distance_from_g0)
      .filter((value) => Number.isFinite(value) && value >= 0);
    const xAxisRange = buildPaddedAxisRange(xValues, { minSpan: 1, paddingRatio: 0.03 });
    const yAxisRange = buildPaddedAxisRange(
      [...distanceValues, DISTANCE_AXIS_BASE_MAX, warningThreshold, dangerThreshold],
      {
        includeZero: true,
        lowerBound: 0,
        minSpan: 0.25,
        paddingRatio: 0.08,
      }
    );
    const baselineSeries = sorted.map((interval) =>
      interval.dataset_type === 'baseline' ? interval.distance_from_g0 : null
    );
    const monitoringSeries = sorted.map((interval) =>
      interval.dataset_type === 'monitoring' ? interval.distance_from_g0 : null
    );
    const baselineRollingSeries = rollingMean(baselineSeries, 12);
    const monitoringRollingSeries = rollingMean(monitoringSeries, 12);
    const monitoringIndices = sorted
      .map((interval, index) => (interval.dataset_type === 'monitoring' ? index : -1))
      .filter((index) => index >= 0);
    const recentMonitoringIndexSet = new Set(
      monitoringIndices.slice(
        Math.max(0, monitoringIndices.length - STREAMING_MONITORING_EMPHASIS_POINTS)
      )
    );
    const firstWarningIndex = sorted.findIndex(
      (interval) =>
        interval.dataset_type === 'monitoring' && interval.distance_from_g0 >= warningThreshold
    );
    const firstDangerIndex = sorted.findIndex(
      (interval) =>
        interval.dataset_type === 'monitoring' && interval.distance_from_g0 >= dangerThreshold
    );
    const crossingIndex = firstDangerIndex >= 0 ? firstDangerIndex : firstWarningIndex;
    const crossingInterval = crossingIndex >= 0 ? sorted[crossingIndex] : null;
    const crossingTone = firstDangerIndex >= 0 ? 'danger' : 'warning';
    const crossingColor = crossingTone === 'danger' ? plotTheme.danger : plotTheme.warning;
    const latestMonitoringIndex = monitoringIndices.at(-1);
    const latestInterval =
      latestMonitoringIndex != null && latestMonitoringIndex >= 0
        ? sorted[latestMonitoringIndex]
        : null;

    const toPoint = (
      interval: DeteriorationInterval,
      extraType: 'Baseline' | 'Monitoring' = interval.dataset_type === 'baseline'
        ? 'Baseline'
        : 'Monitoring'
    ) => [
      interval.sort_index,
      interval.distance_from_g0,
      interval.metadata_value,
      interval.point_count,
      extraType,
    ];
    const toLinePoint = (index: number, value: number | null, label: string) =>
      value == null ? null : [sorted[index].sort_index, value, label, sorted[index].metadata_value];
    const selectedBaselineBands = sorted
      .filter((interval) => interval.is_baseline_cluster)
      .reduce<Array<{ start: number; end: number }>>((ranges, interval) => {
        const start = interval.sort_index - 0.45;
        const end = interval.sort_index + 0.45;
        const last = ranges.at(-1);
        if (last && start <= last.end + 0.05) {
          last.end = Math.max(last.end, end);
          return ranges;
        }
        ranges.push({ start, end });
        return ranges;
      }, []);

    const markAreaData: any[] = [
      [
        { yAxis: warningThreshold, itemStyle: { color: alphaColor(plotTheme.warning, 0.08) } },
        { yAxis: dangerThreshold },
      ],
      [
        { yAxis: dangerThreshold, itemStyle: { color: alphaColor(plotTheme.danger, 0.07) } },
        { yAxis: yAxisRange?.[1] ?? dangerThreshold + 0.5 },
      ],
      ...selectedBaselineBands.map((range) => [
        { xAxis: range.start, itemStyle: { color: plotTheme.baselineSoft } },
        { xAxis: range.end },
      ]),
    ];

    const formatAxisLabel = (value: number) => {
      const roundedValue = Math.round(value);
      if (Math.abs(value - roundedValue) > 0.05) {
        return '';
      }
      const label = labelByX.get(roundedValue);
      return label ? formatIntervalTick(label).replace('<br>', '\n') : `#${roundedValue}`;
    };
    const formatDistanceAxisLabel = (value: number) =>
      Number(value).toLocaleString(undefined, {
        maximumFractionDigits: Math.abs(value) >= 10 ? 1 : 2,
      });

    const tooltipFormatter = (params: any) => {
      const item = Array.isArray(params) ? params[0] : params;
      const value = item?.data?.value ?? item?.data;
      if (!Array.isArray(value)) {
        return '';
      }

      if (/threshold/i.test(item.seriesName ?? '')) {
        return `<b>${item.seriesName}</b><br/>Distance: ${Number(value[1]).toFixed(4)}`;
      }

      if (
        item.seriesName === 'Baseline rolling mean' ||
        item.seriesName === 'Monitoring rolling mean'
      ) {
        return `<b>${item.seriesName}</b><br/>Interval: ${value[3] ?? value[2]}<br/>Distance: ${Number(value[1]).toFixed(4)}`;
      }

      const pointCount = value[3] != null ? `<br/>${Number(value[3]).toLocaleString()} pts` : '';
      return `<b>${item.seriesName}</b><br/>Interval: ${value[2] ?? formatAxisLabel(value[0])}${pointCount}<br/>Distance: ${Number(value[1]).toFixed(4)}`;
    };

    const option: EChartsOption = {
      animation: false,
      backgroundColor: 'transparent',
      color: [
        plotTheme.baseline,
        plotTheme.baselineRolling,
        plotTheme.warning,
        plotTheme.danger,
        plotTheme.monitoring,
        plotTheme.monitoringRolling,
        plotTheme.latest,
      ],
      tooltip: {
        trigger: 'item',
        confine: true,
        axisPointer: { type: 'cross' },
        formatter: tooltipFormatter,
      },
      legend: {
        type: 'scroll',
        top: 0,
        left: 4,
        right: 150,
        itemWidth: 12,
        itemHeight: 8,
      },
      toolbox: {
        show: true,
        right: 8,
        top: 0,
        feature: {
          dataZoom: { yAxisIndex: 'none' },
          brush: { type: ['rect', 'polygon', 'lineX', 'lineY', 'keep', 'clear'] },
          restore: {},
          saveAsImage: { pixelRatio: 2 },
        },
      },
      brush: {
        toolbox: ['rect', 'polygon', 'lineX', 'lineY', 'keep', 'clear'],
        xAxisIndex: 0,
        brushMode: 'multiple',
        throttleType: 'debounce',
        throttleDelay: 250,
      },
      grid: { top: 64, right: 72, bottom: 104, left: 82, containLabel: true },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        { type: 'slider', xAxisIndex: 0, filterMode: 'none', height: 24, bottom: 34 },
        { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
        { type: 'slider', yAxisIndex: 0, filterMode: 'none', width: 18, right: 18 },
      ],
      xAxis: {
        type: 'value',
        name: `${wearResult.metadata_column} (Interval Order)`,
        nameLocation: 'middle',
        nameGap: 46,
        min: xAxisRange?.[0],
        max: xAxisRange?.[1],
        axisLabel: { formatter: formatAxisLabel, hideOverlap: true },
        splitLine: { lineStyle: { color: alphaColor(plotTheme.chartGrid, 0.75) } },
      },
      yAxis: {
        type: 'value',
        name: 'Distance from baseline reference G0',
        nameLocation: 'middle',
        nameGap: 56,
        min: yAxisRange?.[0],
        max: yAxisRange?.[1],
        axisLabel: { formatter: formatDistanceAxisLabel },
        splitLine: { lineStyle: { color: alphaColor(plotTheme.chartGrid, 0.75) } },
      },
      series: [
        {
          type: 'line',
          name: 'Baseline',
          data: sorted
            .filter((interval) => interval.dataset_type === 'baseline')
            .map((interval) => toPoint(interval, 'Baseline')),
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 5.5,
          lineStyle: { width: 1.4, color: alphaColor(plotTheme.baseline, 0.38) },
          itemStyle: { color: alphaColor(plotTheme.baseline, 0.82), borderWidth: 0 },
          emphasis: { focus: 'series', scale: 1.4 },
          connectNulls: false,
          progressive: 800,
          markArea: { silent: true, data: markAreaData },
        },
        {
          type: 'line',
          name: 'Baseline rolling mean',
          data: baselineRollingSeries
            .map((value, index) => toLinePoint(index, value, 'Baseline rolling mean'))
            .filter(Boolean),
          showSymbol: false,
          lineStyle: { color: plotTheme.baselineRolling, width: 4 },
          progressive: 800,
        },
        {
          type: 'line',
          name: `Warning threshold (${warningThreshold.toFixed(3)})`,
          data: [
            [xAxisRange?.[0] ?? xValues[0] ?? 0, warningThreshold],
            [xAxisRange?.[1] ?? xValues.at(-1) ?? 1, warningThreshold],
          ],
          showSymbol: false,
          lineStyle: { color: plotTheme.warning, width: 2, type: 'dotted' },
        },
        {
          type: 'line',
          name: `Danger threshold (${dangerThreshold.toFixed(3)})`,
          data: [
            [xAxisRange?.[0] ?? xValues[0] ?? 0, dangerThreshold],
            [xAxisRange?.[1] ?? xValues.at(-1) ?? 1, dangerThreshold],
          ],
          showSymbol: false,
          lineStyle: { color: plotTheme.danger, width: 2, type: 'dotted' },
        },
        {
          type: 'line',
          name: 'Monitoring history',
          data: sorted
            .filter(
              (interval, index) =>
                interval.dataset_type === 'monitoring' && !recentMonitoringIndexSet.has(index)
            )
            .map((interval) => toPoint(interval, 'Monitoring')),
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 4.5,
          lineStyle: { color: alphaColor(plotTheme.monitoring, 0.14), width: 1.1 },
          itemStyle: { color: alphaColor(plotTheme.monitoring, 0.28), borderWidth: 0 },
          emphasis: { focus: 'series', scale: 1.35 },
          connectNulls: false,
          progressive: 800,
        },
        {
          type: 'line',
          name: 'Monitoring recent',
          data: sorted
            .filter(
              (interval, index) =>
                interval.dataset_type === 'monitoring' && recentMonitoringIndexSet.has(index)
            )
            .map((interval) => toPoint(interval, 'Monitoring')),
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 5.5,
          lineStyle: { color: alphaColor(plotTheme.monitoring, 0.68), width: 1.8 },
          itemStyle: { color: alphaColor(plotTheme.monitoring, 0.9), borderWidth: 0 },
          emphasis: { focus: 'series', scale: 1.4 },
          connectNulls: false,
          progressive: 800,
        },
        {
          type: 'line',
          name: 'Monitoring rolling mean',
          data: monitoringRollingSeries
            .map((value, index) => toLinePoint(index, value, 'Monitoring rolling mean'))
            .filter(Boolean),
          showSymbol: false,
          lineStyle: { color: plotTheme.monitoringRolling, width: 4 },
          progressive: 800,
        },
        ...(latestInterval
          ? [
              {
                type: 'scatter',
                name: 'Latest interval',
                data: [toPoint(latestInterval, 'Monitoring')],
                symbolSize: 14,
                itemStyle: {
                  color: plotTheme.latest,
                  borderColor: plotTheme.latestLine,
                  borderWidth: 2,
                },
                z: 20,
              },
            ]
          : []),
        ...(crossingInterval
          ? [
              {
                type: 'scatter',
                name: crossingTone === 'danger' ? 'Danger crossing' : 'Warning crossing',
                data: [toPoint(crossingInterval, 'Monitoring')],
                symbol: 'diamond',
                symbolSize: 14,
                itemStyle: {
                  color: crossingColor,
                  borderColor: plotTheme.surface,
                  borderWidth: 1.5,
                },
                z: 21,
                markLine: {
                  silent: true,
                  symbol: 'none',
                  lineStyle: {
                    color: crossingColor,
                    width: 2,
                    type: crossingTone === 'danger' ? 'dashed' : 'solid',
                  },
                  data: [{ xAxis: crossingInterval.sort_index }],
                },
              },
            ]
          : []),
      ] as any,
    };

    return { option };
  }, [distanceSummary, plotTheme, shouldRenderWearPlots, wearResult]);

  const transitionPlot = useMemo(() => {
    if (!shouldRenderWearPlots) {
      return null;
    }

    const transitions = transitionRows;
    if (transitions.length === 0) {
      return null;
    }

    const xValues = transitions.map((_, index) => index + 1);
    const maxTicks = 8;
    const tickStep = Math.max(1, Math.ceil(xValues.length / maxTicks));
    const tickVals: number[] = [];
    const tickText: string[] = [];

    xValues.forEach((value, index) => {
      if (index % tickStep === 0 || index === xValues.length - 1) {
        tickVals.push(value);
        tickText.push(`#${value}`);
      }
    });
    const baselineTransitionDistances = transitions
      .filter(
        (transition) =>
          transition.from_dataset_type === 'baseline' && transition.to_dataset_type === 'baseline'
      )
      .map((transition) => transition.distance);
    const monitoringTransitionDistances = transitions
      .filter(
        (transition) =>
          transition.from_dataset_type === 'monitoring' &&
          transition.to_dataset_type === 'monitoring'
      )
      .map((transition) => transition.distance);
    const baselineTransitionMean = mean(baselineTransitionDistances);
    const monitoringTransitionMean = mean(monitoringTransitionDistances);
    const transitionMeanMarkData = [
      ...(baselineTransitionMean != null
        ? [
            {
              name: `Baseline mean ${baselineTransitionMean.toFixed(3)}`,
              yAxis: baselineTransitionMean,
              lineStyle: { color: plotTheme.baseline, type: 'dotted', width: 2 },
              label: { formatter: 'Baseline mean' },
            },
          ]
        : []),
      ...(monitoringTransitionMean != null
        ? [
            {
              name: `Monitoring mean ${monitoringTransitionMean.toFixed(3)}`,
              yAxis: monitoringTransitionMean,
              lineStyle: { color: plotTheme.monitoring, type: 'dashed', width: 2 },
              label: { formatter: 'Monitoring mean' },
            },
          ]
        : []),
    ];
    const transitionDistances = transitions
      .map((transition) => transition.distance)
      .filter((value) => Number.isFinite(value) && value >= 0);
    const xAxisRange = buildPaddedAxisRange(xValues, { minSpan: 1, paddingRatio: 0.03 });
    const yAxisRange = buildPaddedAxisRange([...transitionDistances, DISTANCE_AXIS_BASE_MAX], {
      includeZero: true,
      lowerBound: 0,
      minSpan: 0.25,
      paddingRatio: 0.08,
    });
    const transitionMean =
      transitionDistances.length > 0
        ? transitionDistances.reduce((sum, value) => sum + value, 0) / transitionDistances.length
        : 0;
    const transitionVariance =
      transitionDistances.length > 0
        ? transitionDistances.reduce((sum, value) => sum + (value - transitionMean) ** 2, 0) /
          transitionDistances.length
        : 0;
    const transitionStdDev = Math.sqrt(transitionVariance);
    const spikeThreshold = transitionMean + transitionStdDev * 2;
    const spikeTransitions = transitions
      .map((transition, index) => ({ transition, index }))
      .filter(({ transition }) => transition.distance >= spikeThreshold && transition.distance > 0);
    const transitionSeries = {
      baseline: transitions.map((transition) =>
        transition.from_dataset_type === 'baseline' && transition.to_dataset_type === 'baseline'
          ? transition.distance
          : null
      ),
      handoff: transitions.map((transition) =>
        transition.from_dataset_type !== transition.to_dataset_type ? transition.distance : null
      ),
      monitoring: transitions.map((transition) =>
        transition.from_dataset_type === 'monitoring' && transition.to_dataset_type === 'monitoring'
          ? transition.distance
          : null
      ),
    };
    const transitionPoint = (
      transition: (typeof transitions)[number],
      index: number,
      value: number | null,
      label: string
    ) => [
      xValues[index],
      value,
      transition.from_label,
      transition.to_label,
      transition.from_dataset_type === 'baseline' ? 'Baseline' : 'Monitoring',
      transition.to_dataset_type === 'baseline' ? 'Baseline' : 'Monitoring',
      label,
    ];
    const transitionTooltip = (params: any) => {
      const value = params?.data?.value ?? params?.data;
      if (!Array.isArray(value)) {
        return `<b>${params?.seriesName ?? 'Transition'}</b>`;
      }
      return `<b>${params.seriesName}</b><br/>Transition ${value[0]}: ${value[2]} → ${value[3]}<br/>Source ${value[4]} · Dest ${value[5]}<br/>Distance: ${Number(value[1]).toFixed(4)}`;
    };
    const transitionSeriesOptions: any[] = [
      {
        type: 'line',
        name: 'Baseline',
        data: transitions.map((transition, index) =>
          transitionPoint(transition, index, transitionSeries.baseline[index], 'Baseline')
        ),
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 6,
        connectNulls: false,
        lineStyle: { color: plotTheme.baseline, width: 2 },
        itemStyle: { color: plotTheme.baseline, borderWidth: 0 },
        markLine:
          transitionMeanMarkData.length > 0
            ? { silent: true, symbol: 'none', data: transitionMeanMarkData }
            : undefined,
      },
      {
        type: 'line',
        name: 'Handoff',
        data: transitions.map((transition, index) =>
          transitionPoint(transition, index, transitionSeries.handoff[index], 'Handoff')
        ),
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 7,
        connectNulls: false,
        lineStyle: { color: plotTheme.warning, width: 2, type: 'dotted' },
        itemStyle: { color: plotTheme.warning, borderWidth: 0 },
      },
      {
        type: 'line',
        name: 'Monitoring',
        data: transitions.map((transition, index) =>
          transitionPoint(transition, index, transitionSeries.monitoring[index], 'Monitoring')
        ),
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 7,
        connectNulls: false,
        lineStyle: { color: plotTheme.monitoring, width: 2.5 },
        itemStyle: { color: plotTheme.monitoring, borderWidth: 0 },
      },
    ];

    if (spikeTransitions.length > 0) {
      transitionSeriesOptions.push({
        type: 'scatter',
        name: 'Spike',
        data: spikeTransitions.map(({ transition, index }) =>
          transitionPoint(transition, index, transition.distance, 'Spike')
        ),
        symbol: 'diamond',
        symbolSize: 12,
        itemStyle: {
          color: plotTheme.danger,
          borderColor: plotTheme.surface,
          borderWidth: 1.5,
        },
        z: 12,
      });
    }
    const formatTransitionAxisLabel = (value: number) => {
      const rounded = Math.round(value);
      if (Math.abs(value - rounded) > 0.05) {
        return '';
      }
      const tickIndex = tickVals.indexOf(rounded);
      return tickIndex >= 0 ? tickText[tickIndex] : `#${rounded}`;
    };
    const formatDistanceAxisLabel = (value: number) =>
      Number(value).toLocaleString(undefined, {
        maximumFractionDigits: Math.abs(value) >= 10 ? 1 : 2,
      });
    const option: EChartsOption = {
      animation: false,
      backgroundColor: 'transparent',
      color: [plotTheme.baseline, plotTheme.warning, plotTheme.monitoring, plotTheme.danger],
      tooltip: {
        trigger: 'item',
        confine: true,
        axisPointer: { type: 'cross' },
        formatter: transitionTooltip,
      },
      legend: {
        type: 'scroll',
        top: 0,
        left: 4,
        right: 150,
        itemWidth: 12,
        itemHeight: 8,
      },
      toolbox: {
        show: true,
        right: 8,
        top: 0,
        feature: {
          dataZoom: { yAxisIndex: 'none' },
          brush: { type: ['rect', 'polygon', 'lineX', 'lineY', 'keep', 'clear'] },
          restore: {},
          saveAsImage: { pixelRatio: 2 },
        },
      },
      brush: {
        toolbox: ['rect', 'polygon', 'lineX', 'lineY', 'keep', 'clear'],
        xAxisIndex: 0,
        yAxisIndex: 0,
        brushMode: 'multiple',
        throttleType: 'debounce',
        throttleDelay: 250,
      },
      grid: { top: 64, right: 72, bottom: 106, left: 82, containLabel: true },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        { type: 'slider', xAxisIndex: 0, filterMode: 'none', height: 24, bottom: 34 },
        { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
        { type: 'slider', yAxisIndex: 0, filterMode: 'none', width: 18, right: 18 },
      ],
      xAxis: {
        type: 'value',
        name:
          wearResult?.metadata_column != null
            ? `${wearResult.metadata_column} Transition # (Gi -> Gi+1)`
            : 'Transition # (Gi -> Gi+1)',
        nameLocation: 'middle',
        nameGap: 52,
        min: xAxisRange?.[0],
        max: xAxisRange?.[1],
        axisLabel: { formatter: formatTransitionAxisLabel, hideOverlap: true },
        splitLine: { lineStyle: { color: alphaColor(plotTheme.chartGrid, 0.75) } },
      },
      yAxis: {
        type: 'value',
        name: 'Centroid movement distance (Gi->Gi+1)',
        nameLocation: 'middle',
        nameGap: 58,
        min: yAxisRange?.[0],
        max: yAxisRange?.[1],
        axisLabel: { formatter: formatDistanceAxisLabel },
        splitLine: { lineStyle: { color: alphaColor(plotTheme.chartGrid, 0.75) } },
      },
      series: transitionSeriesOptions,
    };

    return {
      option,
      spikeCount: spikeTransitions.length,
    };
  }, [plotTheme, shouldRenderWearPlots, transitionRows, wearResult?.metadata_column]);

  const latestMonitoringInterval = useMemo(() => {
    const monitoringIntervals = (wearResult?.intervals ?? [])
      .filter((interval) => interval.dataset_type === 'monitoring')
      .sort((a, b) => a.sort_index - b.sort_index);
    return monitoringIntervals.at(-1) ?? null;
  }, [wearResult?.intervals]);
  const latestMonitoringTone =
    latestMonitoringInterval == null
      ? 'neutral'
      : latestMonitoringInterval.distance_from_g0 >= distanceSummary.dangerThreshold
        ? 'danger'
        : latestMonitoringInterval.distance_from_g0 >= distanceSummary.warningThreshold
          ? 'warning'
          : 'success';
  const distanceThresholdMethodLabel =
    distanceSummary.thresholdSource === 'baseline-adaptive'
      ? `Adaptive baseline ${distanceThresholdConfig.warningSpreadMultiplier}x/${distanceThresholdConfig.dangerSpreadMultiplier}x spread`
      : distanceSummary.thresholdSource === 'baseline-statistical'
        ? `Baseline p${distanceThresholdConfig.warningPercentile}/p${distanceThresholdConfig.dangerPercentile}`
        : distanceSummary.thresholdSource === 'baseline-relative'
          ? `Baseline mean +${distanceThresholdConfig.warningRelativePercent}%/+${distanceThresholdConfig.dangerRelativePercent}%`
          : distanceSummary.thresholdSource === 'baseline-relative-fallback'
            ? 'Baseline-relative fallback'
            : 'Fixed fallback';
  const warningThresholdDescription =
    distanceSummary.thresholdSource === 'baseline-adaptive'
      ? `Adaptive baseline threshold: baseline median plus ${distanceThresholdConfig.warningSpreadMultiplier}x the selected baseline's robust spread.`
      : distanceSummary.thresholdSource === 'baseline-statistical'
        ? `Baseline statistical threshold: ${distanceThresholdConfig.warningPercentile}th percentile of selected healthy baseline distances.`
        : distanceSummary.thresholdSource === 'baseline-relative'
          ? `Baseline-relative threshold: selected baseline mean plus ${distanceThresholdConfig.warningRelativePercent}%.`
          : distanceSummary.thresholdSource === 'baseline-relative-fallback'
            ? `Fallback threshold: adaptive spread was unavailable, so warning uses selected baseline mean plus ${distanceThresholdConfig.warningRelativePercent}%.`
            : 'Fixed fallback warning threshold used because a valid selected baseline distribution is unavailable.';
  const dangerThresholdDescription =
    distanceSummary.thresholdSource === 'baseline-adaptive'
      ? `Adaptive baseline threshold: baseline median plus ${distanceThresholdConfig.dangerSpreadMultiplier}x the selected baseline's robust spread.`
      : distanceSummary.thresholdSource === 'baseline-statistical'
        ? `Baseline statistical threshold: ${distanceThresholdConfig.dangerPercentile}th percentile of selected healthy baseline distances.`
        : distanceSummary.thresholdSource === 'baseline-relative'
          ? `Baseline-relative threshold: selected baseline mean plus ${distanceThresholdConfig.dangerRelativePercent}%.`
          : distanceSummary.thresholdSource === 'baseline-relative-fallback'
            ? `Fallback threshold: adaptive spread was unavailable, so danger uses selected baseline mean plus ${distanceThresholdConfig.dangerRelativePercent}%.`
            : 'Fixed fallback danger threshold used because a valid selected baseline distribution is unavailable.';

  const insightsMachineState =
    latestMonitoringTone === 'danger'
      ? 'Failing'
      : latestMonitoringTone === 'warning'
        ? 'Deteriorating'
        : latestMonitoringTone === 'success'
          ? 'OK'
          : 'Unknown';

  useEffect(() => {
    if (!wearResult || !latestMonitoringInterval) {
      return;
    }

    setMachineHealthSnapshot({
      state: insightsMachineState,
      recommendation:
        insightsMachineState === 'Failing'
          ? 'Latest monitoring interval is beyond the danger threshold.'
          : insightsMachineState === 'Deteriorating'
            ? 'Latest monitoring interval is beyond the warning threshold.'
            : 'Latest monitoring interval remains within the selected baseline threshold model.',
      reasons: [
        `Latest distance ${latestMonitoringInterval.distance_from_g0.toFixed(3)}.`,
        `Warning ${distanceSummary.warningThreshold.toFixed(3)}, danger ${distanceSummary.dangerThreshold.toFixed(3)}.`,
        `Threshold model: ${distanceThresholdMethodLabel}.`,
      ],
      updatedAt: new Date().toISOString(),
    });
  }, [
    distanceSummary.dangerThreshold,
    distanceSummary.warningThreshold,
    distanceThresholdMethodLabel,
    insightsMachineState,
    latestMonitoringInterval,
    setMachineHealthSnapshot,
    wearResult,
  ]);

  const g0ToGiMeans = useMemo(() => {
    if (!wearResult) {
      return {
        baseline: null as number | null,
        monitoring: null as number | null,
        delta: null as number | null,
      };
    }

    const baselineDistances = wearResult.distances.g0_to_gi
      .filter((point) => point.dataset_type === 'baseline')
      .map((point) => point.distance);
    const monitoringDistances = wearResult.distances.g0_to_gi
      .filter((point) => point.dataset_type === 'monitoring')
      .map((point) => point.distance);

    const mean = (values: number[]) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

    const baseline = mean(baselineDistances);
    const monitoring = mean(monitoringDistances);
    const delta = baseline != null && monitoring != null ? monitoring - baseline : null;

    return { baseline, monitoring, delta };
  }, [wearResult]);

  const intervalRows = wearResult?.intervals ?? [];
  const intervalTotalPages = Math.max(1, Math.ceil(intervalRows.length / intervalPageSize));
  const transitionTotalPages = Math.max(1, Math.ceil(transitionRows.length / transitionPageSize));
  const pagedIntervalRows = intervalRows.slice(
    (intervalPage - 1) * intervalPageSize,
    intervalPage * intervalPageSize
  );
  const pagedTransitionRows = transitionRows.slice(
    (transitionPage - 1) * transitionPageSize,
    transitionPage * transitionPageSize
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (isTypingTarget) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        if (canRunWearTrend) {
          applyWearTrendSelection();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applyWearTrendSelection, canRunWearTrend]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action !== 'run-wear-trend') {
        return;
      }
      if (canRunWearTrend) {
        applyWearTrendSelection();
      } else {
        logActivity({
          type: 'analysis',
          title: 'Wear trend not ready',
          description: 'Select a dataset, wear trend column, and healthy baseline intervals first.',
          datasetId: datasetId ?? undefined,
          href: '/dashboard/insights',
          status: 'warning',
        });
      }
    };

    window.addEventListener(DASHBOARD_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(DASHBOARD_COMMAND_EVENT, onCommand);
  }, [applyWearTrendSelection, canRunWearTrend, datasetId, logActivity]);

  return (
    <div className="space-y-5">
      <div
        className={cn(
          'grid grid-cols-1 gap-5',
          !isControlsCollapsed && 'xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]'
        )}
      >
        {!isControlsCollapsed && (
          <Card className="min-w-0 border-border/60 xl:sticky xl:top-6 xl:max-h-[calc(100vh-6rem)] xl:overflow-hidden">
            <CardHeader className="border-b border-border/70 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base">Controls</CardTitle>
                  <CardDescription className="mt-1">
                    Baseline selection, thresholds, and analysis actions.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsControlsCollapsed(true)}
                  className="shrink-0 gap-2"
                  aria-label="Hide controls"
                >
                  <PanelLeftClose className="h-4 w-4" />
                  Hide
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5 py-4 xl:max-h-[calc(100vh-13rem)] xl:overflow-y-auto">
              <div className="space-y-3 rounded-lg border border-input bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Active dataset
                    </p>
                    <p className="mt-1 text-xl font-semibold text-fg">
                      {datasetId ? `#${datasetId}` : 'None'}
                    </p>
                  </div>
                  <Badge variant={canRunWearTrend ? 'secondary' : 'outline'}>
                    {canRunWearTrend ? 'Ready' : 'Configure'}
                  </Badge>
                </div>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={
                    selectedDataset?.source.originalFileName ??
                    selectedDataset?.source.deviceName ??
                    selectedDataset?.source.deviceSlug ??
                    undefined
                  }
                >
                  {selectedDataset?.source.originalFileName ??
                    selectedDataset?.source.deviceName ??
                    selectedDataset?.source.deviceSlug ??
                    'No dataset source selected'}
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Source set</p>
                    <p className="font-semibold">
                      {isLoadingDatasets ? 'Loading' : filteredDatasets.length.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Stream</p>
                    <p className="font-semibold">
                      {activeStreamingDatasetId === datasetId ? 'Active' : 'Idle'}
                    </p>
                  </div>
                </div>
                {(hasPendingChanges ||
                  lastWearTrendRunAt ||
                  (streamingStatus?.is_active &&
                    hasAppliedWearTrendRun &&
                    appliedIncludeMonitoring)) && (
                  <div className="flex flex-wrap gap-2">
                    {hasPendingChanges && <Badge variant="outline">Selection changed</Badge>}
                    {streamingStatus?.is_active &&
                      hasAppliedWearTrendRun &&
                      appliedIncludeMonitoring && <Badge variant="outline">Live updating</Badge>}
                    {lastWearTrendRunAt && (
                      <Badge variant="outline">
                        Last run {new Date(lastWearTrendRunAt).toLocaleTimeString()}
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Wear trend column</label>
                <select
                  value={metadataColumn}
                  onChange={(event) => setMetadataColumn(event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={!metadataColumnsQuery.data || metadataColumnsQuery.data.length === 0}
                >
                  <option value="">Select wear trend column</option>
                  {(metadataColumnsQuery.data ?? []).map((column) => (
                    <option key={column} value={column}>
                      {column}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeMonitoring}
                    onChange={(event) => setIncludeMonitoring(event.target.checked)}
                  />
                  Include monitoring intervals
                </label>
              </div>

              <div className="space-y-2 rounded-lg border border-input p-3">
                <p className="text-sm font-medium">Baseline cluster selection (normal behavior)</p>
                <p className="text-xs text-muted-foreground">
                  Select intervals that represent healthy baseline behavior.
                </p>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={clusterFilterText}
                    onChange={(event) => setClusterFilterText(event.target.value)}
                    className="pl-8"
                    placeholder="Filter baseline intervals"
                  />
                </div>

                <div className="max-h-60 space-y-2 overflow-y-auto rounded-md border border-input p-2">
                  {!metadataColumn ? (
                    <p className="text-xs text-muted-foreground">
                      Select wear trend column to load baseline intervals.
                    </p>
                  ) : isFetchingWearTrend && baselineIntervalValues.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Loading baseline intervals...</p>
                  ) : filteredBaselineIntervalValues.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No baseline intervals found for this selection.
                    </p>
                  ) : (
                    pagedBaselineIntervalValues.map((value) => (
                      <label key={value} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedClusterSet.has(value)}
                          onChange={() => toggleClusterValue(value)}
                        />
                        <span className="min-w-0 truncate" title={value}>
                          {value}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                {filteredBaselineIntervalValues.length > BASELINE_CLUSTER_PAGE_SIZE && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      Showing {clusterPageStartIndex + 1}-
                      {Math.min(
                        currentClusterPage * BASELINE_CLUSTER_PAGE_SIZE,
                        filteredBaselineIntervalValues.length
                      )}{' '}
                      of {filteredBaselineIntervalValues.length}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setClusterPage((page) => Math.max(1, page - 1))}
                        disabled={currentClusterPage <= 1}
                      >
                        Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setClusterPage((page) => Math.min(clusterTotalPages, page + 1))
                        }
                        disabled={currentClusterPage >= clusterTotalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={selectFilteredClusters}>
                    Select filtered
                  </Button>
                  <Button variant="outline" size="sm" onClick={selectAllClusters}>
                    Select all
                  </Button>
                  <Button variant="outline" size="sm" onClick={clearAllClusters}>
                    Clear
                  </Button>
                  <Button variant="outline" size="sm" onClick={resetClusterSelection}>
                    Reset
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={rangeStart}
                    onChange={(event) => {
                      setRangeStart(event.target.value);
                      setHasUserAdjustedCluster(true);
                    }}
                    placeholder="Range start"
                  />
                  <Input
                    value={rangeEnd}
                    onChange={(event) => {
                      setRangeEnd(event.target.value);
                      setHasUserAdjustedCluster(true);
                    }}
                    placeholder="Range end"
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  {selectedClusterValues.length} of {baselineIntervalValues.length} baseline
                  intervals selected.
                </p>
                {hasPartialClusterRange && (
                  <p className="text-xs text-warning-text">
                    Enter both range start and range end to use cluster range filtering.
                  </p>
                )}
              </div>

              <div className="space-y-3 rounded-lg border border-input p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Threshold model</p>
                    <p className="text-xs text-muted-foreground">
                      Controls when monitoring distance becomes warning or danger.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={resetDistanceThresholdConfig}>
                    Reset
                  </Button>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Method</label>
                  <select
                    value={distanceThresholdConfig.mode}
                    onChange={(event) =>
                      updateDistanceThresholdConfig({
                        mode:
                          event.target.value === 'relative'
                            ? 'relative'
                            : event.target.value === 'statistical'
                              ? 'statistical'
                              : DEFAULT_DISTANCE_THRESHOLD_CONFIG.mode,
                      })
                    }
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="adaptive">Adaptive baseline spread</option>
                    <option value="statistical">Baseline statistical percentile</option>
                    <option value="relative">Relative % above baseline mean</option>
                  </select>
                </div>

                {distanceThresholdConfig.mode === 'adaptive' ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1 text-xs font-medium text-muted-foreground">
                        Warning spread x
                        <Input
                          type="number"
                          min={0.1}
                          max={10}
                          step={0.1}
                          value={distanceThresholdConfig.warningSpreadMultiplier}
                          onChange={(event) =>
                            updateDistanceThresholdConfig({
                              warningSpreadMultiplier: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="space-y-1 text-xs font-medium text-muted-foreground">
                        Danger spread x
                        <Input
                          type="number"
                          min={0.2}
                          max={12}
                          step={0.1}
                          value={distanceThresholdConfig.dangerSpreadMultiplier}
                          onChange={(event) =>
                            updateDistanceThresholdConfig({
                              dangerSpreadMultiplier: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Default 1.5x/2.5x: thresholds are relative to the selected baseline median and
                      automatically widen or tighten with baseline spread.
                    </p>
                  </>
                ) : distanceThresholdConfig.mode === 'statistical' ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1 text-xs font-medium text-muted-foreground">
                        Warning percentile
                        <Input
                          type="number"
                          min={50}
                          max={99.8}
                          step={0.1}
                          value={distanceThresholdConfig.warningPercentile}
                          onChange={(event) =>
                            updateDistanceThresholdConfig({
                              warningPercentile: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="space-y-1 text-xs font-medium text-muted-foreground">
                        Danger percentile
                        <Input
                          type="number"
                          min={50.1}
                          max={99.9}
                          step={0.1}
                          value={distanceThresholdConfig.dangerPercentile}
                          onChange={(event) =>
                            updateDistanceThresholdConfig({
                              dangerPercentile: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Percentile mode: warning starts near the upper edge of selected healthy
                      baseline behavior; danger starts farther into the healthy tail.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="space-y-1 text-xs font-medium text-muted-foreground">
                        Warning above mean (%)
                        <Input
                          type="number"
                          min={1}
                          max={300}
                          step={1}
                          value={distanceThresholdConfig.warningRelativePercent}
                          onChange={(event) =>
                            updateDistanceThresholdConfig({
                              warningRelativePercent: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="space-y-1 text-xs font-medium text-muted-foreground">
                        Danger above mean (%)
                        <Input
                          type="number"
                          min={2}
                          max={400}
                          step={1}
                          value={distanceThresholdConfig.dangerRelativePercent}
                          onChange={(event) =>
                            updateDistanceThresholdConfig({
                              dangerRelativePercent: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Relative mode: warning and danger are fixed percentages above the selected
                      healthy baseline mean.
                    </p>
                  </>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
                <p className="text-sm font-medium">Apply analysis</p>
                <div className="grid gap-2">
                  <Button onClick={applyWearTrendSelection} disabled={!canRunWearTrend}>
                    {isFetchingWearTrend ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Running wear trend
                      </>
                    ) : (
                      'Run wear trend'
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={resetToLastAppliedSelection}
                    disabled={!hasAppliedWearTrendRun || !hasPendingChanges}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Revert to last run
                  </Button>
                  <Button variant="outline" onClick={resetCurrentConfiguration}>
                    Reset current setup
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="min-w-0 space-y-5">
          {isControlsCollapsed && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">Controls hidden</p>
                <p className="text-xs text-fg-muted">
                  The plot workspace is using the full available width.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsControlsCollapsed(false)}
                className="gap-2"
              >
                <PanelLeftOpen className="h-4 w-4" />
                Show controls
              </Button>
            </div>
          )}

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <TrendingDown className="h-5 w-5" />
                Wear Trend (Deterioration)
              </CardTitle>
              <CardDescription>
                Baseline and monitoring interval distances to baseline centroid, plus transitions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!metadataColumn ? (
                <p className="text-sm text-muted-foreground">
                  Select a wear trend column to load baseline intervals and charts.
                </p>
              ) : !isClusterSelectionReady || (isFetchingWearTrend && !wearResult) ? (
                <p className="text-sm text-muted-foreground">
                  Loading baseline interval options for the selected wear trend column...
                </p>
              ) : !isBaselineSelectionApplied ? (
                <p className="text-sm text-muted-foreground">
                  Select baseline cluster values (for example, use Select all or pick specific
                  intervals) or enter a baseline range to render wear trend plots.
                </p>
              ) : !hasAppliedWearTrendRun ? (
                <p className="text-sm text-muted-foreground">
                  Click <strong>Run wear trend</strong> to render plots using your selected baseline
                  cluster configuration.
                </p>
              ) : !isSelectionAppliedToQuery ? (
                <p className="text-sm text-muted-foreground">
                  Baseline selection changed. Click <strong>Run wear trend</strong> to update plots.
                </p>
              ) : wearError ? (
                <p className="text-sm text-danger-text">{wearError}</p>
              ) : wearResult ? (
                <>
                  {isUpdatingWearTrend && (
                    <p className="text-xs text-muted-foreground">
                      Updating chart with your changes…
                    </p>
                  )}
                  <div className="rounded-lg border border-input p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">Summary metrics</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowWearSummaryMetrics((prev) => !prev)}
                      >
                        {showWearSummaryMetrics ? 'Hide summary metrics' : 'Show summary metrics'}
                      </Button>
                    </div>
                    {showWearSummaryMetrics && (
                      <div className="mt-3 space-y-3">
                        <div className="grid gap-4 sm:grid-cols-4">
                          <div className="rounded-lg border border-input p-3">
                            <p className="text-xs text-muted-foreground">Mean g0-&gt;gi</p>
                            <p className="text-xl font-semibold">
                              {wearResult.distances.g0_to_gi_mean.toFixed(3)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-input p-3">
                            <p className="text-xs text-muted-foreground">Mean gi-&gt;gi+1</p>
                            <p className="text-xl font-semibold">
                              {wearResult.distances.gi_to_gi_plus_1_mean.toFixed(3)}
                            </p>
                          </div>
                          <div className="rounded-lg border border-input p-3">
                            <p className="text-xs text-muted-foreground">Baseline points</p>
                            <p className="text-xl font-semibold">
                              {wearResult.stats.baseline_point_count}
                            </p>
                          </div>
                          <div className="rounded-lg border border-input p-3">
                            <p className="text-xs text-muted-foreground">Monitoring points</p>
                            <p className="text-xl font-semibold">
                              {wearResult.stats.monitoring_point_count}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-3">
                          <div className="rounded-lg border border-input p-3">
                            <p className="text-xs text-muted-foreground">Mean G0-&gt;Gi baseline</p>
                            <p className="text-xl font-semibold">
                              {g0ToGiMeans.baseline != null ? g0ToGiMeans.baseline.toFixed(3) : '—'}
                            </p>
                          </div>
                          <div className="rounded-lg border border-input p-3">
                            <p className="text-xs text-muted-foreground">
                              Mean G0-&gt;Gi monitoring
                            </p>
                            <p className="text-xl font-semibold">
                              {g0ToGiMeans.monitoring != null
                                ? g0ToGiMeans.monitoring.toFixed(3)
                                : '—'}
                            </p>
                          </div>
                          <div className="rounded-lg border border-input p-3">
                            <p className="text-xs text-muted-foreground">
                              Delta (monitoring-baseline)
                            </p>
                            <p className="text-xl font-semibold">
                              {g0ToGiMeans.delta != null ? g0ToGiMeans.delta.toFixed(3) : '—'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <Tabs
                    value={activePlotTab}
                    onValueChange={(value) =>
                      setActivePlotTab(value === 'transitions' ? 'transitions' : 'distance')
                    }
                    className="space-y-4"
                  >
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="distance">Distance from Baseline (G0→Gi)</TabsTrigger>
                      <TabsTrigger value="transitions">Interval Transitions (Gi→Gi+1)</TabsTrigger>
                    </TabsList>
                    <p className="text-xs text-muted-foreground">
                      Use mouse wheel or trackpad to zoom, drag to pan, and click autoscale/home in
                      the chart toolbar to reset view.
                    </p>

                    <TabsContent value="distance" className="mt-0 space-y-3">
                      <div className="rounded-lg border border-input bg-muted/30 p-3 text-sm text-muted-foreground">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between text-left"
                          onClick={() => setShowDistanceGuide((prev) => !prev)}
                        >
                          <span className="font-medium text-foreground">
                            How to read this chart
                          </span>
                          {showDistanceGuide ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                        {showDistanceGuide && (
                          <p className="mt-2">
                            X-axis = interval order ({wearResult.metadata_column}). Y-axis =
                            distance to baseline centroid (G0). Blue = baseline intervals. Red =
                            monitoring intervals. Green and violet solid lines show baseline and
                            monitoring rolling means. Warning and danger thresholds use{' '}
                            {distanceThresholdMethodLabel}. The vertical dashed guide marks the
                            first warning or danger crossing.
                          </p>
                        )}
                      </div>

                      {distanceEChart ? (
                        <ChartFrame
                          title="Distance from baseline"
                          description={`Apache ECharts. Monitoring movement from selected healthy baseline cluster. Thresholds: ${distanceThresholdMethodLabel}.`}
                          stats={
                            <>
                              <ChartStat
                                label="Latest"
                                value={
                                  latestMonitoringInterval
                                    ? latestMonitoringInterval.distance_from_g0.toFixed(3)
                                    : '—'
                                }
                                description="Distance from G0 for the latest monitoring interval. Higher values are farther from the selected healthy baseline center."
                                tone={latestMonitoringTone}
                              />
                              <ChartStat
                                label="Baseline mean"
                                value={
                                  distanceSummary.baseline != null
                                    ? distanceSummary.baseline.toFixed(3)
                                    : '—'
                                }
                                description="Average G0 to interval distance across the selected healthy baseline intervals. Thresholds are derived from this value."
                                tone="baseline"
                              />
                              <ChartStat
                                label="Monitoring mean"
                                value={
                                  distanceSummary.monitoring != null
                                    ? distanceSummary.monitoring.toFixed(3)
                                    : '—'
                                }
                                description="Average G0 to interval distance across monitoring intervals. Compare this with the baseline mean."
                                tone="monitoring"
                              />
                              <ChartStat
                                label="Delta"
                                value={
                                  distanceSummary.delta != null
                                    ? distanceSummary.delta.toFixed(3)
                                    : '—'
                                }
                                description="Monitoring mean minus baseline mean. Positive values indicate monitoring intervals are farther from the healthy baseline."
                                tone={
                                  distanceSummary.delta == null
                                    ? 'neutral'
                                    : distanceSummary.warningDelta != null &&
                                        distanceSummary.delta >= distanceSummary.warningDelta
                                      ? 'warning'
                                      : 'success'
                                }
                              />
                              <ChartStat
                                label="Warning"
                                value={distanceSummary.warningThreshold.toFixed(3)}
                                description={warningThresholdDescription}
                                tone="warning"
                              />
                              <ChartStat
                                label="Danger"
                                value={distanceSummary.dangerThreshold.toFixed(3)}
                                description={dangerThresholdDescription}
                                tone="danger"
                              />
                            </>
                          }
                          actions={
                            <>
                              <ChartSwatch color={plotTheme.baseline} label="Baseline" />
                              <ChartSwatch color={plotTheme.monitoring} label="Monitoring" />
                              <ChartSwatch
                                color={plotTheme.baselineRolling}
                                label="Baseline rolling"
                              />
                              <ChartSwatch
                                color={plotTheme.monitoringRolling}
                                label="Monitoring rolling"
                              />
                              <ChartSwatch color={plotTheme.warning} label="Warning threshold" />
                              <ChartSwatch color={plotTheme.danger} label="Danger threshold" />
                            </>
                          }
                          bodyClassName="p-2"
                        >
                          <div className="h-[clamp(560px,72vh,780px)]">
                            <EChartsCanvas
                              option={distanceEChart.option}
                              style={{ width: '100%', height: '100%' }}
                            />
                          </div>
                          <p className="border-t border-border px-2 py-1 text-xs text-muted-foreground">
                            Interactions: use the ECharts toolbox for zoom, brush, restore, and
                            image export; use the bottom/right sliders or mouse wheel to inspect
                            dense ranges.
                          </p>
                        </ChartFrame>
                      ) : (
                        <WorkflowState
                          icon={<TrendingDown className="h-5 w-5" aria-hidden="true" />}
                          title="Distance plot is not ready"
                          description="Select a dataset, choose the wear trend column, mark healthy baseline intervals, then run wear trend analysis."
                          action={
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={applyWearTrendSelection}
                              disabled={!canRunWearTrend}
                            >
                              Run wear trend
                            </Button>
                          }
                        />
                      )}

                      <div className="space-y-3 rounded-lg border border-input p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowIntervalTable((prev) => !prev)}
                          >
                            {showIntervalTable ? 'Hide' : 'Show'} interval summary
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              exportCSV(
                                intervalRows.map((row) => ({
                                  interval: row.metadata_value,
                                  dataset_type: row.dataset_type,
                                  point_count: row.point_count,
                                  distance_from_g0: row.distance_from_g0,
                                  is_baseline_cluster: row.is_baseline_cluster ? 1 : 0,
                                })),
                                `insights-interval-summary-${datasetId ?? 'unknown'}`
                              )
                            }
                          >
                            <Download className="mr-2 h-4 w-4" />
                            Export interval CSV
                          </Button>
                        </div>

                        {showIntervalTable && (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm">
                              <span>Rows per page:</span>
                              <select
                                value={intervalPageSize}
                                onChange={(event) => {
                                  setIntervalPageSize(Number(event.target.value));
                                  setIntervalPage(1);
                                }}
                                className="rounded-md border border-input bg-background px-2 py-1"
                              >
                                {[10, 20, 50].map((size) => (
                                  <option key={size} value={size}>
                                    {size}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="min-w-full table-auto text-sm">
                                <thead>
                                  <tr className="text-left">
                                    <th className="pb-2 pr-4">Interval</th>
                                    <th className="pb-2 pr-4">Type</th>
                                    <th className="pb-2 pr-4">Points</th>
                                    <th className="pb-2 pr-4">Distance to G0</th>
                                    <th className="pb-2 pr-4">In baseline cluster</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pagedIntervalRows.map((row, index) => (
                                    <tr
                                      key={`${row.metadata_value}-${row.sort_index}-${index}`}
                                      className="border-t border-border/50"
                                    >
                                      <td className="py-2 pr-4">{row.metadata_value}</td>
                                      <td className="py-2 pr-4">{row.dataset_type}</td>
                                      <td className="py-2 pr-4">{row.point_count}</td>
                                      <td className="py-2 pr-4">
                                        {row.distance_from_g0.toFixed(4)}
                                      </td>
                                      <td className="py-2 pr-4">
                                        {row.is_baseline_cluster ? 'Yes' : 'No'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span>
                                Page {intervalPage} / {intervalTotalPages}
                              </span>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setIntervalPage((page) => Math.max(1, page - 1))}
                                  disabled={intervalPage <= 1}
                                >
                                  Prev
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setIntervalPage((page) =>
                                      Math.min(intervalTotalPages, page + 1)
                                    )
                                  }
                                  disabled={intervalPage >= intervalTotalPages}
                                >
                                  Next
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="transitions" className="mt-0 space-y-3">
                      <div className="rounded-lg border border-input bg-muted/30 p-3 text-sm text-muted-foreground">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between text-left"
                          onClick={() => setShowTransitionGuide((prev) => !prev)}
                        >
                          <span className="font-medium text-foreground">
                            How to read this chart
                          </span>
                          {showTransitionGuide ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>
                        {showTransitionGuide && (
                          <p className="mt-2">
                            X-axis = consecutive transition order. Y-axis = centroid movement
                            between one interval and the next (Gi→Gi+1). Spikes indicate abrupt
                            behavior changes.
                          </p>
                        )}
                      </div>

                      {transitionPlot ? (
                        <ChartFrame
                          title="Transition movement"
                          description="Consecutive Gi→Gi+1 movement split by baseline, handoff, and monitoring transition types."
                          stats={
                            <>
                              <ChartStat
                                label="Transitions"
                                value={transitionRows.length.toLocaleString()}
                              />
                              <ChartStat
                                label="Spikes"
                                value={(transitionPlot.spikeCount ?? 0).toLocaleString()}
                                tone={transitionPlot.spikeCount ? 'warning' : 'success'}
                              />
                              <ChartStat
                                label="Mean Gi→Gi+1"
                                value={wearResult.distances.gi_to_gi_plus_1_mean.toFixed(3)}
                                tone="info"
                              />
                            </>
                          }
                          actions={
                            <>
                              <ChartSwatch color={plotTheme.baseline} label="Baseline" />
                              <ChartSwatch color={plotTheme.warning} label="Handoff" />
                              <ChartSwatch color={plotTheme.monitoring} label="Monitoring" />
                              <ChartSwatch color={plotTheme.danger} label="Spike" />
                            </>
                          }
                          bodyClassName="p-2"
                        >
                          <div className="h-[clamp(560px,72vh,780px)]">
                            <EChartsCanvas
                              option={transitionPlot.option}
                              style={{ width: '100%', height: '100%' }}
                            />
                          </div>
                        </ChartFrame>
                      ) : (
                        <WorkflowState
                          icon={<Activity className="h-5 w-5" aria-hidden="true" />}
                          title="Transition plot is not ready"
                          description="Enable monitoring intervals or choose a dataset with enough ordered baseline and monitoring intervals to calculate Gi to Gi+1 movement."
                        />
                      )}

                      <div className="space-y-3 rounded-lg border border-input p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowTransitionTable((prev) => !prev)}
                          >
                            {showTransitionTable ? 'Hide' : 'Show'} transition summary
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              exportCSV(
                                transitionRows.map((row) => ({
                                  from_interval: row.from_label,
                                  to_interval: row.to_label,
                                  from_type: row.from_dataset_type,
                                  to_type: row.to_dataset_type,
                                  distance: row.distance,
                                })),
                                `insights-transition-summary-${datasetId ?? 'unknown'}`
                              )
                            }
                          >
                            <Download className="mr-2 h-4 w-4" />
                            Export transition CSV
                          </Button>
                        </div>

                        {showTransitionTable && (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 text-sm">
                              <span>Rows per page:</span>
                              <select
                                value={transitionPageSize}
                                onChange={(event) => {
                                  setTransitionPageSize(Number(event.target.value));
                                  setTransitionPage(1);
                                }}
                                className="rounded-md border border-input bg-background px-2 py-1"
                              >
                                {[10, 20, 50].map((size) => (
                                  <option key={size} value={size}>
                                    {size}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="min-w-full table-auto text-sm">
                                <thead>
                                  <tr className="text-left">
                                    <th className="pb-2 pr-4">From</th>
                                    <th className="pb-2 pr-4">To</th>
                                    <th className="pb-2 pr-4">From type</th>
                                    <th className="pb-2 pr-4">To type</th>
                                    <th className="pb-2 pr-4">Distance</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {pagedTransitionRows.map((row, index) => (
                                    <tr
                                      key={`${row.from_label}-${row.to_label}-${index}`}
                                      className="border-t border-border/50"
                                    >
                                      <td className="py-2 pr-4">{row.from_label}</td>
                                      <td className="py-2 pr-4">{row.to_label}</td>
                                      <td className="py-2 pr-4">{row.from_dataset_type}</td>
                                      <td className="py-2 pr-4">{row.to_dataset_type}</td>
                                      <td className="py-2 pr-4">{row.distance.toFixed(4)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="flex items-center justify-between text-sm">
                              <span>
                                Page {transitionPage} / {transitionTotalPages}
                              </span>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setTransitionPage((page) => Math.max(1, page - 1))}
                                  disabled={transitionPage <= 1}
                                >
                                  Prev
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setTransitionPage((page) =>
                                      Math.min(transitionTotalPages, page + 1)
                                    )
                                  }
                                  disabled={transitionPage >= transitionTotalPages}
                                >
                                  Next
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Run wear trend to populate this section.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-border/60">
        <CardContent className="flex flex-wrap gap-3 py-4">
          <Button asChild>
            <Link href="/dashboard/live">
              Open live monitor
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/account">Open account & security</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
