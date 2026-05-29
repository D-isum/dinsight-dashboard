'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Clock,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Square,
  Trash2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { MetadataHoverControls } from '@/components/metadata-hover-controls';
import { useMetadataHover } from '@/hooks/useMetadataHover';
import { useDatasetDiscovery } from '@/hooks/useDatasetDiscovery';
import { useBaselineMonitoringData } from '@/hooks/useBaselineMonitoringData';
import { useMachineHealthStatus } from '@/hooks/useMachineHealthStatus';
import { api } from '@/lib/api-client';
import type { CoordinateSeries } from '@/lib/dataset-normalizers';
import { readScoped, writeScoped } from '@/lib/scoped-storage';
import { useAuth } from '@/context/auth-context';
import { cn } from '@/utils/cn';

import { PlotCanvas as Plot } from '@/components/charts/plot-canvas';

type SelectionMode = 'rectangle' | 'lasso' | 'circle' | 'oval';

type Boundary = {
  id: string;
  type: SelectionMode;
  coordinates: number[][];
  center?: { x: number; y: number };
  radius?: number;
  radiusX?: number;
  radiusY?: number;
};

interface StreamingStatus {
  total_points: number;
  streamed_points: number;
  progress_percentage: number;
  latest_glow_count: number;
  is_active: boolean;
  status: 'not_started' | 'streaming' | 'completed';
}

interface AnomalyPoint {
  index: number;
  x: number;
  y: number;
  is_anomaly: boolean;
}

interface AnomalyDetectionResult {
  anomaly_percentage: number;
  anomaly_count: number;
  total_points: number;
  anomalous_points: AnomalyPoint[];
}

const stateTone: Record<'OK' | 'Deteriorating' | 'Failing', string> = {
  OK: 'border-success-border bg-success-bg text-success-text   ',
  Deteriorating: 'border-warning-border bg-warning-bg text-warning-text   ',
  Failing: 'border-danger-border bg-danger-bg text-danger-text   ',
};

// LIVE_MONITOR_PREFS_KEY is the bare suffix passed to readScoped/writeScoped;
// the helper prefixes it with `dinsight:u<userId>:` so two users on the same
// browser can't read each other's saved live-monitor preferences.
//
// LIVE_MONITOR_DEVICE_ID_KEY is intentionally NOT user-scoped — it identifies
// the browser/device for multi-device sync, not the user, so it stays flat.
const LIVE_MONITOR_PREFS_KEY = 'live-monitor:prefs:v1';
const LIVE_MONITOR_DEVICE_ID_KEY = 'dinsight:live-monitor:device-id:v1';

type PersistedLiveMonitorPreferences = {
  selectedId?: number;
  manualDatasetId?: string;
  autoRefresh?: boolean;
  streamSpeed?: '0.5x' | '1x' | '2x';
  showAdvanced?: boolean;
  pointSize?: number;
  showContours?: boolean;
  manualSelectionEnabled?: boolean;
  selectionMode?: SelectionMode;
  enableMultipleSelections?: boolean;
  boundaries?: Boundary[];
  boundariesByDataset?: Record<string, Boundary[]>;
  metadataEnabled?: boolean;
  selectedMetadataKeys?: string[];
  insightsWearTrend?: unknown;
  insightsWearTrendDraft?: unknown;
  __meta?: {
    deviceId?: string;
    updatedAt?: string;
    version?: number;
  };
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

const toSelectionBounds = (selection: any) => {
  if (selection?.range?.x && selection?.range?.y) {
    const xRange = selection.range.x;
    const yRange = selection.range.y;
    if (
      Array.isArray(xRange) &&
      Array.isArray(yRange) &&
      xRange.length >= 2 &&
      yRange.length >= 2
    ) {
      const x1 = Number(xRange[0]);
      const x2 = Number(xRange[1]);
      const y1 = Number(yRange[0]);
      const y2 = Number(yRange[1]);
      if (![x1, x2, y1, y2].every((value) => Number.isFinite(value))) {
        return null;
      }
      return {
        x1,
        x2,
        y1,
        y2,
      };
    }
  }

  const points: any[] = Array.isArray(selection?.points) ? selection.points : [];
  if (points.length === 0) {
    return null;
  }

  const xs = points.map((point) => Number(point.x)).filter((value) => Number.isFinite(value));
  const ys = points.map((point) => Number(point.y)).filter((value) => Number.isFinite(value));
  if (xs.length === 0 || ys.length === 0) {
    return null;
  }

  return {
    x1: Math.min(...xs),
    x2: Math.max(...xs),
    y1: Math.min(...ys),
    y2: Math.max(...ys),
  };
};

const createBoundary = (selection: any, selectionMode: SelectionMode): Boundary | null => {
  if (selectionMode === 'lasso') {
    const lassoX: number[] = Array.isArray(selection?.lassoPoints?.x)
      ? selection.lassoPoints.x.map((value: unknown) => Number(value)).filter(Number.isFinite)
      : [];
    const lassoY: number[] = Array.isArray(selection?.lassoPoints?.y)
      ? selection.lassoPoints.y.map((value: unknown) => Number(value)).filter(Number.isFinite)
      : [];

    const fromLasso = lassoX.length >= 3 && lassoX.length === lassoY.length;
    const coordinates = fromLasso
      ? lassoX.map((x, index) => [x, lassoY[index]])
      : (Array.isArray(selection?.points) ? selection.points : [])
          .map((point: any) => [Number(point.x), Number(point.y)])
          .filter(
            (point: number[]) =>
              point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])
          );

    if (coordinates.length < 3) {
      return null;
    }

    return {
      id: `boundary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'lasso',
      coordinates,
    };
  }

  const bounds = toSelectionBounds(selection);
  if (!bounds) {
    return null;
  }

  const { x1, x2, y1, y2 } = bounds;
  const center = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };

  if (selectionMode === 'rectangle') {
    return {
      id: `boundary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'rectangle',
      coordinates: [
        [x1, y1],
        [x2, y2],
      ],
    };
  }

  if (selectionMode === 'circle') {
    const radius = Math.max(Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2, 1e-6);
    return {
      id: `boundary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'circle',
      coordinates: [],
      center,
      radius,
    };
  }

  return {
    id: `boundary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: 'oval',
    coordinates: [],
    center,
    radiusX: Math.max(Math.abs(x2 - x1) / 2, 1e-6),
    radiusY: Math.max(Math.abs(y2 - y1) / 2, 1e-6),
  };
};

