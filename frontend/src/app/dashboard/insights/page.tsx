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
import { DatasetSourceSelect } from '@/components/datasets/dataset-source-select';
import { useDatasetDiscovery } from '@/hooks/useDatasetDiscovery';
import { useDatasetSourceFilter } from '@/hooks/useDatasetSourceFilter';
import { useActiveStreamingDataset } from '@/hooks/useActiveStreamingDataset';
import { api } from '@/lib/api-client';
import { formatDatasetOptionLabel } from '@/lib/dataset-source-groups';
import { axisRangeRevisionPart, buildPaddedAxisRange } from '@/lib/plot-autoscale';
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
const BASELINE_CLUSTER_PAGE_SIZE = 40;

type DatasetType = 'baseline' | 'monitoring';

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

export default function HealthInsightsPage() {
  const { user } = useAuth();
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

    try {
      const raw = readScoped(INSIGHTS_UI_PREFS_KEY, userId);
      if (!raw) {
        if (window.matchMedia('(max-width: 1279px)').matches) {
          setIsControlsCollapsed(true);
        }
        return;
      }

      const parsed = JSON.parse(raw) as Partial<{
        includeMonitoring: boolean;
        showWearSummaryMetrics: boolean;
        activePlotTab: 'distance' | 'transitions';
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
      if (typeof parsed.isControlsCollapsed === 'boolean') {
        setIsControlsCollapsed(parsed.isControlsCollapsed);
      }
    } catch {
      if (window.matchMedia('(max-width: 1279px)').matches) {
        setIsControlsCollapsed(true);
      }
    }
  }, [userId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    writeScoped(
      INSIGHTS_UI_PREFS_KEY,
      userId,
      JSON.stringify({
        includeMonitoring,
        showWearSummaryMetrics,
        activePlotTab,
        isControlsCollapsed,
      })
    );
  }, [activePlotTab, includeMonitoring, isControlsCollapsed, showWearSummaryMetrics, userId]);

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

  const distancePlot = useMemo(() => {
    if (!shouldRenderWearPlots || !wearResult?.intervals?.length) {
      return null;
    }

    const sorted = [...wearResult.intervals].sort((a, b) => a.sort_index - b.sort_index);
    const x = sorted.map((interval) => interval.sort_index);
    const fullLabels = sorted.map((interval) => interval.metadata_value);
    const maxTicks = 8;
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
    const xAxisRange = buildPaddedAxisRange(x, { minSpan: 1, paddingRatio: 0.03 });
    const yAxisRange = buildPaddedAxisRange([...distanceValues, DISTANCE_AXIS_BASE_MAX], {
      includeZero: true,
      lowerBound: 0,
      minSpan: 0.25,
      paddingRatio: 0.08,
    });
    const autoscaleRevision = [
      'insights-distance',
      wearResult.metadata_column,
      axisRangeRevisionPart(xAxisRange),
      axisRangeRevisionPart(yAxisRange),
    ].join('|');
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
        fillcolor: 'rgba(59,130,246,0.10)',
        line: { width: 0 },
      }));
    const baselineSelectedDistances = sorted
      .filter((interval) => interval.dataset_type === 'baseline' && interval.is_baseline_cluster)
      .map((interval) => interval.distance_from_g0);
    const monitoringDistances = sorted
      .filter((interval) => interval.dataset_type === 'monitoring')
      .map((interval) => interval.distance_from_g0);
    const mean = (values: number[]) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const baselineSelectedMean = mean(baselineSelectedDistances);
    const monitoringMean = mean(monitoringDistances);
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
              line: { color: '#2563EB', dash: 'dot', width: 2 },
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
              line: { color: '#DC2626', dash: 'dash', width: 2 },
            },
          ]
        : []),
    ];
    const meanAnnotations = [
      ...(baselineSelectedMean != null
        ? [
            {
              xref: 'paper' as const,
              yref: 'y' as const,
              x: 0.98,
              y: baselineSelectedMean,
              text: `Selected baseline mean: ${baselineSelectedMean.toFixed(3)}`,
              showarrow: false,
              align: 'right' as const,
              font: { size: 12, color: 'rgba(30, 41, 59, 0.85)' },
              bgcolor: 'rgba(241, 245, 249, 0.75)',
              borderpad: 4,
            },
          ]
        : []),
      ...(monitoringMean != null
        ? [
            {
              xref: 'paper' as const,
              yref: 'y' as const,
              x: 0.02,
              y: monitoringMean,
              text: `Monitoring mean: ${monitoringMean.toFixed(3)}`,
              showarrow: false,
              align: 'left' as const,
              font: { size: 12, color: 'rgba(30, 41, 59, 0.85)' },
              bgcolor: 'rgba(241, 245, 249, 0.75)',
              borderpad: 4,
            },
          ]
        : []),
    ];

    const traces: any[] = [
      {
        x,
        y: baselineSeries,
        text: fullLabels,
        mode: 'lines+markers',
        type: 'scatter',
        name: 'Baseline intervals',
        line: { color: '#2563EB', width: 2 },
        marker: { color: '#2563EB', size: 7 },
        customdata: sorted.map((interval) => [
          interval.metadata_value,
          interval.dataset_type === 'baseline' ? 'Baseline' : 'Monitoring',
          interval.point_count,
        ]),
        hovertemplate:
          'Interval %{customdata[0]}<br>%{customdata[2]} pts · %{customdata[1]}<br>Distance: %{y:.4f}<extra></extra>',
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
          name: 'Monitoring intervals (history)',
          line: { color: 'rgba(220,38,38,0.30)', width: 1.5 },
          marker: { color: 'rgba(220,38,38,0.35)', size: 5 },
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
          name: 'Monitoring intervals (recent)',
          line: { color: '#DC2626', width: 3 },
          marker: { color: '#DC2626', size: 8 },
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
    }

    return {
      data: traces,
      layout: {
        height: 540,
        template: 'plotly_white',
        title: `Distance from Baseline (G0→Gi) by ${wearResult.metadata_column}`,
        xaxis: {
          title: `${wearResult.metadata_column} (Interval Order)`,
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
          title: 'Distance from baseline reference G0',
          autorange: !yAxisRange,
          ...(yAxisRange ? { range: yAxisRange } : {}),
        },
        margin: { t: 72, r: 20, b: 55, l: 56 },
        uirevision: autoscaleRevision,
        transition: { duration: 120 },
        legend: {
          orientation: 'h',
          yanchor: 'bottom',
          y: 1.02,
          xanchor: 'right',
          x: 1,
        },
        shapes: [...baselineClusterShapes, ...meanLines],
        annotations: meanAnnotations,
      } as any,
      config: {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        scrollZoom: true,
        modeBarButtonsToRemove: [
          'lasso2d',
          'select2d',
          'zoomIn2d',
          'zoomOut2d',
          'toImage',
          'toggleSpikelines',
          'hoverCompareCartesian',
          'hoverClosestCartesian',
        ],
      },
    };
  }, [shouldRenderWearPlots, wearResult]);

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
    const mean = (values: number[]) =>
      values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
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
              line: { color: '#2563EB', dash: 'dot', width: 2 },
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
              line: { color: '#DC2626', dash: 'dash', width: 2 },
            },
          ]
        : []),
    ];
    const transitionMeanAnnotations = [
      ...(baselineTransitionMean != null
        ? [
            {
              xref: 'paper' as const,
              yref: 'y' as const,
              x: 0.98,
              y: baselineTransitionMean,
              text: `Selected baseline mean: ${baselineTransitionMean.toFixed(3)}`,
              showarrow: false,
              align: 'right' as const,
              font: { size: 12, color: 'rgba(30, 41, 59, 0.85)' },
              bgcolor: 'rgba(241, 245, 249, 0.75)',
              borderpad: 4,
            },
          ]
        : []),
      ...(monitoringTransitionMean != null
        ? [
            {
              xref: 'paper' as const,
              yref: 'y' as const,
              x: 0.02,
              y: monitoringTransitionMean,
              text: `Monitoring mean: ${monitoringTransitionMean.toFixed(3)}`,
              showarrow: false,
              align: 'left' as const,
              font: { size: 12, color: 'rgba(30, 41, 59, 0.85)' },
              bgcolor: 'rgba(241, 245, 249, 0.75)',
              borderpad: 4,
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
    const autoscaleRevision = [
      'insights-transitions',
      wearResult?.metadata_column ?? 'selected-interval',
      axisRangeRevisionPart(xAxisRange),
      axisRangeRevisionPart(yAxisRange),
    ].join('|');
    return {
      data: [
        {
          x: xValues,
          text: transitions.map((entry) => `${entry.from_label} → ${entry.to_label}`),
          y: transitions.map((transition) => transition.distance),
          mode: 'lines+markers',
          type: 'scattergl',
          marker: { color: '#7C3AED', size: 7 },
          line: { color: '#7C3AED', width: 2 },
          customdata: transitions.map((transition) => [
            transition.from_label,
            transition.to_label,
            transition.from_dataset_type === 'baseline' ? 'Baseline' : 'Monitoring',
            transition.to_dataset_type === 'baseline' ? 'Baseline' : 'Monitoring',
          ]),
          hovertemplate:
            'Transition %{x}: %{customdata[0]} → %{customdata[1]}<br>Source %{customdata[2]} · Dest %{customdata[3]}<br>Distance: %{y:.4f}<extra></extra>',
          name: 'Gi → Gi+1 transition',
        },
      ],
      layout: {
        height: 540,
        template: 'plotly_white',
        title: `Interval Transitions (Gi→Gi+1) by ${wearResult?.metadata_column ?? 'selected interval'}`,
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
        margin: { t: 56, r: 20, b: 55, l: 56 },
        uirevision: autoscaleRevision,
        transition: { duration: 120 },
        showlegend: false,
        shapes: transitionMeanLines,
        annotations: transitionMeanAnnotations,
      } as any,
      config: {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        scrollZoom: true,
        modeBarButtonsToRemove: [
          'lasso2d',
          'select2d',
          'zoomIn2d',
          'zoomOut2d',
          'toImage',
          'toggleSpikelines',
          'hoverCompareCartesian',
          'hoverClosestCartesian',
        ],
      },
    };
  }, [shouldRenderWearPlots, transitionRows, wearResult?.metadata_column]);

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

              <div className="sticky bottom-0 space-y-2 rounded-lg border border-border bg-surface p-3">
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
                            monitoring intervals. Shaded bands mark intervals included in your
                            baseline cluster.
                          </p>
                        )}
                      </div>

                      {distancePlot ? (
                        <Plot
                          key={`distance-${isControlsCollapsed ? 'expanded' : 'with-controls'}`}
                          data={distancePlot.data as any}
                          layout={distancePlot.layout as any}
                          config={distancePlot.config as any}
                          useResizeHandler
                          style={{ width: '100%', height: '100%' }}
                        />
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
                        <Plot
                          key={`transitions-${isControlsCollapsed ? 'expanded' : 'with-controls'}`}
                          data={transitionPlot.data as any}
                          layout={transitionPlot.layout as any}
                          config={transitionPlot.config as any}
                          useResizeHandler
                          style={{ width: '100%', height: '100%' }}
                        />
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
