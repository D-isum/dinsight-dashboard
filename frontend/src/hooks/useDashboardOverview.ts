import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { useDatasetDiscovery } from '@/hooks/useDatasetDiscovery';
import { useDatasetSourceFilter } from '@/hooks/useDatasetSourceFilter';
import { useActiveStreamingDataset } from '@/hooks/useActiveStreamingDataset';
import {
  normalizeCoordinateSeriesFromMonitoringCoordinates,
  normalizeCoordinateSeriesFromMonitoringRows,
} from '@/lib/dataset-normalizers';
import { buildScopedKey, readScoped, writeScoped } from '@/lib/scoped-storage';
import { useAuth } from '@/context/auth-context';
import {
  appendHistoryPoint,
  buildWearTrendAlerts,
  DashboardAlert,
  DashboardHistoryPoint,
  deriveDashboardMachineState,
  deriveWearDirection,
  summarizeAlerts,
  type AlertSeverity,
} from '@/lib/dashboard-overview';
import {
  AppliedWearTrendConfig,
  INSIGHTS_APPLIED_WEAR_CONFIG_EVENT,
  INSIGHTS_APPLIED_WEAR_CONFIG_KEY,
  INSIGHTS_WEAR_PREFS_FIELD,
  parseAppliedWearTrendConfigFromUnknown,
  pickNewestWearConfig,
  parseAppliedWearTrendConfig,
} from '@/lib/insights-wear-config';

interface StreamingStatus {
  total_points: number;
  streamed_points: number;
  progress_percentage: number;
  latest_glow_count: number;
  batch_size: number;
  delay_seconds: number;
  is_active: boolean;
  status: 'not_started' | 'streaming' | 'completed';
}

type DatasetType = 'baseline' | 'monitoring';

interface DeteriorationResult {
  intervals: Array<{
    label: string;
    metadata_value: string;
    dataset_type: DatasetType;
    sort_index: number;
    distance_from_g0: number;
  }>;
  metadata_column: string;
  distances: {
    g0_to_gi_mean: number;
    gi_to_gi_plus_1_mean: number;
  };
}

interface RealtimeAnomalyResult {
  anomaly_percentage: number;
  anomaly_count: number;
  total_points: number;
}

type StreamSpeed = '0.5x' | '1x' | '2x';
type SelectionMode = 'rectangle' | 'lasso' | 'circle' | 'oval';

interface Boundary {
  id: string;
  type: SelectionMode;
  coordinates: number[][];
  center?: { x: number; y: number };
  radius?: number;
  radiusX?: number;
  radiusY?: number;
}

interface DashboardLivePrefs {
  streamSpeed?: StreamSpeed;
  selectedId?: number;
  manualSelectionEnabled?: boolean;
  boundaries?: Boundary[];
  boundariesByDataset?: Record<string, Boundary[]>;
  insightsWearConfig: AppliedWearTrendConfig | null;
  updatedAt: string;
}

interface DashboardHistoryStore {
  points: DashboardHistoryPoint[];
  selectedDatasetId: number | null;
  updatedAt: string;
}

const resolveRefreshMs = (streamSpeed: StreamSpeed | undefined): number => {
  if (streamSpeed === '2x') return 1000;
  if (streamSpeed === '0.5x') return 4000;
  return 2000;
};

// User-scoped suffixes passed to readScoped / writeScoped. The helper builds
// the `dinsight:u<userId>:` prefix so multiple users on the same browser
// don't share live-monitor preferences or timeline history.
const LIVE_MONITOR_PREFS_KEY = 'live-monitor:prefs:v1';
const DASHBOARD_TIMELINE_HISTORY_KEY = 'dashboard:timeline-history:v1';
const DASHBOARD_TIMELINE_HISTORY_PREFS_FIELD = 'dashboardTimelineHistory';

const sanitizeBoundaries = (values: unknown): Boundary[] => {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter(
    (boundary): boundary is Boundary =>
      !!boundary &&
      typeof boundary === 'object' &&
      (boundary.type === 'rectangle' ||
        boundary.type === 'lasso' ||
        boundary.type === 'circle' ||
        boundary.type === 'oval') &&
      Array.isArray(boundary.coordinates)
  );
};