const buildBoundaryShape = (boundary: Boundary) => {
  if (boundary.type === 'rectangle' && boundary.coordinates.length >= 2) {
    const [first, second] = boundary.coordinates;
    return {
      type: 'rect' as const,
      x0: Math.min(first[0], second[0]),
      x1: Math.max(first[0], second[0]),
      y0: Math.min(first[1], second[1]),
      y1: Math.max(first[1], second[1]),
      line: { color: '#8b5cf6', width: 2 },
      fillcolor: 'rgba(0,0,0,0)',
      layer: 'above' as const,
    };
  }

  if (boundary.type === 'circle' && boundary.center && boundary.radius) {
    return {
      type: 'circle' as const,
      x0: boundary.center.x - boundary.radius,
      x1: boundary.center.x + boundary.radius,
      y0: boundary.center.y - boundary.radius,
      y1: boundary.center.y + boundary.radius,
      line: { color: '#8b5cf6', width: 2 },
      fillcolor: 'rgba(0,0,0,0)',
      layer: 'above' as const,
    };
  }

  if (boundary.type === 'lasso' && boundary.coordinates.length >= 3) {
    const path = boundary.coordinates
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x},${y}`)
      .join(' ');

    return {
      type: 'path' as const,
      path: `${path} Z`,
      line: { color: '#8b5cf6', width: 2 },
      fillcolor: 'rgba(0,0,0,0)',
      layer: 'above' as const,
    };
  }

  if (boundary.type === 'oval' && boundary.center && boundary.radiusX && boundary.radiusY) {
    return {
      type: 'circle' as const,
      x0: boundary.center.x - boundary.radiusX,
      x1: boundary.center.x + boundary.radiusX,
      y0: boundary.center.y - boundary.radiusY,
      y1: boundary.center.y + boundary.radiusY,
      line: { color: '#8b5cf6', width: 2 },
      fillcolor: 'rgba(0,0,0,0)',
      layer: 'above' as const,
    };
  }

  return null;
};

export default function LiveMonitorPage() {
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [manualDatasetId, setManualDatasetId] = useState('');
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamSpeed, setStreamSpeed] = useState<'0.5x' | '1x' | '2x'>('1x');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pointSize, setPointSize] = useState(8);
  const [showContours, setShowContours] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [anomalyResult, setAnomalyResult] = useState<AnomalyDetectionResult | null>(null);
  const [latestGlowCount, setLatestGlowCount] = useState(5);

  const [manualSelectionEnabled, setManualSelectionEnabled] = useState(false);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('rectangle');
  const [enableMultipleSelections, setEnableMultipleSelections] = useState(false);
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [liveMonitoringData, setLiveMonitoringData] = useState<CoordinateSeries | null>(null);
  const [isPrefsHydrated, setIsPrefsHydrated] = useState(false);
  const [isServerPrefsLoaded, setIsServerPrefsLoaded] = useState(false);
  const [prefsConflict, setPrefsConflict] = useState<{
    server: PersistedLiveMonitorPreferences;
    updatedAt: string;
  } | null>(null);
  const isRestoringPrefsRef = useRef(false);
  const isApplyingPersistedPrefsRef = useRef(false);
  const boundariesByDatasetRef = useRef<Record<string, Boundary[]>>({});
  const serverSaveTimerRef = useRef<number | null>(null);
  const deviceIdRef = useRef('');
  const localPrefsUpdatedAtRef = useRef(0);
  const hasLocalEditsRef = useRef(false);
  const insightsWearTrendRef = useRef<unknown>(undefined);
  const insightsWearTrendDraftRef = useRef<unknown>(undefined);
  const serverPrefsSnapshotRef = useRef<Record<string, unknown>>({});

  const refreshIntervalMs = useMemo(() => {
    if (streamSpeed === '2x') return 1000;
    if (streamSpeed === '0.5x') return 4000;
    return 2000;
  }, [streamSpeed]);

  const {
    datasets,
    latestDatasetId,
    isLoading: isLoadingDatasets,
    refetch: refetchDatasets,
  } = useDatasetDiscovery({
    queryKey: ['available-dinsight-ids'],
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const {
    baselineData,
    monitoringData,
    baselineError,
    monitoringError,
    isLoadingBaseline,
    isLoadingMonitoring,
    refetchBaseline,
    refetchMonitoring,
  } = useBaselineMonitoringData({
    dinsightId: selectedId,
    includeMetadata: true,
    monitoringMode: 'rows',
  });

  const { data: streamingStatus, refetch: refetchStatus } = useQuery<StreamingStatus | null>({
    queryKey: ['streaming-status', selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      if (!selectedId) return null;
      try {
        const response = await api.streaming.getStatus(selectedId);
        return response?.data?.success ? (response.data.data as StreamingStatus) : null;
      } catch {
        return null;
      }
    },
    refetchInterval: autoRefresh && !isSelecting ? refreshIntervalMs : false,
  });

  const effectiveMonitoringData = liveMonitoringData ?? monitoringData;

  const metadataSources = useMemo(
    () => [baselineData?.metadata ?? [], effectiveMonitoringData?.metadata ?? []],
    [baselineData?.metadata, effectiveMonitoringData?.metadata]
  );

  const {
    metadataEnabled,
    setMetadataEnabled,
    selectedKeys: selectedMetadataKeys,
    setSelectedKeys: setSelectedMetadataKeys,
    toggleKey: toggleMetadataKey,
    selectAll: selectAllMetadataKeys,
    clearAll: clearMetadataKeys,
    availableKeys: availableMetadataKeys,
    buildHoverText,
    hasActiveMetadata,
  } = useMetadataHover({ metadataSources });

  useEffect(() => {
    try {
      const existing = window.localStorage.getItem(LIVE_MONITOR_DEVICE_ID_KEY);
      if (existing) {
        deviceIdRef.current = existing;
        return;
      }
      const created = `device-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
      deviceIdRef.current = created;
      window.localStorage.setItem(LIVE_MONITOR_DEVICE_ID_KEY, created);
    } catch {
      deviceIdRef.current = `device-${Date.now()}`;
    }
  }, []);

  const sanitizeBoundaries = useCallback((values: unknown): Boundary[] => {
    if (!Array.isArray(values)) {
      return [];
    }

    const isFiniteCoord = (coord: unknown): coord is [number, number] =>
      Array.isArray(coord) &&
      coord.length >= 2 &&
      Number.isFinite(Number(coord[0])) &&
      Number.isFinite(Number(coord[1]));

    return values.filter((boundary): boundary is Boundary => {
      if (!boundary || typeof boundary !== 'object') {
        return false;
      }

      const candidate = boundary as Partial<Boundary>;
      if (
        candidate.type !== 'rectangle' &&
        candidate.type !== 'lasso' &&
        candidate.type !== 'circle' &&
        candidate.type !== 'oval'
      ) {
        return false;
      }

      if (candidate.type === 'rectangle') {
        return (
          Array.isArray(candidate.coordinates) &&
          candidate.coordinates.length >= 2 &&
          isFiniteCoord(candidate.coordinates[0]) &&
          isFiniteCoord(candidate.coordinates[1])
        );
      }

      if (candidate.type === 'lasso') {
        return (
          Array.isArray(candidate.coordinates) &&
          candidate.coordinates.length >= 3 &&
          candidate.coordinates.every((coord) => isFiniteCoord(coord))
        );
      }

      if (
        !candidate.center ||
        !Number.isFinite(Number(candidate.center.x)) ||
        !Number.isFinite(Number(candidate.center.y))
      ) {
        return false;
      }

      if (candidate.type === 'circle') {
        return Number.isFinite(Number(candidate.radius)) && Number(candidate.radius) > 0;
      }

      return (
        Number.isFinite(Number(candidate.radiusX)) &&
        Number(candidate.radiusX) > 0 &&
        Number.isFinite(Number(candidate.radiusY)) &&
        Number(candidate.radiusY) > 0
      );
    });
  }, []);

  const applyPersistedPreferences = useCallback(
    (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return;
      }

      const parsed = raw as PersistedLiveMonitorPreferences;
      insightsWearTrendRef.current = parsed.insightsWearTrend;
      insightsWearTrendDraftRef.current = parsed.insightsWearTrendDraft;

      isApplyingPersistedPrefsRef.current = true;

      if (
        typeof parsed.selectedId === 'number' &&
        Number.isInteger(parsed.selectedId) &&
        parsed.selectedId > 0
      ) {
        isRestoringPrefsRef.current = true;
        setSelectedId(parsed.selectedId);
      }
      if (typeof parsed.manualDatasetId === 'string') setManualDatasetId(parsed.manualDatasetId);
      if (typeof parsed.autoRefresh === 'boolean') setAutoRefresh(parsed.autoRefresh);
      if (
        parsed.streamSpeed === '0.5x' ||
        parsed.streamSpeed === '1x' ||
        parsed.streamSpeed === '2x'
      ) {
        setStreamSpeed(parsed.streamSpeed);
      }
      if (typeof parsed.showAdvanced === 'boolean') setShowAdvanced(parsed.showAdvanced);
      if (
        typeof parsed.pointSize === 'number' &&
        Number.isFinite(parsed.pointSize) &&
        parsed.pointSize >= 2 &&
        parsed.pointSize <= 20
      ) {
        setPointSize(parsed.pointSize);
      }
      if (typeof parsed.showContours === 'boolean') setShowContours(parsed.showContours);
      if (typeof parsed.manualSelectionEnabled === 'boolean') {
        setManualSelectionEnabled(parsed.manualSelectionEnabled);
      }
      if (
        parsed.selectionMode === 'rectangle' ||
        parsed.selectionMode === 'lasso' ||
        parsed.selectionMode === 'circle' ||
        parsed.selectionMode === 'oval'
      ) {
        setSelectionMode(parsed.selectionMode);
      }
      if (typeof parsed.enableMultipleSelections === 'boolean') {
        setEnableMultipleSelections(parsed.enableMultipleSelections);
      }
      if (typeof parsed.metadataEnabled === 'boolean') setMetadataEnabled(parsed.metadataEnabled);
      if (Array.isArray(parsed.selectedMetadataKeys)) {
        setSelectedMetadataKeys(
          parsed.selectedMetadataKeys.filter((key) => typeof key === 'string')
        );
      }

      if (parsed.boundariesByDataset && typeof parsed.boundariesByDataset === 'object') {
        const normalized: Record<string, Boundary[]> = {};
        Object.entries(parsed.boundariesByDataset).forEach(([datasetId, datasetBoundaries]) => {
          normalized[datasetId] = sanitizeBoundaries(datasetBoundaries);
        });
        boundariesByDatasetRef.current = normalized;
      }

      if (Array.isArray(parsed.boundaries)) {
        const validBoundaries = sanitizeBoundaries(parsed.boundaries);
        boundariesByDatasetRef.current = {
          ...boundariesByDatasetRef.current,
          ...(parsed.selectedId ? { [String(parsed.selectedId)]: validBoundaries } : {}),
        };
        setBoundaries(validBoundaries);
      }

      if (typeof parsed.__meta?.updatedAt === 'string') {
        const timestamp = Date.parse(parsed.__meta.updatedAt);
        if (Number.isFinite(timestamp)) {
          localPrefsUpdatedAtRef.current = timestamp;
        }
      }

      window.setTimeout(() => {
        isApplyingPersistedPrefsRef.current = false;
      }, 0);
    },
    [sanitizeBoundaries, setMetadataEnabled, setSelectedMetadataKeys]
  );

  const { data: serverPreferences, isFetched: serverPreferencesFetched } = useQuery({
    queryKey: ['live-monitor-preferences'],
    queryFn: async () => {
      const response = await api.users.getLiveMonitorPreferences();
      return {
        preferences: (response?.data?.data?.preferences ?? {}) as PersistedLiveMonitorPreferences,
        updatedAt: response?.data?.data?.updated_at as string | undefined,
      };
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    retry: false,
  });

  useEffect(() => {
    try {
      const raw = readScoped(LIVE_MONITOR_PREFS_KEY, user?.id);
      if (!raw) {
        setIsPrefsHydrated(true);
        return;
      }
      applyPersistedPreferences(JSON.parse(raw));
    } catch {
      // Ignore invalid persisted preferences.
    } finally {
      setIsPrefsHydrated(true);
    }
  }, [applyPersistedPreferences, user?.id]);

  useEffect(() => {
    if (!serverPreferencesFetched) {
      return;
    }
    setIsServerPrefsLoaded(true);
    const incoming = serverPreferences?.preferences;
    if (!incoming || Object.keys(incoming).length === 0) {
      return;
    }
    serverPrefsSnapshotRef.current = incoming as unknown as Record<string, unknown>;
    insightsWearTrendRef.current = incoming.insightsWearTrend;
    insightsWearTrendDraftRef.current = incoming.insightsWearTrendDraft;

    const serverUpdatedAtRaw = serverPreferences?.updatedAt ?? incoming.__meta?.updatedAt;
    const serverUpdatedAt = serverUpdatedAtRaw ? Date.parse(serverUpdatedAtRaw) : NaN;
    const serverDeviceId = incoming.__meta?.deviceId;
    const localUpdatedAt = localPrefsUpdatedAtRef.current;
    const isFromAnotherDevice =
      !!serverDeviceId && !!deviceIdRef.current && serverDeviceId !== deviceIdRef.current;
    const isNewerThanLocal = Number.isFinite(serverUpdatedAt) && serverUpdatedAt > localUpdatedAt;

    if (isFromAnotherDevice && isNewerThanLocal && hasLocalEditsRef.current) {
      setPrefsConflict({
        server: incoming,
        updatedAt: serverUpdatedAtRaw ?? '',
      });
      return;
    }

    applyPersistedPreferences(incoming);
    if (Number.isFinite(serverUpdatedAt)) {
      localPrefsUpdatedAtRef.current = serverUpdatedAt;
    }
    hasLocalEditsRef.current = false;
    setPrefsConflict(null);
  }, [applyPersistedPreferences, serverPreferences, serverPreferencesFetched]);

  useEffect(() => {
    if (!isPrefsHydrated) {
      return;
    }
    if (isApplyingPersistedPrefsRef.current) {
      return;
    }

    const nowIso = new Date().toISOString();
    localPrefsUpdatedAtRef.current = Date.parse(nowIso);
    hasLocalEditsRef.current = true;

    const payload = {
      ...serverPrefsSnapshotRef.current,
      selectedId,
      manualDatasetId,
      autoRefresh,
      streamSpeed,
      showAdvanced,
      pointSize,
      showContours,
      manualSelectionEnabled,
      selectionMode,
      enableMultipleSelections,
      boundaries,
      boundariesByDataset: boundariesByDatasetRef.current,
      metadataEnabled,
      selectedMetadataKeys,
      insightsWearTrend: insightsWearTrendRef.current,
      insightsWearTrendDraft: insightsWearTrendDraftRef.current,
      __meta: {
        deviceId: deviceIdRef.current || undefined,
        updatedAt: nowIso,
        version: 1,
      },
    };
    try {
      writeScoped(LIVE_MONITOR_PREFS_KEY, user?.id, JSON.stringify(payload));
    } catch {
      // no-op
    }

    if (!isServerPrefsLoaded) {
      return;
    }

    if (serverSaveTimerRef.current) {
      window.clearTimeout(serverSaveTimerRef.current);
    }
    serverSaveTimerRef.current = window.setTimeout(() => {
      void api.users
        .getLiveMonitorPreferences()
        .then((latest) => {
          const existing = (latest?.data?.data?.preferences ?? {}) as Record<string, unknown>;
          return api.users.updateLiveMonitorPreferences({
            ...existing,
            ...payload,
          });
        })
        .then((response) => {
          const updatedPrefs = (response?.data?.data?.preferences ??
            {}) as PersistedLiveMonitorPreferences;
          serverPrefsSnapshotRef.current = updatedPrefs as unknown as Record<string, unknown>;
          insightsWearTrendRef.current = updatedPrefs.insightsWearTrend;
          insightsWearTrendDraftRef.current = updatedPrefs.insightsWearTrendDraft;

          const updatedAt =
            response?.data?.data?.updated_at || updatedPrefs?.__meta?.updatedAt || nowIso;
          const parsed = Date.parse(updatedAt);
          if (Number.isFinite(parsed)) {
            localPrefsUpdatedAtRef.current = parsed;
          }
          hasLocalEditsRef.current = false;
        })
        .catch(() => {
          // Silent fallback to local persistence.
        });
    }, 800);
  }, [
    autoRefresh,
    boundaries,
    enableMultipleSelections,
    isPrefsHydrated,
    manualDatasetId,
    manualSelectionEnabled,
    metadataEnabled,
    pointSize,
    selectedId,
    selectedMetadataKeys,
    selectionMode,
    showAdvanced,
    showContours,
    streamSpeed,
    isServerPrefsLoaded,
    user?.id,
  ]);

  useEffect(
    () => () => {
      if (serverSaveTimerRef.current) {
        window.clearTimeout(serverSaveTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedId === null && latestDatasetId) {
      setSelectedId(latestDatasetId);
    }
  }, [latestDatasetId, selectedId]);

  useEffect(() => {
    if (selectedId) {
      setManualDatasetId(String(selectedId));
    }
  }, [selectedId]);

  useEffect(() => {
    setAnomalyResult(null);
    setLiveMonitoringData(null);
    if (!selectedId) {
      setBoundaries([]);
      return;
    }

    const restored = boundariesByDatasetRef.current[String(selectedId)] ?? [];
    setBoundaries(restored);

    if (isRestoringPrefsRef.current) {
      isRestoringPrefsRef.current = false;
    }
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    boundariesByDatasetRef.current = {
      ...boundariesByDatasetRef.current,
      [String(selectedId)]: boundaries,
    };
  }, [boundaries, selectedId]);

  useEffect(() => {
    if (!monitoringData) {
      return;
    }

    setLiveMonitoringData((previous) => {
      if (!previous) {
        return monitoringData;
      }

      const prevLen = previous.dinsight_x.length;
      const nextLen = monitoringData.dinsight_x.length;

      if (nextLen < prevLen) {
        return monitoringData;
      }

      if (nextLen === prevLen) {
        return previous;
      }

      return {
        dinsight_x: [...previous.dinsight_x, ...monitoringData.dinsight_x.slice(prevLen)],
        dinsight_y: [...previous.dinsight_y, ...monitoringData.dinsight_y.slice(prevLen)],
        metadata: [...previous.metadata, ...monitoringData.metadata.slice(prevLen)],
      };
    });
  }, [monitoringData]);

  useEffect(() => {
    if (!streamingStatus) {
      return;
    }

    setIsStreaming(streamingStatus.is_active);
    if (
      typeof streamingStatus.latest_glow_count === 'number' &&
      streamingStatus.latest_glow_count > 0
    ) {
      setLatestGlowCount(streamingStatus.latest_glow_count);
    }
  }, [streamingStatus]);

  // Streaming-completion side-effect: when a session transitions from
  // active to completed, fire a one-shot detect-with-storage so the
  // final classification is persisted. This is the hook that lets
  // backend alert rules see the result and fire real Alert rows. The
  // hot-path detect (line ~892) stays ephemeral — running it through
  // detect-with-storage on every frame would write a classification
  // per frame.
  const lastPersistedDatasetRef = useRef<number | null>(null);
  const prevStreamingActiveRef = useRef<boolean>(false);
  useEffect(() => {
    if (!streamingStatus || !selectedId) return;
    const wasActive = prevStreamingActiveRef.current;
    const justCompleted =
      wasActive &&
      !streamingStatus.is_active &&
      streamingStatus.status === 'completed' &&
      streamingStatus.total_points > 0;
    prevStreamingActiveRef.current = streamingStatus.is_active;

    if (!justCompleted) return;
    if (lastPersistedDatasetRef.current === selectedId) return;
    lastPersistedDatasetRef.current = selectedId;

    api.anomaly
      .detectWithStorage({
        baseline_dataset_id: selectedId,
        comparison_dataset_id: selectedId,
        sensitivity_factor: 3.0,
        detection_method: 'mahalanobis',
        store_classification: true,
        generate_alerts: true,
      })
      .catch(() => {
        // Best-effort. The ephemeral detect already provides the live
        // UI signal; persistence failure shouldn't surface as an
        // error to the operator. The next streaming session can retry.
      });
  }, [streamingStatus, selectedId]);

  useEffect(() => {
    if (!autoRefresh || !selectedId || isSelecting) {
      return;
    }

    const smartInterval = isStreaming ? refreshIntervalMs : 10_000;
    const timer = window.setInterval(() => {
      void refetchStatus();
      void refetchDatasets();
      void refetchBaseline();
      void refetchMonitoring();
    }, smartInterval);

    return () => window.clearInterval(timer);
  }, [
    autoRefresh,
    isSelecting,
    isStreaming,
    refreshIntervalMs,
    refetchBaseline,
    refetchDatasets,
    refetchMonitoring,
    refetchStatus,
    selectedId,
  ]);

  const runQuickHealthCheck = useCallback(async () => {
    if (
      !selectedId ||
      !effectiveMonitoringData ||
      effectiveMonitoringData.dinsight_x.length === 0
    ) {
      setAnomalyResult(null);
      return;
    }

    setIsAnalyzing(true);

    try {
      const response = await api.anomaly.detect({
        baseline_dataset_id: selectedId,
        comparison_dataset_id: selectedId,
        sensitivity_factor: 3.0,
        detection_method: 'mahalanobis',
      });

      if (response?.data?.success && response.data.data) {
        setAnomalyResult(response.data.data as AnomalyDetectionResult);
      } else {
        setAnomalyResult(null);
      }
    } catch {
      setAnomalyResult(null);
    } finally {
      setIsAnalyzing(false);
    }
  }, [effectiveMonitoringData, selectedId]);

  const manualClassification = useMemo(() => {
    if (!manualSelectionEnabled || boundaries.length === 0 || !effectiveMonitoringData) {
      return null;
    }

    const normalIndices: number[] = [];
    const anomalyIndices: number[] = [];

    effectiveMonitoringData.dinsight_x.forEach((x, index) => {
      const y = effectiveMonitoringData.dinsight_y[index];
      let isInside = false;

      for (const boundary of boundaries) {
        if (boundary.type === 'rectangle') {
          isInside = isPointInRectangle(x, y, boundary.coordinates);
        } else if (boundary.type === 'lasso') {
          isInside = isPointInPolygon(x, y, boundary.coordinates);
        } else if (boundary.type === 'circle' && boundary.center && boundary.radius) {
          isInside = isPointInCircle(x, y, boundary.center, boundary.radius);
        } else if (
          boundary.type === 'oval' &&
          boundary.center &&
          boundary.radiusX &&
          boundary.radiusY
        ) {
          isInside = isPointInOval(x, y, boundary.center, boundary.radiusX, boundary.radiusY);
        }

        if (isInside) {
          break;
        }
      }

      if (isInside) {
        normalIndices.push(index);
      } else {
        anomalyIndices.push(index);
      }
    });

    return { normalIndices, anomalyIndices };
  }, [boundaries, manualSelectionEnabled, effectiveMonitoringData]);

  const anomalyPercentage = useMemo(() => {
    if (manualClassification) {
      const total =
        manualClassification.normalIndices.length + manualClassification.anomalyIndices.length;
      return total > 0 ? (manualClassification.anomalyIndices.length / total) * 100 : null;
    }

    return anomalyResult?.anomaly_percentage ?? null;
  }, [anomalyResult?.anomaly_percentage, manualClassification]);

  const machineStatus = useMachineHealthStatus({ anomalyPercentage, wearTrendScore: null });

  const baselineCount = baselineData?.dinsight_x.length ?? 0;
  const monitoringCount = effectiveMonitoringData?.dinsight_x.length ?? 0;

  const latestIndices = useMemo(() => {
    if (!effectiveMonitoringData || effectiveMonitoringData.dinsight_x.length === 0) {
      return new Set<number>();
    }
    const count = effectiveMonitoringData.dinsight_x.length;
    const tailSize = Math.min(latestGlowCount, count);
    return new Set(Array.from({ length: tailSize }, (_, i) => count - tailSize + i));
  }, [latestGlowCount, effectiveMonitoringData]);

  const handleSelection = useCallback(
    (selection: any) => {
      if (!manualSelectionEnabled) {
        return;
      }

      const boundary = createBoundary(selection, selectionMode);
      if (!boundary) {
        return;
      }

      setBoundaries((current) => {
        if (!enableMultipleSelections) {
          return [boundary];
        }
        return [...current, boundary];
      });
    },
    [enableMultipleSelections, manualSelectionEnabled, selectionMode]
  );

  const clearBoundaries = () => setBoundaries([]);
  const removeBoundary = (id: string) =>
    setBoundaries((current) => current.filter((boundary) => boundary.id !== id));

  const plotShapes = useMemo(
    () => boundaries.map(buildBoundaryShape).filter(Boolean),
    [boundaries]
  );

  const plotData = useMemo(() => {
    if (!baselineData || baselineData.dinsight_x.length === 0) {
      return null;
    }

    const withMetadata = (
      trace: Record<string, unknown>,
      hoverText?: string[],
      template = '<b>%{fullData.name}</b><br>X: %{x:.4f}<br>Y: %{y:.4f}<br>%{text}<extra></extra>'
    ) => {
      const withStableSelectionStyles = (value: Record<string, unknown>) => {
        const traceType = value.type;
        const isScatterTrace = traceType === 'scatter' || traceType === 'scattergl';
        if (!isScatterTrace) {
          return value;
        }

        const marker = (value.marker ?? {}) as Record<string, unknown>;
        const opacity = typeof marker.opacity === 'number' ? marker.opacity : 1;

        return {
          ...value,
          selected: { marker: { opacity } },
          unselected: { marker: { opacity } },
        };
      };

      if (!hasActiveMetadata || !hoverText || hoverText.length === 0) {
        return withStableSelectionStyles({
          ...trace,
          hovertemplate: '<b>%{fullData.name}</b><br>X: %{x:.4f}<br>Y: %{y:.4f}<extra></extra>',
        });
      }

      return withStableSelectionStyles({
        ...trace,
        text: hoverText,
        hovertemplate: template,
      });
    };

    const traces: any[] = [
      withMetadata(
        {
          x: baselineData.dinsight_x,
          y: baselineData.dinsight_y,
          type: 'scattergl',
          mode: 'markers',
          name: 'Baseline',
          marker: { color: '#1A73E8', size: pointSize, opacity: 0.35 },
        },
        buildHoverText(baselineData.metadata)
      ),
    ];

    if (showContours && baselineData.dinsight_x.length > 20) {
      traces.push({
        x: baselineData.dinsight_x,
        y: baselineData.dinsight_y,
        type: 'histogram2dcontour',
        name: 'Baseline density',
        showscale: false,
        contours: { coloring: 'none' },
        line: { color: 'rgba(26,115,232,0.35)' },
        hoverinfo: 'skip',
      });
    }

    if (effectiveMonitoringData && effectiveMonitoringData.dinsight_x.length > 0) {
      const hoverForIndices = (indices: number[]) =>
        buildHoverText(
          effectiveMonitoringData.metadata,
          indices.filter((index) => index >= 0 && index < effectiveMonitoringData.metadata.length)
        );

      if (manualClassification) {
        if (manualClassification.normalIndices.length > 0) {
          traces.push(
            withMetadata(
              {
                x: manualClassification.normalIndices.map(
                  (index) => effectiveMonitoringData.dinsight_x[index]
                ),
                y: manualClassification.normalIndices.map(
                  (index) => effectiveMonitoringData.dinsight_y[index]
                ),
                type: 'scattergl',
                mode: 'markers',
                name: `Normal (${manualClassification.normalIndices.length})`,
                marker: {
                  color: manualClassification.normalIndices,
                  colorscale: [
                    [0, '#166534'],
                    [0.75, '#22C55E'],
                    [1, '#FACC15'],
                  ],
                  cmin: 0,
                  cmax: Math.max(effectiveMonitoringData.dinsight_x.length - 1, 1),
                  size: pointSize + 1,
                  opacity: 0.88,
                  showscale: false,
                },
              },
              hoverForIndices(manualClassification.normalIndices)
            )
          );
        }

        const normalLatest = manualClassification.normalIndices.filter((index) =>
          latestIndices.has(index)
        );
        if (normalLatest.length > 0) {
          traces.push(
            withMetadata(
              {
                x: normalLatest.map((index) => effectiveMonitoringData.dinsight_x[index]),
                y: normalLatest.map((index) => effectiveMonitoringData.dinsight_y[index]),
                type: 'scattergl',
                mode: 'markers',
                name: `Normal (latest ${normalLatest.length})`,
                marker: {
                  color: '#22C55E',
                  size: pointSize + 4,
                  opacity: 1,
                  line: { color: '#FACC15', width: 2 },
                },
              },
              hoverForIndices(normalLatest)
            )
          );
        }

        if (manualClassification.anomalyIndices.length > 0) {
          traces.push(
            withMetadata(
              {
                x: manualClassification.anomalyIndices.map(
                  (index) => effectiveMonitoringData.dinsight_x[index]
                ),
                y: manualClassification.anomalyIndices.map(
                  (index) => effectiveMonitoringData.dinsight_y[index]
                ),
                type: 'scattergl',
                mode: 'markers',
                name: `Anomaly (${manualClassification.anomalyIndices.length})`,
                marker: {
                  color: manualClassification.anomalyIndices,
                  colorscale: [
                    [0, '#991B1B'],
                    [0.75, '#EF4444'],
                    [1, '#FACC15'],
                  ],
                  cmin: 0,
                  cmax: Math.max(effectiveMonitoringData.dinsight_x.length - 1, 1),
                  size: pointSize + 2,
                  opacity: 0.92,
                  showscale: false,
                },
              },
              hoverForIndices(manualClassification.anomalyIndices)
            )
          );
        }

        const anomalyLatest = manualClassification.anomalyIndices.filter((index) =>
          latestIndices.has(index)
        );
        if (anomalyLatest.length > 0) {
          traces.push(
            withMetadata(
              {
                x: anomalyLatest.map((index) => effectiveMonitoringData.dinsight_x[index]),
                y: anomalyLatest.map((index) => effectiveMonitoringData.dinsight_y[index]),
                type: 'scattergl',
                mode: 'markers',
                name: `Anomaly (latest ${anomalyLatest.length})`,
                marker: {
                  color: '#EF4444',
                  size: pointSize + 5,
                  opacity: 1,
                  line: { color: '#FACC15', width: 2 },
                },
              },
              hoverForIndices(anomalyLatest)
            )
          );
        }
      } else if (anomalyResult?.anomalous_points?.length) {
        const normal = anomalyResult.anomalous_points.filter((point) => !point.is_anomaly);
        const anomalies = anomalyResult.anomalous_points.filter((point) => point.is_anomaly);

        if (normal.length > 0) {
          traces.push(
            withMetadata(
              {
                x: normal.map((point) => point.x),
                y: normal.map((point) => point.y),
                type: 'scattergl',
                mode: 'markers',
                name: 'Monitoring (normal)',
                marker: { color: '#34A853', size: pointSize, opacity: 0.75 },
              },
              hoverForIndices(normal.map((point) => point.index))
            )
          );
        }

        if (anomalies.length > 0) {
          traces.push(
            withMetadata(
              {
                x: anomalies.map((point) => point.x),
                y: anomalies.map((point) => point.y),
                type: 'scattergl',
                mode: 'markers',
                name: 'Monitoring (anomaly)',
                marker: { color: '#EA4335', size: pointSize + 1, opacity: 0.95 },
              },
              hoverForIndices(anomalies.map((point) => point.index))
            )
          );
        }
      } else {
        const regularIndices = effectiveMonitoringData.dinsight_x
          .map((_, index) => index)
          .filter((index) => !latestIndices.has(index));
        const latestOnly = effectiveMonitoringData.dinsight_x
          .map((_, index) => index)
          .filter((index) => latestIndices.has(index));

        if (regularIndices.length > 0) {
          traces.push(
            withMetadata(
              {
                x: regularIndices.map((index) => effectiveMonitoringData.dinsight_x[index]),
                y: regularIndices.map((index) => effectiveMonitoringData.dinsight_y[index]),
                type: 'scattergl',
                mode: 'markers',
                name: 'Monitoring',
                marker: {
                  color: regularIndices,
                  colorscale: [
                    [0, '#EF4444'],
                    [0.5, '#FB923C'],
                    [1, '#FACC15'],
                  ],
                  cmin: 0,
                  cmax: Math.max(regularIndices.length - 1, 1),
                  size: pointSize,
                  opacity: 0.82,
                  showscale: false,
                },
              },
              hoverForIndices(regularIndices)
            )
          );
        }

        if (latestOnly.length > 0) {
          traces.push(
            withMetadata(
              {
                x: latestOnly.map((index) => effectiveMonitoringData.dinsight_x[index]),
                y: latestOnly.map((index) => effectiveMonitoringData.dinsight_y[index]),
                type: 'scattergl',
                mode: 'markers',
                name: `Latest (${latestOnly.length})`,
                marker: {
                  color: '#F59E0B',
                  size: pointSize + 4,
                  opacity: 1,
                  line: { color: '#111827', width: 1.5 },
                },
              },
              hoverForIndices(latestOnly)
            )
          );
        }
      }

      const latestOverlayIndices = effectiveMonitoringData.dinsight_x
        .map((_, index) => index)
        .filter((index) => latestIndices.has(index));
      if (latestOverlayIndices.length > 0) {
        traces.push({
          x: latestOverlayIndices.map((index) => effectiveMonitoringData.dinsight_x[index]),
          y: latestOverlayIndices.map((index) => effectiveMonitoringData.dinsight_y[index]),
          type: 'scattergl',
          mode: 'markers',
          name: 'Latest stream points',
          showlegend: false,
          hoverinfo: 'skip',
          marker: {
            size: pointSize + 8,
            color: 'rgba(0,0,0,0)',
            line: { color: '#FACC15', width: 2.5 },
            opacity: 1,
          },
        });
      }
    }

    return {
      data: traces,
      layout: {
        height: 700,
        template: 'plotly_white',
        title: '',
        xaxis: { title: "D'insight X Coordinate" },
        yaxis: { title: "D'insight Y Coordinate" },
        legend: { orientation: 'h', y: 1.04, x: 0, xanchor: 'left' },
        margin: { t: 52, r: 24, b: 60, l: 64 },
        uirevision: selectedId ?? 'live-monitor',
        dragmode: manualSelectionEnabled
          ? selectionMode === 'lasso'
            ? 'lasso'
            : 'select'
          : 'zoom',
        shapes: plotShapes,
      } as any,
      config: {
        displayModeBar: true,
        displaylogo: false,
        responsive: true,
        modeBarButtonsToRemove: manualSelectionEnabled
          ? selectionMode === 'lasso'
            ? ['select2d']
            : ['lasso2d']
          : [],
      },
    };
  }, [
    anomalyResult,
    baselineData,
    buildHoverText,
    hasActiveMetadata,
    latestIndices,
    manualClassification,
    manualSelectionEnabled,
    effectiveMonitoringData,
    plotShapes,
    pointSize,
    selectedId,
    selectionMode,
    showContours,
  ]);

  const applyManualDataset = () => {
    const parsed = Number(manualDatasetId.trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setDatasetError('Enter a valid dataset ID.');
      return;
    }

    setDatasetError(null);
    setSelectedId(parsed);
  };

  const refreshNow = useCallback(() => {
    void refetchDatasets();
    void refetchStatus();
    void refetchBaseline();
    void refetchMonitoring();
  }, [refetchBaseline, refetchDatasets, refetchMonitoring, refetchStatus]);

  const startStreaming = () => {
    setAutoRefresh(true);
    setIsStreaming(true);
    refreshNow();
  };

  const toggleStreaming = () => {
    setIsStreaming((prev) => {
      const next = !prev;
      setAutoRefresh(next);
      return next;
    });
  };

  const stopStreaming = () => {
    setIsStreaming(false);
    setAutoRefresh(false);
  };

  const resetStreamingState = async () => {
    if (!selectedId) return;
    try {
      await api.streaming.reset(selectedId);
    } catch {
      // no-op
    } finally {
      setIsStreaming(false);
      setAutoRefresh(false);
      void refetchStatus();
      void refetchBaseline();
      void refetchMonitoring();
    }
  };

  const applyRemotePreferences = () => {
    if (!prefsConflict) {
      return;
    }
    applyPersistedPreferences(prefsConflict.server);
    const parsed = Date.parse(prefsConflict.updatedAt);
    if (Number.isFinite(parsed)) {
      localPrefsUpdatedAtRef.current = parsed;
    }
    hasLocalEditsRef.current = false;
    setPrefsConflict(null);
  };

  const keepLocalPreferences = () => {
    setPrefsConflict(null);
    hasLocalEditsRef.current = true;
  };

  const statusLabel = streamingStatus?.status ?? 'not_started';

  return (
    <div className="space-y-6">
      <Card className={cn('border', stateTone[machineStatus.state])}>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div>
            <p className="text-sm font-medium">Current machine state</p>
            <p className="text-2xl font-bold">{machineStatus.state}</p>
            <p className="text-sm">{machineStatus.recommendation}</p>
          </div>
          <div className="text-sm">
            <p>
              Abnormal behavior:{' '}
              <span className="font-semibold">
                {anomalyPercentage != null ? `${anomalyPercentage.toFixed(1)}%` : 'Not checked'}
              </span>
            </p>
            <p>
              Monitoring points: <span className="font-semibold">{monitoringCount}</span>
            </p>
            <p>
              Baseline points: <span className="font-semibold">{baselineCount}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      {prefsConflict && (
        <Card className="border-warning-border bg-warning-bg ">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <p className="text-warning-text ">
              Newer monitor settings were detected from another device
              {prefsConflict.updatedAt
                ? ` (${new Date(prefsConflict.updatedAt).toLocaleString()})`
                : ''}
              .
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={keepLocalPreferences}>
                Keep local
              </Button>
              <Button size="sm" onClick={applyRemotePreferences}>
                Apply remote
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-4">
        <Card className="xl:col-span-1 border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5" />
              Live Controls
            </CardTitle>
            <CardDescription>
              Start or pause simulated streaming, define normal-area boundaries, and inspect status.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Dataset</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedId != null ? String(selectedId) : ''}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setSelectedId(nextValue ? Number(nextValue) : null);
                }}
              >
                <option value="">Select dataset</option>
                {datasets.map((dataset) => (
                  <option key={dataset.dinsight_id} value={dataset.dinsight_id}>
                    {formatLiveDatasetLabel(dataset)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {isLoadingDatasets
                  ? 'Loading datasets...'
                  : `${datasets.length} dataset(s) available`}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Manual dataset ID</label>
              <div className="flex gap-2">
                <Input
                  value={manualDatasetId}
                  onChange={(event) => setManualDatasetId(event.target.value)}
                  placeholder="e.g. 14"
                />
                <Button variant="outline" onClick={applyManualDataset}>
                  Apply
                </Button>
              </div>
              {datasetError && <p className="text-xs text-danger-text">{datasetError}</p>}
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              <Button onClick={startStreaming} disabled={!selectedId || isStreaming}>
                <Play className="mr-2 h-4 w-4" />
                Start stream
              </Button>
              <Button
                variant="outline"
                onClick={toggleStreaming}
                disabled={!selectedId}
                className="w-full"
              >
                {isStreaming ? (
                  <>
                    <Pause className="mr-2 h-4 w-4" />
                    Pause stream
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Resume stream
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={stopStreaming} disabled={!selectedId}>
                <Square className="mr-2 h-4 w-4" />
                Stop stream
              </Button>
              <Button
                variant="outline"
                onClick={() => void resetStreamingState()}
                disabled={!selectedId}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Reset stream state
              </Button>
            </div>

            <div className="space-y-2 rounded-md border border-input p-3">
              <p className="text-sm font-medium">Streaming speed</p>
              <div className="grid grid-cols-3 gap-2">
                {(['0.5x', '1x', '2x'] as const).map((speed) => (
                  <Button
                    key={speed}
                    size="sm"
                    variant={streamSpeed === speed ? 'default' : 'outline'}
                    onClick={() => setStreamSpeed(speed)}
                  >
                    {speed}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Refresh every {isStreaming ? refreshIntervalMs / 1000 : 10}s
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
              <span className="text-sm">Auto refresh</span>
              <button
                type="button"
                onClick={() => setAutoRefresh((prev) => !prev)}
                className={cn(
                  'h-6 w-11 rounded-full p-1 transition-colors',
                  autoRefresh ? 'bg-accent' : 'bg-surface-muted'
                )}
                aria-pressed={autoRefresh}
                aria-label="Toggle auto refresh"
              >
                <span
                  className={cn(
                    'block h-4 w-4 rounded-full bg-white transition-transform',
                    autoRefresh ? 'translate-x-5' : 'translate-x-0'
                  )}
                />
              </button>
            </div>

            <Button variant="outline" onClick={refreshNow} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh now
            </Button>

            <div className="rounded-lg border border-input p-3 text-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge
                  variant="outline"
                  className={cn(
                    statusLabel === 'completed' && 'border-success-border text-success-text',
                    statusLabel === 'streaming' && 'border-info-border text-info-text',
                    statusLabel === 'not_started' && 'border-strong text-fg'
                  )}
                >
                  {statusLabel === 'completed'
                    ? 'Completed'
                    : statusLabel === 'streaming'
                      ? 'Streaming'
                      : 'Not started'}
                </Badge>
              </div>
              <Progress value={streamingStatus?.progress_percentage ?? 0} className="w-full" />
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Streamed</p>
                  <p className="font-semibold">{streamingStatus?.streamed_points ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total</p>
                  <p className="font-semibold">{streamingStatus?.total_points ?? 0}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Latest glow points: {latestGlowCount}</p>
            </div>

            <Button
              onClick={() => void runQuickHealthCheck()}
              disabled={
                !selectedId || isAnalyzing || monitoringCount === 0 || manualSelectionEnabled
              }
              className="w-full"
            >
              {isAnalyzing ? 'Checking status...' : 'Run anomaly check'}
            </Button>

            <Button
              variant={manualSelectionEnabled ? 'default' : 'outline'}
              className="w-full"
              onClick={() => {
                setManualSelectionEnabled((prev) => !prev);
                setAnomalyResult(null);
              }}
            >
              {manualSelectionEnabled ? 'Manual selection ON' : 'Manual selection OFF'}
            </Button>

            {manualSelectionEnabled && (
              <div className="space-y-3 rounded-lg border border-input p-3">
                <p className="text-sm font-medium">Normal-area boundary shape</p>
                <div className="grid grid-cols-2 gap-2">
                  {(['rectangle', 'lasso', 'circle', 'oval'] as SelectionMode[]).map((mode) => (
                    <Button
                      key={mode}
                      size="sm"
                      variant={selectionMode === mode ? 'default' : 'outline'}
                      onClick={() => setSelectionMode(mode)}
                    >
                      {mode}
                    </Button>
                  ))}
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enableMultipleSelections}
                    onChange={(event) => setEnableMultipleSelections(event.target.checked)}
                  />
                  Enable multiple normal areas
                </label>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearBoundaries}
                    disabled={boundaries.length === 0}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear areas
                  </Button>
                  <span className="self-center text-xs text-muted-foreground">
                    {boundaries.length} area(s)
                  </span>
                </div>
              </div>
            )}

            <Button
              variant="outline"
              className="w-full"
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              {showAdvanced ? 'Hide advanced' : 'Show advanced'}
            </Button>

            {showAdvanced && (
              <div className="space-y-3 rounded-lg border border-input p-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium">Point size: {pointSize}</label>
                  <input
                    type="range"
                    min={4}
                    max={14}
                    step={1}
                    value={pointSize}
                    onChange={(event) => setPointSize(Number(event.target.value))}
                    className="w-full"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showContours}
                    onChange={(event) => setShowContours(event.target.checked)}
                  />
                  Show baseline contours
                </label>
              </div>
            )}

            <MetadataHoverControls
              availableKeys={availableMetadataKeys}
              selectedKeys={selectedMetadataKeys}
              onToggleKey={toggleMetadataKey}
              onSelectAll={selectAllMetadataKeys}
              onClearAll={clearMetadataKeys}
              metadataEnabled={metadataEnabled}
              onToggleEnabled={setMetadataEnabled}
              disabled={!selectedId}
            />

            {manualClassification && (
              <div className="rounded-lg border border-input p-3 text-sm">
                <p className="font-medium">Manual classification</p>
                <p>Normal: {manualClassification.normalIndices.length}</p>
                <p>Anomaly: {manualClassification.anomalyIndices.length}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-3 border-border/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldAlert className="h-5 w-5" />
              Machine Live View
            </CardTitle>
            <CardDescription>
              Baseline vs monitoring trajectory with live-point highlighting and boundary-based
              normal areas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(baselineError || monitoringError) && (
              <div className="mb-4 space-y-1 rounded-lg border border-warning-border bg-warning-bg p-3 text-sm text-warning-text ">
                {baselineError && <p>{baselineError}</p>}
                {monitoringError && <p>{monitoringError}</p>}
              </div>
            )}

            {manualSelectionEnabled && boundaries.length > 0 && (
              <div className="mb-4 space-y-2 rounded-lg border border-input p-3">
                <p className="text-sm font-medium">Normal operating areas</p>
                <div className="space-y-2">
                  {boundaries.map((boundary, index) => (
                    <div key={boundary.id} className="flex items-center justify-between text-sm">
                      <span>
                        Area {index + 1}: {boundary.type}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => removeBoundary(boundary.id)}>
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isLoadingBaseline || (selectedId && isLoadingMonitoring) ? (
              <div className="flex h-[700px] items-center justify-center rounded-md border border-dashed border-input text-muted-foreground">
                Loading monitor view...
              </div>
            ) : plotData ? (
              <Plot
                data={plotData.data}
                layout={plotData.layout as any}
                config={plotData.config as any}
                style={{ width: '100%', height: '700px' }}
                onSelecting={() => {
                  if (manualSelectionEnabled) {
                    setIsSelecting(true);
                  }
                }}
                onSelected={(selection: any) => {
                  setIsSelecting(false);
                  handleSelection(selection);
                }}
                onDeselect={() => {
                  setIsSelecting(false);
                }}
              />
            ) : (
              <div className="flex h-[700px] items-center justify-center rounded-md border border-dashed border-input text-muted-foreground">
                Select a dataset with baseline coordinates to start live monitoring.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/60">
        <CardContent className="flex flex-wrap gap-3 py-4">
          <Button asChild>
            <Link href="/dashboard/insights">
              Open health insights
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/data">Upload more data</Link>
          </Button>
          <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            {autoRefresh
              ? `Auto-refresh ${isStreaming ? refreshIntervalMs / 1000 : 10}s`
              : 'Manual refresh'}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// formatLiveDatasetLabel mirrors the label format used on the Data
// Ingestion + Insights pickers so source attribution (device + file
// + Auto/Manual) is consistent across the dashboard. Trailing path
// component only — the live monitor labels stay compact.
function formatLiveDatasetLabel(dataset: {
  dinsight_id: number;
  name: string;
  source: {
    source: 'auto' | 'manual' | 'unknown';
    deviceSlug?: string;
    originalFileName?: string;
  };
}): string {
  const id = `#${dataset.dinsight_id}`;
  if (dataset.source.source === 'auto') {
    const dev = dataset.source.deviceSlug ?? 'device';
    const file = dataset.source.originalFileName?.split('/').pop() ?? '';
    return file ? `${id} · ${dev} · ${file} · Auto` : `${id} · ${dev} · Auto`;
  }
  if (dataset.source.source === 'manual') {
    return `${id} · Manual upload`;
  }
  return `${id} · ${dataset.name}`;
}
