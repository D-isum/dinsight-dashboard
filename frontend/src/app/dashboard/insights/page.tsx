'use client';

import Link from 'next/link';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
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
import { DatasetSourceSelect } from '@/components/datasets/dataset-source-select';
import { useDatasetDiscovery } from '@/hooks/useDatasetDiscovery';
import { useDatasetSourceFilter } from '@/hooks/useDatasetSourceFilter';
import { useActiveStreamingDataset } from '@/hooks/useActiveStreamingDataset';
import { api } from '@/lib/api-client';
import { formatDatasetOptionLabel } from '@/lib/dataset-source-groups';
import {
  axisRangeRevisionPart,
  buildPaddedAxisRange,
  plotRevisionFromParts,
} from '@/lib/plot-autoscale';
import {
  alphaColor,
  createThemedPlotConfig,
  createThemedPlotLayout,
  usePlotTheme,
} from '@/lib/plot-theme';
import { readScoped, writeScoped } from '@/lib/scoped-storage';
import { useAuth } from '@/context/auth-context';
import { STREAMING_MONITORING_EMPHASIS_POINTS } from '@/lib/chart-focus-config';
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

import { PlotCanvas as Plot } from '@/components/charts/plot-canvas';
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
  const plotTheme = usePlotTheme();
  const userId = user?.id;
  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [manualDatasetId, setManualDatasetId] = useState('');
  const [datasetError, setDatasetError] = useState<string | null>(null);
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
  const hasPinnedDatasetRef = useRef(false);
  const pendingDraftRef = useRef<DraftWearTrendConfig | null>(null);
  const draftPersistTimerRef = useRef<number | null>(null);

  const { datasets, isLoading } = useDatasetDiscovery({
    queryKey: ['available-dinsight-ids'],
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const {
    groups: datasetSourceGroups,
    selectedSourceKey,
    setSelectedSourceKey,
    filteredDatasets,
    filteredDatasetIds,
    latestFilteredDatasetId,
  } = useDatasetSourceFilter(datasets);
  const { activeStreamingDatasetId, statusesByDatasetId } =
    useActiveStreamingDataset(filteredDatasetIds);
  const preferredDatasetId = activeStreamingDatasetId ?? latestFilteredDatasetId ?? null;

  useEffect(() => {
    if (datasetId == null || !filteredDatasetIds.includes(datasetId)) {
      hasPinnedDatasetRef.current = false;
      setDatasetId(preferredDatasetId);
      setManualDatasetId(preferredDatasetId ? String(preferredDatasetId) : '');
      setDatasetError(null);
    }
  }, [datasetId, filteredDatasetIds, preferredDatasetId]);

  useEffect(() => {
    if (hasPinnedDatasetRef.current) {
      return;
    }
    if (datasetId == null && preferredDatasetId) {
      setDatasetId(preferredDatasetId);
      setManualDatasetId(String(preferredDatasetId));
    }
  }, [datasetId, preferredDatasetId]);

  useEffect(() => {
    if (hasPinnedDatasetRef.current || hasHydratedPersistedConfigRef.current) {
      return;
    }
    if (!activeStreamingDatasetId || datasetId === activeStreamingDatasetId) {
      return;
    }
    const currentDatasetStatus = datasetId != null ? statusesByDatasetId[datasetId]?.status : null;
    if (
      datasetId == null ||
      currentDatasetStatus === 'completed' ||
      currentDatasetStatus === 'not_started'
    ) {
      setDatasetId(activeStreamingDatasetId);
      setManualDatasetId(String(activeStreamingDatasetId));
    }
  }, [activeStreamingDatasetId, datasetId, statusesByDatasetId]);

  useEffect(() => {
    if (datasetId != null) {
      setManualDatasetId(String(datasetId));
    }
  }, [datasetId]);

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

    skipNextDatasetMetadataResetRef.current = true;
    hasPinnedDatasetRef.current = true;
    setDatasetId(resolvedLocal.datasetId);
    setManualDatasetId(String(resolvedLocal.datasetId));
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
  }, [userId]);

  useEffect(() => {
    if (!hasFetchedUserPreferences) {
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

    skipNextDatasetMetadataResetRef.current = true;
    hasPinnedDatasetRef.current = true;
    setDatasetId(resolved.datasetId);
    setManualDatasetId(String(resolved.datasetId));
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
  }, [hasFetchedUserPreferences, userPreferences, userId]);

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

  const applyManualDataset = () => {
    const parsed = Number(manualDatasetId.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDatasetError('Enter a valid dataset ID.');
      return;
    }
    if (!filteredDatasetIds.includes(parsed)) {
      setDatasetError('Select the dataset device/source before applying this ID.');
      return;
    }
    setDatasetError(null);
    hasPinnedDatasetRef.current = true;
    setDatasetId(parsed);
  };

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

  const distancePlot = useMemo(() => {
    if (!shouldRenderWearPlots || !wearResult?.intervals?.length) {
      return null;
    }

    const sorted = [...wearResult.intervals].sort((a, b) => a.sort_index - b.sort_index);
    const x = sorted.map((interval) => interval.sort_index);
    const fullLabels = sorted.map((interval) => interval.metadata_value);
    const maxTicks = 5;
    const tickStep = Math.max(1, Math.ceil(sorted.length / maxTicks));
    const tickVals: number[] = [];
    const tickText: string[] = [];

    x.forEach((value, index) => {
      if (index % tickStep === 0 || index === sorted.length - 1) {
        tickVals.push(value);
        tickText.push(fullLabels[index]);
      }
    });

    const baselineSeries = sorted.map((interval) =>
      interval.dataset_type === 'baseline' ? interval.distance_from_g0 : null
    );
    const monitoringSeries = sorted.map((interval) =>
      interval.dataset_type === 'monitoring' ? interval.distance_from_g0 : null
    );
    const hasMonitoringSeries = monitoringSeries.some((value) => value != null);
    const distanceValues = sorted
      .map((interval) => interval.distance_from_g0)
      .filter((value) => Number.isFinite(value) && value >= 0);
    const warningThreshold = distanceSummary.warningThreshold;
    const dangerThreshold = distanceSummary.dangerThreshold;
    const xAxisRange = buildPaddedAxisRange(x, { minSpan: 1, paddingRatio: 0.03 });
    const yAxisRange = buildPaddedAxisRange(
      [...distanceValues, DISTANCE_AXIS_BASE_MAX, warningThreshold, dangerThreshold],
      {
        includeZero: true,
        lowerBound: 0,
        minSpan: 0.25,
        paddingRatio: 0.08,
      }
    );
    const autoscaleRevision = plotRevisionFromParts([
      'insights-distance',
      wearResult.metadata_column,
      axisRangeRevisionPart(xAxisRange),
      axisRangeRevisionPart(yAxisRange),
    ]);
    const monitoringIndices = sorted
      .map((interval, index) => (interval.dataset_type === 'monitoring' ? index : -1))
      .filter((index) => index >= 0);
    const recentMonitoringIndexSet = new Set(
      monitoringIndices.slice(
        Math.max(0, monitoringIndices.length - STREAMING_MONITORING_EMPHASIS_POINTS)
      )
    );
    const monitoringHistorySeries = sorted.map((interval, index) =>
      interval.dataset_type === 'monitoring' && !recentMonitoringIndexSet.has(index)
        ? interval.distance_from_g0
        : null
    );
    const monitoringRecentSeries = sorted.map((interval, index) =>
      interval.dataset_type === 'monitoring' && recentMonitoringIndexSet.has(index)
        ? interval.distance_from_g0
        : null
    );
    const baselineClusterShapes = sorted
      .filter((interval) => interval.is_baseline_cluster)
      .map((interval) => ({
        type: 'rect',
        x0: interval.sort_index - 0.45,
        x1: interval.sort_index + 0.45,
        y0: 0,
        y1: 1,
        yref: 'paper',
        fillcolor: plotTheme.baselineSoft,
        line: { width: 0 },
      }));
    const baselineSelectedDistances = sorted
      .filter((interval) => interval.dataset_type === 'baseline' && interval.is_baseline_cluster)
      .map((interval) => interval.distance_from_g0);
    const monitoringDistances = sorted
      .filter((interval) => interval.dataset_type === 'monitoring')
      .map((interval) => interval.distance_from_g0);
    const baselineSelectedMean = distanceSummary.baseline ?? mean(baselineSelectedDistances);
    const monitoringMean = distanceSummary.monitoring ?? mean(monitoringDistances);
    const baselineRollingSeries = rollingMean(baselineSeries, 12);
    const monitoringRollingSeries = rollingMean(monitoringSeries, 12);
    const latestMonitoringIndex = monitoringIndices.at(-1);
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
    const thresholdShapes = [
      {
        type: 'rect' as const,
        xref: 'paper' as const,
        yref: 'y' as const,
        x0: 0,
        x1: 1,
        y0: warningThreshold,
        y1: dangerThreshold,
        fillcolor: alphaColor(plotTheme.warning, 0.08),
        line: { width: 0 },
        layer: 'below' as const,
      },
      {
        type: 'rect' as const,
        xref: 'paper' as const,
        yref: 'y' as const,
        x0: 0,
        x1: 1,
        y0: dangerThreshold,
        y1: yAxisRange?.[1] ?? dangerThreshold + 0.5,
        fillcolor: alphaColor(plotTheme.danger, 0.07),
        line: { width: 0 },
        layer: 'below' as const,
      },
    ];
    const thresholdX0 = xAxisRange?.[0] ?? x[0] ?? 0;
    const thresholdX1 = xAxisRange?.[1] ?? x.at(-1) ?? thresholdX0 + 1;
    const crossingGuideShapes =
      crossingInterval != null
        ? [
            {
              type: 'line' as const,
              xref: 'x' as const,
              yref: 'paper' as const,
              x0: crossingInterval.sort_index,
              x1: crossingInterval.sort_index,
              y0: 0,
              y1: 1,
              line: {
                color: crossingColor,
                dash: crossingTone === 'danger' ? 'dashdot' : 'dash',
                width: 2,
              },
              layer: 'below' as const,
            },
          ]
        : [];
    const meanLines = [
      ...(baselineSelectedMean != null
        ? [
            {
              type: 'line' as const,
              xref: 'paper' as const,
              yref: 'y' as const,
              x0: 0,
              x1: 1,
              y0: baselineSelectedMean,
              y1: baselineSelectedMean,
              line: { color: plotTheme.baseline, dash: 'dot', width: 2 },
            },
          ]
        : []),
      ...(monitoringMean != null
        ? [
            {
              type: 'line' as const,
              xref: 'paper' as const,
              yref: 'y' as const,
              x0: 0,
              x1: 1,
              y0: monitoringMean,
              y1: monitoringMean,
              line: { color: plotTheme.monitoring, dash: 'dash', width: 2 },
            },
          ]
        : []),
    ];
    const thresholdAnnotations = [
      {
        xref: 'paper' as const,
        yref: 'y' as const,
        x: 1,
        y: warningThreshold,
        xanchor: 'right' as const,
        yanchor: 'bottom' as const,
        text: `Warning ${warningThreshold.toFixed(3)}`,
        showarrow: false,
        font: { color: plotTheme.warning, size: 11 },
        bgcolor: alphaColor(plotTheme.surface, 0.86),
        bordercolor: alphaColor(plotTheme.warning, 0.35),
        borderpad: 4,
      },
      {
        xref: 'paper' as const,
        yref: 'y' as const,
        x: 1,
        y: dangerThreshold,
        xanchor: 'right' as const,
        yanchor: 'bottom' as const,
        text: `Danger ${dangerThreshold.toFixed(3)}`,
        showarrow: false,
        font: { color: plotTheme.danger, size: 11 },
        bgcolor: alphaColor(plotTheme.surface, 0.86),
        bordercolor: alphaColor(plotTheme.danger, 0.35),
        borderpad: 4,
      },
    ];
    const traces: any[] = [
      {
        x,
        y: baselineSeries,
        text: fullLabels,
        mode: 'lines+markers',
        type: 'scatter',
        name: 'Baseline',
        line: { color: alphaColor(plotTheme.baseline, 0.82), width: 1.7 },
        marker: { color: alphaColor(plotTheme.baseline, 0.82), size: 5.5 },
        customdata: sorted.map((interval) => [
          interval.metadata_value,
          interval.dataset_type === 'baseline' ? 'Baseline' : 'Monitoring',
          interval.point_count,
        ]),
        hovertemplate:
          'Interval %{customdata[0]}<br>%{customdata[2]} pts · %{customdata[1]}<br>Distance: %{y:.4f}<extra></extra>',
        connectgaps: false,
      },
      {
        x,
        y: baselineRollingSeries,
        text: fullLabels,
        mode: 'lines',
        type: 'scatter',
        name: 'Baseline rolling mean',
        line: { color: plotTheme.baselineRolling, width: 4, dash: 'solid' },
        hovertemplate: 'Baseline rolling mean at %{text}<br>Distance: %{y:.4f}<extra></extra>',
        connectgaps: false,
      },
      {
        x: [thresholdX0, thresholdX1],
        y: [warningThreshold, warningThreshold],
        mode: 'lines',
        type: 'scatter',
        name: `Warning threshold (${warningThreshold.toFixed(3)})`,
        line: { color: plotTheme.warning, width: 2, dash: 'dot' },
        hovertemplate: 'Warning threshold<br>Distance: %{y:.4f}<extra></extra>',
        connectgaps: false,
      },
      {
        x: [thresholdX0, thresholdX1],
        y: [dangerThreshold, dangerThreshold],
        mode: 'lines',
        type: 'scatter',
        name: `Danger threshold (${dangerThreshold.toFixed(3)})`,
        line: { color: plotTheme.danger, width: 2, dash: 'dot' },
        hovertemplate: 'Danger threshold<br>Distance: %{y:.4f}<extra></extra>',
        connectgaps: false,
      },
    ];

    if (hasMonitoringSeries) {
      traces.push(
        {
          x,
          y: monitoringHistorySeries,
          text: fullLabels,
          mode: 'lines+markers',
          type: 'scatter',
          name: 'Monitoring history',
          line: { color: alphaColor(plotTheme.monitoring, 0.18), width: 1.2 },
          marker: { color: alphaColor(plotTheme.monitoring, 0.26), size: 4.5 },
          customdata: sorted.map((interval) => [
            interval.metadata_value,
            interval.dataset_type === 'baseline' ? 'Baseline' : 'Monitoring',
            interval.point_count,
          ]),
          hovertemplate:
            'Interval %{customdata[0]}<br>%{customdata[2]} pts · %{customdata[1]}<br>Distance: %{y:.4f}<extra></extra>',
          connectgaps: false,
        },
        {
          x,
          y: monitoringRecentSeries,
          text: fullLabels,
          mode: 'lines+markers',
          type: 'scatter',
          name: 'Monitoring recent',
          line: { color: alphaColor(plotTheme.monitoring, 0.9), width: 2.2 },
          marker: { color: alphaColor(plotTheme.monitoring, 0.88), size: 5.5 },
          customdata: sorted.map((interval) => [
            interval.metadata_value,
            interval.dataset_type === 'baseline' ? 'Baseline' : 'Monitoring',
            interval.point_count,
          ]),
          hovertemplate:
            'Interval %{customdata[0]}<br>%{customdata[2]} pts · %{customdata[1]}<br>Distance: %{y:.4f}<extra></extra>',
          connectgaps: false,
        }
      );

      traces.push({
        x,
        y: monitoringRollingSeries,
        text: fullLabels,
        mode: 'lines',
        type: 'scatter',
        name: 'Monitoring rolling mean',
        line: { color: plotTheme.monitoringRolling, width: 4, dash: 'solid' },
        hovertemplate: 'Monitoring rolling mean at %{text}<br>Distance: %{y:.4f}<extra></extra>',
        connectgaps: false,
      });

      if (latestMonitoringIndex != null && latestMonitoringIndex >= 0) {
        const latestInterval = sorted[latestMonitoringIndex];
        traces.push({
          x: [latestInterval.sort_index],
          y: [latestInterval.distance_from_g0],
          text: [latestInterval.metadata_value],
          mode: 'markers',
          type: 'scatter',
          name: 'Latest interval',
          marker: {
            color: plotTheme.latest,
            size: 14,
            line: { color: plotTheme.latestLine, width: 2 },
          },
          hovertemplate: 'Latest interval %{text}<br>Distance: %{y:.4f}<extra></extra>',
        });
      }

      if (crossingInterval != null) {
        traces.push({
          x: [crossingInterval.sort_index],
          y: [crossingInterval.distance_from_g0],
          text: [crossingInterval.metadata_value],
          mode: 'markers',
          type: 'scatter',
          name: crossingTone === 'danger' ? 'Danger crossing' : 'Warning crossing',
          marker: {
            symbol: 'diamond',
            color: crossingColor,
            size: 12,
            line: { color: plotTheme.surface, width: 1.5 },
          },
          hovertemplate: '%{fullData.name}<br>%{text}<br>Distance: %{y:.4f}<extra></extra>',
        });
      }
    }

    return {
      data: traces,
      revision: autoscaleRevision,
      layout: createThemedPlotLayout(plotTheme, {
        height: 540,
        title: '',
        xaxis: {
          title: `${wearResult.metadata_column} (Interval Order)`,
          autorange: !xAxisRange,
          ...(xAxisRange ? { range: xAxisRange } : {}),
          tickmode: 'array',
          tickvals: tickVals,
          ticktext: tickText.map(formatIntervalTick),
          tickangle: 0,
          automargin: true,
          tickfont: { size: 11 },
        },
        yaxis: {
          title: 'Distance from baseline reference G0',
          autorange: !yAxisRange,
          ...(yAxisRange ? { range: yAxisRange } : {}),
        },
        margin: { t: 56, r: 20, b: 100, l: 56 },
        uirevision: `insights-distance-${datasetId ?? 'none'}-${wearResult.metadata_column}`,
        transition: { duration: 120 },
        legend: {
          orientation: 'h',
          yanchor: 'top',
          y: -0.2,
          xanchor: 'center',
          x: 0.5,
        },
        shapes: [
          ...thresholdShapes,
          ...baselineClusterShapes,
          ...meanLines,
          ...crossingGuideShapes,
        ],
        annotations: thresholdAnnotations,
      }) as any,
      config: {
        ...createThemedPlotConfig({ modeBar: true }),
        modeBarButtonsToRemove: [
          ...createThemedPlotConfig({ modeBar: true }).modeBarButtonsToRemove,
          'lasso2d',
          'select2d',
        ],
      },
    };
  }, [datasetId, distanceSummary, plotTheme, shouldRenderWearPlots, wearResult]);

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
    const transitionMeanLines = [
      ...(baselineTransitionMean != null
        ? [
            {
              type: 'line' as const,
              xref: 'paper' as const,
              yref: 'y' as const,
              x0: 0,
              x1: 1,
              y0: baselineTransitionMean,
              y1: baselineTransitionMean,
              line: { color: plotTheme.baseline, dash: 'dot', width: 2 },
            },
          ]
        : []),
      ...(monitoringTransitionMean != null
        ? [
            {
              type: 'line' as const,
              xref: 'paper' as const,
              yref: 'y' as const,
              x0: 0,
              x1: 1,
              y0: monitoringTransitionMean,
              y1: monitoringTransitionMean,
              line: { color: plotTheme.monitoring, dash: 'dash', width: 2 },
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
    const autoscaleRevision = plotRevisionFromParts([
      'insights-transitions',
      wearResult?.metadata_column ?? 'selected-interval',
      axisRangeRevisionPart(xAxisRange),
      axisRangeRevisionPart(yAxisRange),
    ]);
    const transitionCustomData = transitions.map((transition) => [
      transition.from_label,
      transition.to_label,
      transition.from_dataset_type === 'baseline' ? 'Baseline' : 'Monitoring',
      transition.to_dataset_type === 'baseline' ? 'Baseline' : 'Monitoring',
    ]);
    const transitionHoverTemplate =
      'Transition %{x}: %{customdata[0]} → %{customdata[1]}<br>Source %{customdata[2]} · Dest %{customdata[3]}<br>Distance: %{y:.4f}<extra></extra>';
    const transitionTraces: any[] = [
      {
        x: xValues,
        text: transitions.map((entry) => `${entry.from_label} → ${entry.to_label}`),
        y: transitionSeries.baseline,
        mode: 'lines+markers',
        type: 'scattergl',
        marker: { color: plotTheme.baseline, size: 6 },
        line: { color: plotTheme.baseline, width: 2 },
        customdata: transitionCustomData,
        hovertemplate: transitionHoverTemplate,
        name: 'Baseline',
        connectgaps: false,
      },
      {
        x: xValues,
        text: transitions.map((entry) => `${entry.from_label} → ${entry.to_label}`),
        y: transitionSeries.handoff,
        mode: 'lines+markers',
        type: 'scattergl',
        marker: { color: plotTheme.warning, size: 7 },
        line: { color: plotTheme.warning, width: 2, dash: 'dot' },
        customdata: transitionCustomData,
        hovertemplate: transitionHoverTemplate,
        name: 'Handoff',
        connectgaps: false,
      },
      {
        x: xValues,
        text: transitions.map((entry) => `${entry.from_label} → ${entry.to_label}`),
        y: transitionSeries.monitoring,
        mode: 'lines+markers',
        type: 'scattergl',
        marker: { color: plotTheme.monitoring, size: 7 },
        line: { color: plotTheme.monitoring, width: 2.5 },
        customdata: transitionCustomData,
        hovertemplate: transitionHoverTemplate,
        name: 'Monitoring',
        connectgaps: false,
      },
    ];

    if (spikeTransitions.length > 0) {
      transitionTraces.push({
        x: spikeTransitions.map(({ index }) => xValues[index]),
        y: spikeTransitions.map(({ transition }) => transition.distance),
        text: spikeTransitions.map(
          ({ transition }) => `${transition.from_label} → ${transition.to_label}`
        ),
        mode: 'markers',
        type: 'scattergl',
        marker: {
          color: plotTheme.danger,
          size: 12,
          symbol: 'diamond',
          line: { color: plotTheme.surface, width: 1.5 },
        },
        name: 'Spike',
        hovertemplate: 'Spike %{text}<br>Distance: %{y:.4f}<extra></extra>',
      });
    }

    return {
      data: transitionTraces,
      revision: autoscaleRevision,
      layout: createThemedPlotLayout(plotTheme, {
        height: 540,
        title: '',
        xaxis: {
          title:
            wearResult?.metadata_column != null
              ? `${wearResult.metadata_column} Transition # (Gi → Gi+1)`
              : 'Transition # (Gi → Gi+1)',
          autorange: !xAxisRange,
          ...(xAxisRange ? { range: xAxisRange } : {}),
          tickmode: 'array',
          tickvals: tickVals,
          ticktext: tickText,
          tickangle: 0,
          automargin: true,
          tickfont: { size: 11 },
        },
        yaxis: {
          title: 'Centroid movement distance (Gi→Gi+1)',
          autorange: !yAxisRange,
          ...(yAxisRange ? { range: yAxisRange } : {}),
        },
        margin: { t: 48, r: 20, b: 100, l: 56 },
        uirevision: `insights-transitions-${datasetId ?? 'none'}-${wearResult?.metadata_column ?? 'selected-interval'}`,
        transition: { duration: 120 },
        showlegend: true,
        legend: {
          orientation: 'h',
          yanchor: 'top',
          y: -0.2,
          xanchor: 'center',
          x: 0.5,
        },
        shapes: transitionMeanLines,
        annotations: [],
      }) as any,
      config: {
        ...createThemedPlotConfig({ modeBar: true }),
        modeBarButtonsToRemove: [
          ...createThemedPlotConfig({ modeBar: true }).modeBarButtonsToRemove,
          'lasso2d',
          'select2d',
        ],
      },
      spikeCount: spikeTransitions.length,
    };
  }, [datasetId, plotTheme, shouldRenderWearPlots, transitionRows, wearResult?.metadata_column]);

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

  return (
    <div className="space-y-6">
      <Card className="border-border/60">
        <CardContent className="space-y-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsControlsCollapsed((prev) => !prev)}
                className="gap-2"
              >
                {isControlsCollapsed ? (
                  <>
                    <PanelLeftOpen className="h-4 w-4" />
                    Show controls
                  </>
                ) : (
                  <>
                    <PanelLeftClose className="h-4 w-4" />
                    Hide controls
                  </>
                )}
              </Button>
              <Badge variant={canRunWearTrend ? 'secondary' : 'outline'}>
                {canRunWearTrend ? 'Ready to run' : 'Configure baseline selection'}
              </Badge>
              {streamingStatus?.is_active && hasAppliedWearTrendRun && appliedIncludeMonitoring && (
                <Badge variant="outline">Live updating</Badge>
              )}
              {hasPendingChanges && <Badge variant="outline">Selection changed</Badge>}
              {lastWearTrendRunAt && (
                <Badge variant="outline">
                  Last run {new Date(lastWearTrendRunAt).toLocaleTimeString()}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Shortcut: <strong>Ctrl/Cmd+Enter</strong> run wear trend.
            </p>
          </div>

          <div className="grid gap-3 xl:grid-cols-12">
            <div className="space-y-2 xl:col-span-3">
              <label className="text-sm font-medium">Device / source</label>
              <DatasetSourceSelect
                groups={datasetSourceGroups}
                selectedSourceKey={selectedSourceKey}
                onChange={setSelectedSourceKey}
              />
            </div>

            <div className="space-y-2 xl:col-span-3">
              <label className="text-sm font-medium">Dataset</label>
              <select
                value={datasetId != null ? String(datasetId) : ''}
                onChange={(event) => {
                  const value = event.target.value;
                  hasPinnedDatasetRef.current = true;
                  setDatasetId(value ? Number(value) : null);
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select dataset</option>
                {filteredDatasets.map((dataset) => (
                  <option key={dataset.dinsight_id} value={dataset.dinsight_id}>
                    {formatDatasetOptionLabel(dataset)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {isLoading
                  ? 'Loading datasets...'
                  : `${filteredDatasets.length} dataset(s) found for this source`}
              </p>
            </div>

            <div className="space-y-2 xl:col-span-2">
              <label className="text-sm font-medium">Manual dataset ID</label>
              <div className="flex gap-2">
                <input
                  value={manualDatasetId}
                  onChange={(event) => setManualDatasetId(event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="e.g. 14"
                />
                <Button variant="outline" onClick={applyManualDataset}>
                  Apply
                </Button>
              </div>
              {datasetError && <p className="text-xs text-danger-text">{datasetError}</p>}
            </div>

            <div className="rounded-lg border border-input bg-muted/20 p-3 xl:col-span-4">
              <p className="text-sm font-medium">Workflow guide</p>
              <p className="text-sm text-muted-foreground">
                Step 1: choose data. Step 2: define baseline cluster. Step 3: review results on the
                right.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div
        className={`grid grid-cols-1 gap-6 ${
          isControlsCollapsed ? '' : 'xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]'
        }`}
      >
        {!isControlsCollapsed && (
          <Card className="min-w-0 border-border/60 xl:sticky xl:top-20 xl:h-fit">
            <CardHeader>
              <CardTitle className="text-lg">Controls</CardTitle>
              <CardDescription>
                Configure visualization settings and apply wear trend.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 xl:max-h-[calc(100vh-9.5rem)] xl:overflow-y-auto">
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

        <div className="min-w-0 space-y-6">
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

                      {distancePlot ? (
                        <ChartFrame
                          title="Distance from baseline"
                          description={`Monitoring movement from selected healthy baseline cluster. Thresholds: ${distanceThresholdMethodLabel}.`}
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
                          <div className="h-[540px]">
                            <Plot
                              key={`distance-${isControlsCollapsed ? 'expanded' : 'with-controls'}`}
                              data={distancePlot.data as any}
                              layout={distancePlot.layout as any}
                              config={distancePlot.config as any}
                              revision={distancePlot.revision}
                              useResizeHandler
                              style={{ width: '100%', height: '100%' }}
                            />
                          </div>
                        </ChartFrame>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No distance plot available for the current selection.
                        </p>
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
                          <div className="h-[540px]">
                            <Plot
                              key={`transitions-${isControlsCollapsed ? 'expanded' : 'with-controls'}`}
                              data={transitionPlot.data as any}
                              layout={transitionPlot.layout as any}
                              config={transitionPlot.config as any}
                              revision={transitionPlot.revision}
                              useResizeHandler
                              style={{ width: '100%', height: '100%' }}
                            />
                          </div>
                        </ChartFrame>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No transition plot available. Enable monitoring intervals or choose a
                          dataset with enough ordered intervals.
                        </p>
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