const parseLiveMonitorPrefs = (payload: unknown): DashboardLivePrefs | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const speedRaw = raw.streamSpeed;
  const streamSpeed: StreamSpeed | undefined =
    speedRaw === '2x' || speedRaw === '1x' || speedRaw === '0.5x' ? speedRaw : undefined;
  const selectedIdRaw = raw.selectedId;
  const selectedId =
    typeof selectedIdRaw === 'number' && Number.isInteger(selectedIdRaw) && selectedIdRaw > 0
      ? selectedIdRaw
      : undefined;
  const manualSelectionEnabled =
    typeof raw.manualSelectionEnabled === 'boolean' ? raw.manualSelectionEnabled : undefined;
  const boundaries = sanitizeBoundaries(raw.boundaries);
  const boundariesByDataset: Record<string, Boundary[]> = {};
  if (raw.boundariesByDataset && typeof raw.boundariesByDataset === 'object') {
    Object.entries(raw.boundariesByDataset as Record<string, unknown>).forEach(
      ([datasetId, datasetBoundaries]) => {
        boundariesByDataset[datasetId] = sanitizeBoundaries(datasetBoundaries);
      }
    );
  }
  const meta = raw.__meta;
  const updatedAt =
    meta &&
    typeof meta === 'object' &&
    typeof (meta as Record<string, unknown>).updatedAt === 'string'
      ? String((meta as Record<string, unknown>).updatedAt)
      : new Date(0).toISOString();

  return {
    streamSpeed,
    selectedId,
    manualSelectionEnabled,
    boundaries,
    boundariesByDataset,
    insightsWearConfig: parseAppliedWearTrendConfigFromUnknown(raw[INSIGHTS_WEAR_PREFS_FIELD]),
    updatedAt,
  };
};

const pickNewestLivePrefs = (
  localPrefs: DashboardLivePrefs | null,
  serverPrefs: DashboardLivePrefs | null
): DashboardLivePrefs | null => {
  if (!localPrefs) return serverPrefs;
  if (!serverPrefs) return localPrefs;
  const localTs = Date.parse(localPrefs.updatedAt);
  const serverTs = Date.parse(serverPrefs.updatedAt);
  if (!Number.isFinite(localTs)) return serverPrefs;
  if (!Number.isFinite(serverTs)) return localPrefs;
  return localTs >= serverTs ? localPrefs : serverPrefs;
};

const isPointInRectangle = (x: number, y: number, coordinates: number[][]) => {
  if (coordinates.length < 2) return false;
  const [first, second] = coordinates;
  const xMin = Math.min(first[0], second[0]);
  const xMax = Math.max(first[0], second[0]);
  const yMin = Math.min(first[1], second[1]);
  const yMax = Math.max(first[1], second[1]);
  return x >= xMin && x <= xMax && y >= yMin && y <= yMax;
};

const isPointInCircle = (x: number, y: number, center: { x: number; y: number }, radius: number) =>
  (x - center.x) ** 2 + (y - center.y) ** 2 <= radius ** 2;

const isPointInOval = (
  x: number,
  y: number,
  center: { x: number; y: number },
  radiusX: number,
  radiusY: number
) => {
  if (radiusX <= 0 || radiusY <= 0) return false;
  return (x - center.x) ** 2 / radiusX ** 2 + (y - center.y) ** 2 / radiusY ** 2 <= 1;
};

const isPointInPolygon = (x: number, y: number, coordinates: number[][]) => {
  if (coordinates.length < 3) return false;

  let inside = false;
  for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
    const xi = coordinates[i][0];
    const yi = coordinates[i][1];
    const xj = coordinates[j][0];
    const yj = coordinates[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
};

const readAppliedConfigFromStorage = (
  userId: number | string | null | undefined
): AppliedWearTrendConfig | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return parseAppliedWearTrendConfig(readScoped(INSIGHTS_APPLIED_WEAR_CONFIG_KEY, userId));
};

const sanitizeDashboardHistoryPoints = (payload: unknown): DashboardHistoryPoint[] => {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const raw = entry as Record<string, unknown>;
      const timestamp =
        typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)
          ? raw.timestamp
          : Date.now();
      const anomalyPercentage =
        typeof raw.anomalyPercentage === 'number' && Number.isFinite(raw.anomalyPercentage)
          ? raw.anomalyPercentage
          : null;
      const wearScore =
        typeof raw.wearScore === 'number' && Number.isFinite(raw.wearScore) ? raw.wearScore : null;
      const throughputPerMinute =
        typeof raw.throughputPerMinute === 'number' && Number.isFinite(raw.throughputPerMinute)
          ? raw.throughputPerMinute
          : null;
      return { timestamp, anomalyPercentage, wearScore, throughputPerMinute };
    })
    .filter((point): point is DashboardHistoryPoint => point != null)
    .slice(-10_000);
};

const parseDashboardHistoryStore = (payload: unknown): DashboardHistoryStore | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const points = sanitizeDashboardHistoryPoints(raw.points);
  const selectedDatasetId =
    typeof raw.selectedDatasetId === 'number' && Number.isFinite(raw.selectedDatasetId)
      ? raw.selectedDatasetId
      : null;
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString();
  return { points, selectedDatasetId, updatedAt };
};

const pickNewestHistoryStore = (
  localHistory: DashboardHistoryStore | null,
  serverHistory: DashboardHistoryStore | null
): DashboardHistoryStore | null => {
  if (!localHistory) return serverHistory;
  if (!serverHistory) return localHistory;
  const localTs = Date.parse(localHistory.updatedAt);
  const serverTs = Date.parse(serverHistory.updatedAt);
  if (!Number.isFinite(localTs)) return serverHistory;
  if (!Number.isFinite(serverTs)) return localHistory;
  return localTs >= serverTs ? localHistory : serverHistory;
};

export function useDashboardOverview() {
  const { user } = useAuth();
  const userId = user?.id;
  const [history, setHistory] = useState<DashboardHistoryPoint[]>([]);
  const [appliedWearConfig, setAppliedWearConfig] = useState<AppliedWearTrendConfig | null>(null);
  const [finalizedAnomalyPercentage, setFinalizedAnomalyPercentage] = useState<number | null>(null);
  const [lastKnownAnomalyPercentage, setLastKnownAnomalyPercentage] = useState<number | null>(null);
  const [localLivePrefs, setLocalLivePrefs] = useState<DashboardLivePrefs | null>(null);
  const [localHistoryStore, setLocalHistoryStore] = useState<DashboardHistoryStore | null>(null);
  const [isLocalHistoryLoaded, setIsLocalHistoryLoaded] = useState(false);
  const hasHydratedTimelineHistoryRef = useRef(false);
  const historyPersistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const sync = () => setAppliedWearConfig(readAppliedConfigFromStorage(userId));
    sync();

    // Storage events fire with the fully-qualified scoped key (e.g.
    // `dinsight:u123:insights-applied-wear-config-v1`), so we compare
    // against the scoped form, not the bare suffix.
    const scopedAppliedKey = buildScopedKey(INSIGHTS_APPLIED_WEAR_CONFIG_KEY, userId);
    const onStorage = (event: StorageEvent) => {
      if (event.key == null || event.key === scopedAppliedKey) {
        sync();
      }
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(INSIGHTS_APPLIED_WEAR_CONFIG_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(INSIGHTS_APPLIED_WEAR_CONFIG_EVENT, sync);
    };
  }, [userId]);

  useEffect(() => {
    const syncLocalPrefs = () => {
      if (typeof window === 'undefined') {
        return;
      }
      try {
        const raw = readScoped(LIVE_MONITOR_PREFS_KEY, userId);
        setLocalLivePrefs(parseLiveMonitorPrefs(raw ? JSON.parse(raw) : null));
      } catch {
        setLocalLivePrefs(null);
      }
    };

    syncLocalPrefs();
    const scopedLivePrefsKey = buildScopedKey(LIVE_MONITOR_PREFS_KEY, userId);
    const onStorage = (event: StorageEvent) => {
      if (event.key == null || event.key === scopedLivePrefsKey) {
        syncLocalPrefs();
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const raw = readScoped(DASHBOARD_TIMELINE_HISTORY_KEY, userId);
      setLocalHistoryStore(parseDashboardHistoryStore(raw ? JSON.parse(raw) : null));
    } catch {
      setLocalHistoryStore(null);
    } finally {
      setIsLocalHistoryLoaded(true);
    }
  }, [userId]);

  const {
    datasets,
    isLoading: isLoadingDatasets,
    refetch: refetchDatasets,
  } = useDatasetDiscovery({
    queryKey: ['dashboard-datasets'],
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const {
    groups: datasetSourceGroups,
    selectedSourceKey,
    setSelectedSourceKey,
    filteredDatasets,
    filteredDatasetIds,
    latestFilteredDatasetId,
  } = useDatasetSourceFilter(datasets);

  const { data: serverLivePrefs } = useQuery<DashboardLivePrefs | null>({
    queryKey: ['dashboard-live-monitor-preferences'],
    queryFn: async () => {
      try {
        const response = await api.users.getLiveMonitorPreferences();
        const preferences = (response?.data?.data?.preferences ?? {}) as Record<string, unknown>;
        const updatedAt = response?.data?.data?.updated_at as string | undefined;
        const payload =
          updatedAt && (!preferences.__meta || typeof preferences.__meta !== 'object')
            ? {
                ...preferences,
                __meta: { updatedAt },
              }
            : preferences;
        return parseLiveMonitorPrefs(payload);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
    retry: false,
  });

  const { data: serverHistoryStore, isFetched: hasFetchedServerHistoryStore } =
    useQuery<DashboardHistoryStore | null>({
      queryKey: ['dashboard-timeline-history-preferences'],
      queryFn: async () => {
        try {
          const response = await api.users.getLiveMonitorPreferences();
          const preferences = (response?.data?.data?.preferences ?? {}) as Record<string, unknown>;
          return parseDashboardHistoryStore(preferences[DASHBOARD_TIMELINE_HISTORY_PREFS_FIELD]);
        } catch {
          return null;
        }
      },
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
      retry: false,
    });

  const livePrefs = useMemo(
    () => pickNewestLivePrefs(localLivePrefs, serverLivePrefs ?? null),
    [localLivePrefs, serverLivePrefs]
  );
  const liveRefreshMs = resolveRefreshMs(livePrefs?.streamSpeed);
  const { activeStreamingDatasetId } = useActiveStreamingDataset(filteredDatasetIds, liveRefreshMs);
  const selectedLivePreferenceId =
    livePrefs?.selectedId && filteredDatasetIds.includes(livePrefs.selectedId)
      ? livePrefs.selectedId
      : null;
  const activeDatasetId =
    activeStreamingDatasetId ?? selectedLivePreferenceId ?? latestFilteredDatasetId ?? null;
  const resolvedWearConfig = useMemo(
    () => pickNewestWearConfig(appliedWearConfig, livePrefs?.insightsWearConfig ?? null),
    [appliedWearConfig, livePrefs?.insightsWearConfig]
  );
  const configuredWearDatasetId =
    resolvedWearConfig?.datasetId && filteredDatasetIds.includes(resolvedWearConfig.datasetId)
      ? resolvedWearConfig.datasetId
      : null;
  const wearDatasetId =
    activeStreamingDatasetId ?? configuredWearDatasetId ?? latestFilteredDatasetId ?? null;
  const wearColumn = resolvedWearConfig?.metadataColumn ?? '';
  const wearClusterValues = resolvedWearConfig?.baselineClusterValues ?? [];
  const wearRange = resolvedWearConfig?.baselineRange;
  const includeMonitoring = resolvedWearConfig?.includeMonitoring ?? true;

  const {
    data: streamingStatus,
    isLoading: isLoadingStreaming,
    refetch: refetchStreaming,
  } = useQuery<StreamingStatus | null>({
    queryKey: ['dashboard-streaming-status', activeDatasetId],
    enabled: !!activeDatasetId,
    queryFn: async () => {
      if (!activeDatasetId) return null;
      const response = await api.streaming.getStatus(activeDatasetId);
      return response?.data?.success ? (response.data.data as StreamingStatus) : null;
    },
    staleTime: 8_000,
    refetchInterval: liveRefreshMs,
    retry: false,
  });

  const {
    data: realtimeAnomaly,
    isLoading: isLoadingRealtimeAnomaly,
    refetch: refetchRealtimeAnomaly,
  } = useQuery<{
    anomalyPercentage: number | null;
    anomalyCount: number;
    totalPoints: number;
  }>({
    queryKey: ['dashboard-realtime-anomaly', activeDatasetId],
    // Anomaly detection needs at least one monitoring point for the
    // baseline; the BE returns 404 (MONITORING_DATA_EMPTY) otherwise.
    // Gate on streamed_points so the dashboard doesn't fire the request
    // in the gap between "stream started" and "first point arrived",
    // which used to log a failure row in the audit log on every poll.
    enabled:
      !!activeDatasetId &&
      streamingStatus?.status !== 'not_started' &&
      (streamingStatus?.streamed_points ?? 0) > 0,
    queryFn: async () => {
      if (!activeDatasetId) {
        return { anomalyPercentage: null, anomalyCount: 0, totalPoints: 0 };
      }

      try {
        const response = await api.anomaly.detect({
          baseline_dataset_id: activeDatasetId,
          comparison_dataset_id: activeDatasetId,
          sensitivity_factor: 3.0,
          detection_method: 'mahalanobis',
        });
        const payload = response?.data?.data as RealtimeAnomalyResult | undefined;
        if (!payload || typeof payload.anomaly_percentage !== 'number') {
          return { anomalyPercentage: null, anomalyCount: 0, totalPoints: 0 };
        }
        return {
          anomalyPercentage: payload.anomaly_percentage,
          anomalyCount: payload.anomaly_count ?? 0,
          totalPoints: payload.total_points ?? 0,
        };
      } catch {
        return { anomalyPercentage: null, anomalyCount: 0, totalPoints: 0 };
      }
    },
    staleTime: 5_000,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
    refetchInterval: streamingStatus?.is_active ? liveRefreshMs : false,
    retry: false,
  });

  const activeBoundaries = useMemo(() => {
    if (!livePrefs) {
      return [] as Boundary[];
    }
    if (!activeDatasetId) {
      return sanitizeBoundaries(livePrefs.boundaries);
    }
    const byDataset = livePrefs.boundariesByDataset?.[String(activeDatasetId)] ?? [];
    if (byDataset.length > 0) {
      return byDataset;
    }
    return sanitizeBoundaries(livePrefs.boundaries);
  }, [activeDatasetId, livePrefs]);

  const manualModeEnabled = Boolean(
    livePrefs?.manualSelectionEnabled && activeBoundaries.length > 0
  );

  const { data: manualAnomaly, refetch: refetchManualAnomaly } = useQuery<{
    anomalyPercentage: number | null;
    anomalyCount: number;
    totalPoints: number;
  }>({
    queryKey: ['dashboard-manual-anomaly', activeDatasetId, JSON.stringify(activeBoundaries)],
    enabled: Boolean(
      activeDatasetId &&
      manualModeEnabled &&
      streamingStatus?.status !== 'not_started' &&
      streamingStatus?.streamed_points &&
      streamingStatus.streamed_points > 0
    ),
    queryFn: async () => {
      if (!activeDatasetId) {
        return { anomalyPercentage: null, anomalyCount: 0, totalPoints: 0 };
      }
      try {
        const response = await api.monitoring.getCoordinates(activeDatasetId, {
          max_points: 100_000,
        });
        const monitoring =
          normalizeCoordinateSeriesFromMonitoringCoordinates(response?.data, false) ??
          normalizeCoordinateSeriesFromMonitoringRows(response?.data, false);
        const xValues = monitoring?.dinsight_x ?? [];
        const yValues = monitoring?.dinsight_y ?? [];
        const total = Math.min(xValues.length, yValues.length);
        if (total === 0) {
          return { anomalyPercentage: null, anomalyCount: 0, totalPoints: 0 };
        }

        let anomalyCount = 0;
        for (let index = 0; index < total; index += 1) {
          const x = Number(xValues[index]);
          const y = Number(yValues[index]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            continue;
          }
          let inside = false;
          for (const boundary of activeBoundaries) {
            if (boundary.type === 'rectangle') {
              inside = isPointInRectangle(x, y, boundary.coordinates);
            } else if (boundary.type === 'lasso') {
              inside = isPointInPolygon(x, y, boundary.coordinates);
            } else if (boundary.type === 'circle' && boundary.center && boundary.radius) {
              inside = isPointInCircle(x, y, boundary.center, boundary.radius);
            } else if (
              boundary.type === 'oval' &&
              boundary.center &&
              boundary.radiusX &&
              boundary.radiusY
            ) {
              inside = isPointInOval(x, y, boundary.center, boundary.radiusX, boundary.radiusY);
            }

            if (inside) {
              break;
            }
          }
          if (!inside) {
            anomalyCount += 1;
          }
        }

        return {
          anomalyPercentage: total > 0 ? (anomalyCount / total) * 100 : null,
          anomalyCount,
          totalPoints: total,
        };
      } catch {
        return { anomalyPercentage: null, anomalyCount: 0, totalPoints: 0 };
      }
    },
    staleTime: 2_000,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
    refetchInterval: streamingStatus?.is_active ? liveRefreshMs : false,
    retry: false,
  });

  useEffect(() => {
    const currentAnomaly = manualModeEnabled
      ? manualAnomaly?.anomalyPercentage
      : realtimeAnomaly?.anomalyPercentage;

    if (streamingStatus?.status === 'streaming') {
      setFinalizedAnomalyPercentage(null);
      return;
    }

    if (
      streamingStatus?.status === 'completed' &&
      finalizedAnomalyPercentage == null &&
      currentAnomaly != null
    ) {
      setFinalizedAnomalyPercentage(currentAnomaly);
    }
  }, [
    finalizedAnomalyPercentage,
    manualAnomaly?.anomalyPercentage,
    manualModeEnabled,
    realtimeAnomaly?.anomalyPercentage,
    streamingStatus?.status,
  ]);

  const {
    data: wearSnapshot,
    isLoading: isLoadingWear,
    isFetching: isFetchingWear,
    error: wearError,
    refetch: refetchWear,
  } = useQuery<{
    datasetId: number;
    score: number;
    transitionMean: number;
    metadataColumn: string;
    capturedAt: string;
    previewSeries: Array<{
      label: string;
      sortIndex: number;
      distance: number;
      datasetType: DatasetType;
    }>;
    monitoringDistance: {
      mean: number | null;
      latest: number | null;
      max: number | null;
      sampleCount: number;
    };
  } | null>({
    queryKey: [
      'dashboard-wear-snapshot',
      wearDatasetId,
      wearColumn,
      includeMonitoring,
      JSON.stringify(wearClusterValues),
      wearRange ? `${wearRange.start}:${wearRange.end}` : '',
      resolvedWearConfig?.appliedAt ?? '',
    ],
    // The deterioration service rejects requests with an empty cluster
    // selection (no values AND no range) with HTTP 400, since it can't
    // anchor the wear-trend computation. Gate the query so a saved
    // wear config that hasn't picked a cluster yet doesn't pollute the
    // audit log with failure rows on every dashboard mount.
    enabled: Boolean(
      wearDatasetId &&
      wearColumn &&
      resolvedWearConfig &&
      (wearClusterValues.length > 0 || (wearRange?.start && wearRange?.end))
    ),
    queryFn: async () => {
      if (!wearDatasetId || !wearColumn || !resolvedWearConfig) {
        return null;
      }

      const response = await api.deterioration.analyze(wearDatasetId, {
        metadata_column: wearColumn,
        include_monitoring: true,
        baseline_cluster: {
          values: wearClusterValues,
          ...(wearRange ? { range: wearRange } : {}),
        },
      });

      const payload = response?.data?.data as DeteriorationResult | undefined;
      if (!payload || typeof payload?.distances?.g0_to_gi_mean !== 'number') {
        return null;
      }

      const previewSeries = Array.isArray(payload.intervals)
        ? payload.intervals
            .map((interval) => ({
              label: String(interval.metadata_value ?? interval.label ?? ''),
              sortIndex: Number(interval.sort_index ?? 0),
              distance: Number(interval.distance_from_g0 ?? 0),
              datasetType: interval.dataset_type,
            }))
            .filter((entry) => Number.isFinite(entry.distance))
            .sort((a, b) => a.sortIndex - b.sortIndex)
        : [];

      const monitoringDistances = Array.isArray(payload.intervals)
        ? payload.intervals
            .filter((interval) => interval.dataset_type === 'monitoring')
            .map((interval) => Number(interval.distance_from_g0))
            .filter((value) => Number.isFinite(value))
        : [];
      const monitoringLatest =
        monitoringDistances.length > 0 ? monitoringDistances[monitoringDistances.length - 1] : null;
      const monitoringMean =
        monitoringDistances.length > 0
          ? monitoringDistances.reduce((sum, value) => sum + value, 0) / monitoringDistances.length
          : null;
      const monitoringMax =
        monitoringDistances.length > 0 ? Math.max(...monitoringDistances) : null;

      return {
        datasetId: wearDatasetId,
        score: payload.distances.g0_to_gi_mean,
        transitionMean:
          typeof payload.distances.gi_to_gi_plus_1_mean === 'number'
            ? payload.distances.gi_to_gi_plus_1_mean
            : 0,
        metadataColumn: payload.metadata_column || wearColumn,
        capturedAt: new Date().toISOString(),
        previewSeries,
        monitoringDistance: {
          mean: monitoringMean,
          latest: monitoringLatest,
          max: monitoringMax,
          sampleCount: monitoringDistances.length,
        },
      };
    },
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    refetchInterval: streamingStatus?.is_active ? liveRefreshMs : false,
    retry: false,
  });

  // Backend alerts: persisted records from rules that fired against
  // stored anomaly classifications. Polled every 30s so the dashboard's
  // alert tile stays fresh without hammering the server.
  const backendAlertsQuery = useQuery<DashboardAlert[]>({
    queryKey: ['dashboard-active-alerts'],
    queryFn: async () => {
      const res = await api.alerts.list({ status: 'active' });
      // GET /api/v1/alerts is paginated:
      //   { data: { alerts: [...], total, page, limit }, success: true }
      // Tolerate both shapes so the hook keeps working if the BE
      // ever returns a bare array again.
      const payload = res?.data?.data;
      const items = (Array.isArray(payload) ? payload : (payload?.alerts ?? [])) as Array<{
        id: number;
        title: string;
        message: string;
        severity: string;
        status: string;
        anomaly_percentage: number;
        created_at: string;
      }>;
      return items.map((a) => ({
        id: a.id,
        title: a.title,
        message: a.message,
        severity: (['low', 'medium', 'high', 'critical'].includes(a.severity)
          ? a.severity
          : 'medium') as AlertSeverity,
        status: 'active' as const,
        anomalyPercentage: a.anomaly_percentage,
        createdAt: a.created_at,
      }));
    },
    refetchInterval: 30_000,
    retry: false,
  });

  // Synthesized wear-trend advisories. These run on local data shape
  // (no backend involvement) so they keep working even before the
  // alert pipeline has any rules + classifications. Combined with
  // backend alerts so the dashboard tile reflects every reason a user
  // should pay attention right now.
  const wearTrendAlerts = useMemo(
    () =>
      buildWearTrendAlerts({
        datasetId: wearSnapshot?.datasetId ?? null,
        metadataColumn: wearSnapshot?.metadataColumn ?? wearColumn,
        monitoringMean: wearSnapshot?.monitoringDistance.mean ?? null,
        monitoringLatest: wearSnapshot?.monitoringDistance.latest ?? null,
        monitoringMax: wearSnapshot?.monitoringDistance.max ?? null,
        sampleCount: wearSnapshot?.monitoringDistance.sampleCount ?? 0,
      }),
    [wearColumn, wearSnapshot]
  );
  const alerts = useMemo(
    () => [...(backendAlertsQuery.data ?? []), ...wearTrendAlerts],
    [backendAlertsQuery.data, wearTrendAlerts]
  );
  const alertSummary = useMemo(() => summarizeAlerts(alerts), [alerts]);
  const liveAnomalyPercentage = manualModeEnabled
    ? (manualAnomaly?.anomalyPercentage ?? null)
    : (realtimeAnomaly?.anomalyPercentage ?? null);

  useEffect(() => {
    if (liveAnomalyPercentage != null) {
      setLastKnownAnomalyPercentage(liveAnomalyPercentage);
    }
  }, [liveAnomalyPercentage]);

  const latestAnomalyPercentage =
    streamingStatus?.status === 'completed'
      ? (finalizedAnomalyPercentage ?? liveAnomalyPercentage)
      : (liveAnomalyPercentage ?? lastKnownAnomalyPercentage);

  const machineStatus = useMemo(
    () =>
      deriveDashboardMachineState({
        anomalyPercentage: latestAnomalyPercentage,
        wearScore: wearSnapshot?.score ?? null,
      }),
    [latestAnomalyPercentage, wearSnapshot?.score]
  );

  useEffect(() => {
    const now = Date.now();

    setHistory((prev) =>
      appendHistoryPoint(prev, {
        timestamp: now,
        anomalyPercentage: latestAnomalyPercentage,
        wearScore: wearSnapshot?.score ?? null,
        throughputPerMinute: null,
      })
    );
  }, [latestAnomalyPercentage, streamingStatus?.streamed_points, wearSnapshot?.score]);

  const wearDirection = useMemo(() => {
    if (history.length < 2) {
      return 'stable' as const;
    }

    const previous = history[history.length - 2]?.wearScore ?? null;
    const current = history[history.length - 1]?.wearScore ?? null;
    return deriveWearDirection(previous, current);
  }, [history]);

  const refetchAll = useCallback(async () => {
    await Promise.all([
      refetchDatasets(),
      refetchStreaming(),
      refetchRealtimeAnomaly(),
      refetchManualAnomaly(),
      refetchWear(),
    ]);
  }, [
    refetchDatasets,
    refetchManualAnomaly,
    refetchRealtimeAnomaly,
    refetchStreaming,
    refetchWear,
  ]);

  const activeRealtimeAnomaly = manualModeEnabled
    ? (manualAnomaly ?? { anomalyPercentage: null, anomalyCount: 0, totalPoints: 0 })
    : (realtimeAnomaly ?? { anomalyPercentage: null, anomalyCount: 0, totalPoints: 0 });

  useEffect(() => {
    if (
      hasHydratedTimelineHistoryRef.current ||
      !hasFetchedServerHistoryStore ||
      !isLocalHistoryLoaded
    ) {
      return;
    }
    const resolvedHistoryStore = pickNewestHistoryStore(
      localHistoryStore,
      serverHistoryStore ?? null
    );
    if (resolvedHistoryStore?.points?.length) {
      setHistory(resolvedHistoryStore.points);
    }
    hasHydratedTimelineHistoryRef.current = true;
  }, [hasFetchedServerHistoryStore, isLocalHistoryLoaded, localHistoryStore, serverHistoryStore]);

  const persistTimelineHistoryToServer = useCallback(
    async (points: DashboardHistoryPoint[], selectedDatasetId: number | null) => {
      try {
        const latest = await api.users.getLiveMonitorPreferences();
        const existing = (latest?.data?.data?.preferences ?? {}) as Record<string, unknown>;
        const payload: DashboardHistoryStore = {
          points: points.slice(-10_000),
          selectedDatasetId,
          updatedAt: new Date().toISOString(),
        };
        await api.users.updateLiveMonitorPreferences({
          ...existing,
          [DASHBOARD_TIMELINE_HISTORY_PREFS_FIELD]: payload,
        });
      } catch {
        // Local persistence still keeps timeline history across refresh.
      }
    },
    []
  );

  useEffect(() => {
    if (!hasHydratedTimelineHistoryRef.current) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const payload: DashboardHistoryStore = {
      points: history.slice(-10_000),
      selectedDatasetId: activeDatasetId ?? null,
      updatedAt: new Date().toISOString(),
    };
    writeScoped(DASHBOARD_TIMELINE_HISTORY_KEY, userId, JSON.stringify(payload));

    if (historyPersistTimerRef.current) {
      window.clearTimeout(historyPersistTimerRef.current);
    }
    historyPersistTimerRef.current = window.setTimeout(() => {
      void persistTimelineHistoryToServer(payload.points, payload.selectedDatasetId);
    }, 2_500);

    return () => {
      if (historyPersistTimerRef.current) {
        window.clearTimeout(historyPersistTimerRef.current);
      }
    };
  }, [activeDatasetId, history, persistTimelineHistoryToServer, userId]);

  return {
    datasets: filteredDatasets,
    latestDatasetId: latestFilteredDatasetId,
    datasetSourceGroups,
    selectedSourceKey,
    setSelectedSourceKey,
    selectedLiveDatasetId: activeDatasetId,
    streamingStatus,
    alerts,
    alertSummary,
    wearSnapshot,
    wearDirection,
    machineStatus,
    history,
    latestAnomalyPercentage,
    realtimeAnomaly: activeRealtimeAnomaly,
    anomalySource: manualModeEnabled ? 'manual-boundary' : 'model-detection',
    wearColumn: wearSnapshot?.metadataColumn ?? wearColumn,
    liveRefreshMs,
    appliedWearConfig: resolvedWearConfig,
    isLoading: isLoadingDatasets || isLoadingStreaming || isLoadingRealtimeAnomaly || isLoadingWear,
    isRefreshingWear: isFetchingWear,
    wearError: wearError ? (wearError as Error).message : null,
    refetchAll,
  };
}
