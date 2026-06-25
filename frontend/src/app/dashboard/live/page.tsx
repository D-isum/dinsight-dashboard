'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  Clock,
  Database,
  PanelLeftClose,
  PanelLeftOpen,
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
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ChartFrame, ChartStat, ChartSwatch } from '@/components/charts/chart-frame';
import { WorkflowState } from '@/components/ui/workflow-state';
import { MetadataHoverControls } from '@/components/metadata-hover-controls';
import { useMetadataHover } from '@/hooks/useMetadataHover';
import { useBaselineMonitoringData } from '@/hooks/useBaselineMonitoringData';
import { useMachineHealthStatus } from '@/hooks/useMachineHealthStatus';
import { api } from '@/lib/api-client';
import type { CoordinateSeries } from '@/lib/dataset-normalizers';
import {
  axisRangeRevisionPart,
  buildPaddedAxisRange,
  plotRevisionFromParts,
} from '@/lib/plot-autoscale';
import { alphaColor, usePlotTheme } from '@/lib/plot-theme';
import { readScoped, writeScoped } from '@/lib/scoped-storage';
import { useAuth } from '@/context/auth-context';
import { useDashboardWorkspace } from '@/context/dashboard-workspace-context';
import { cn } from '@/utils/cn';
import { EChartsCanvas } from '@/components/charts/echarts-canvas';

import type { EChartsOption } from 'echarts';

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
  trail_points: number;
  batch_size: number;
  delay_seconds: number;
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
const LIVE_RECENT_WINDOW_POINTS = 500;

type PersistedLiveMonitorPreferences = {
  selectedId?: number;
  manualDatasetId?: string;
  autoRefresh?: boolean;
  isControlsCollapsed?: boolean;
  streamSpeed?: '0.5x' | '1x' | '2x';
  showAdvanced?: boolean;
  pointSize?: number;
  showContours?: boolean;
  followLatest?: boolean;
  showTrajectoryLine?: boolean;
  monitorView?: 'all' | 'recent';
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

const createBoundaryFromEChartsBrush = (
  params: any,
  selectionMode: SelectionMode
): Boundary | null => {
  const areas = Array.isArray(params?.areas)
    ? params.areas
    : Array.isArray(params?.batch?.[0]?.areas)
      ? params.batch[0].areas
      : [];
  const area = areas.at(-1);
  if (!area) {
    return null;
  }

  const coordRange = area.coordRange;
  const brushType = String(area.brushType ?? '');
  if (
    (selectionMode === 'lasso' || brushType === 'polygon') &&
    Array.isArray(coordRange) &&
    coordRange.length >= 3 &&
    Array.isArray(coordRange[0])
  ) {
    const coordinates = coordRange
      .map((point: unknown) =>
        Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [NaN, NaN]
      )
      .filter(([x, y]: number[]) => Number.isFinite(x) && Number.isFinite(y));

    if (coordinates.length >= 3) {
      return {
        id: `boundary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'lasso',
        coordinates,
      };
    }
  }

  if (!Array.isArray(coordRange) || coordRange.length < 2) {
    return null;
  }

  const xRange = coordRange[0];
  const yRange = coordRange[1];
  if (!Array.isArray(xRange) || !Array.isArray(yRange)) {
    return null;
  }

  const x1 = Number(xRange[0]);
  const x2 = Number(xRange[1]);
  const y1 = Number(yRange[0]);
  const y2 = Number(yRange[1]);
  if (![x1, x2, y1, y2].every((value) => Number.isFinite(value))) {
    return null;
  }

  return createBoundary({ range: { x: [x1, x2], y: [y1, y2] } }, selectionMode);
};

const buildBoundaryShape = (boundary: Boundary, boundaryColor: string) => {
  if (boundary.type === 'rectangle' && boundary.coordinates.length >= 2) {
    const [first, second] = boundary.coordinates;
    return {
      type: 'rect' as const,
      x0: Math.min(first[0], second[0]),
      x1: Math.max(first[0], second[0]),
      y0: Math.min(first[1], second[1]),
      y1: Math.max(first[1], second[1]),
      line: { color: boundaryColor, width: 2 },
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
      line: { color: boundaryColor, width: 2 },
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
      line: { color: boundaryColor, width: 2 },
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
      line: { color: boundaryColor, width: 2 },
      fillcolor: 'rgba(0,0,0,0)',
      layer: 'above' as const,
    };
  }

  return null;
};

const boundaryToLineData = (boundary: Boundary): number[][] => {
  if (boundary.type === 'rectangle' && boundary.coordinates.length >= 2) {
    const [first, second] = boundary.coordinates;
    const xMin = Math.min(first[0], second[0]);
    const xMax = Math.max(first[0], second[0]);
    const yMin = Math.min(first[1], second[1]);
    const yMax = Math.max(first[1], second[1]);
    return [
      [xMin, yMin],
      [xMax, yMin],
      [xMax, yMax],
      [xMin, yMax],
      [xMin, yMin],
    ];
  }

  if (boundary.type === 'lasso' && boundary.coordinates.length >= 3) {
    return [...boundary.coordinates, boundary.coordinates[0]];
  }

  if (boundary.type === 'circle' && boundary.center && boundary.radius) {
    return Array.from({ length: 73 }, (_, index) => {
      const angle = (index / 72) * Math.PI * 2;
      return [
        boundary.center!.x + Math.cos(angle) * boundary.radius!,
        boundary.center!.y + Math.sin(angle) * boundary.radius!,
      ];
    });
  }

  if (boundary.type === 'oval' && boundary.center && boundary.radiusX && boundary.radiusY) {
    return Array.from({ length: 73 }, (_, index) => {
      const angle = (index / 72) * Math.PI * 2;
      return [
        boundary.center!.x + Math.cos(angle) * boundary.radiusX!,
        boundary.center!.y + Math.sin(angle) * boundary.radiusY!,
      ];
    });
  }

  return [];
};

const buildDensityHeatmapData = (xValues: number[], yValues: number[], bins = 44) => {
  if (xValues.length < 20 || yValues.length < 20) {
    return { data: [] as number[][], maxDensity: 0 };
  }

  const xRange = buildPaddedAxisRange(xValues, { paddingRatio: 0 });
  const yRange = buildPaddedAxisRange(yValues, { paddingRatio: 0 });
  if (!xRange || !yRange || xRange[0] === xRange[1] || yRange[0] === yRange[1]) {
    return { data: [] as number[][], maxDensity: 0 };
  }

  const xStep = (xRange[1] - xRange[0]) / bins;
  const yStep = (yRange[1] - yRange[0]) / bins;
  const counts = new Map<string, number>();
  let maxDensity = 0;

  xValues.forEach((x, index) => {
    const y = yValues[index];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    const xBin = Math.min(bins - 1, Math.max(0, Math.floor((x - xRange[0]) / xStep)));
    const yBin = Math.min(bins - 1, Math.max(0, Math.floor((y - yRange[0]) / yStep)));
    const key = `${xBin}:${yBin}`;
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    maxDensity = Math.max(maxDensity, next);
  });

  const data = Array.from(counts.entries()).map(([key, count]) => {
    const [xBin, yBin] = key.split(':').map(Number);
    return [xRange[0] + (xBin + 0.5) * xStep, yRange[0] + (yBin + 0.5) * yStep, count];
  });

  return { data, maxDensity };
};

export default function LiveMonitorPage() {
  const { user } = useAuth();
  const {
    selectedDatasetId: workspaceDatasetId,
    refetchDatasets,
    setMachineHealthSnapshot,
    logActivity,
  } = useDashboardWorkspace();
  const plotTheme = usePlotTheme();
  const selectedId = workspaceDatasetId;
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isControlsCollapsed, setIsControlsCollapsed] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamSpeed, setStreamSpeed] = useState<'0.5x' | '1x' | '2x'>('1x');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pointSize, setPointSize] = useState(8);
  const [showContours, setShowContours] = useState(false);
  const [followLatest, setFollowLatest] = useState(false);
  const [showTrajectoryLine, setShowTrajectoryLine] = useState(false);
  const [monitorView, setMonitorView] = useState<'all' | 'recent'>('all');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [anomalyResult, setAnomalyResult] = useState<AnomalyDetectionResult | null>(null);
  const [latestGlowCount, setLatestGlowCount] = useState(5);
  const [trailPoints, setTrailPoints] = useState(5);

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
  const isApplyingPersistedPrefsRef = useRef(false);
  const boundariesByDatasetRef = useRef<Record<string, Boundary[]>>({});
  const serverSaveTimerRef = useRef<number | null>(null);
  const lastLoggedStreamingStateRef = useRef('');
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
    monitoringMode: 'coordinates',
    maxPoints: 100_000,
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

      if (typeof parsed.autoRefresh === 'boolean') setAutoRefresh(parsed.autoRefresh);
      if (typeof parsed.isControlsCollapsed === 'boolean') {
        setIsControlsCollapsed(parsed.isControlsCollapsed);
      }
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
      if (typeof parsed.followLatest === 'boolean') setFollowLatest(parsed.followLatest);
      if (typeof parsed.showTrajectoryLine === 'boolean') {
        setShowTrajectoryLine(parsed.showTrajectoryLine);
      }
      if (parsed.monitorView === 'all' || parsed.monitorView === 'recent') {
        setMonitorView(parsed.monitorView);
      }
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
      autoRefresh,
      isControlsCollapsed,
      streamSpeed,
      showAdvanced,
      pointSize,
      showContours,
      followLatest,
      showTrajectoryLine,
      monitorView,
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
    followLatest,
    isControlsCollapsed,
    isPrefsHydrated,
    manualSelectionEnabled,
    metadataEnabled,
    monitorView,
    pointSize,
    selectedId,
    selectedMetadataKeys,
    selectionMode,
    showTrajectoryLine,
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
    setAnomalyResult(null);
    setLiveMonitoringData(null);
    if (!selectedId) {
      setBoundaries([]);
      return;
    }

    const restored = boundariesByDatasetRef.current[String(selectedId)] ?? [];
    setBoundaries(restored);
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
    if (typeof streamingStatus.trail_points === 'number' && streamingStatus.trail_points >= 0) {
      setTrailPoints(streamingStatus.trail_points);
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

  useEffect(() => {
    setMachineHealthSnapshot({
      state: machineStatus.state,
      recommendation: machineStatus.recommendation,
      reasons: machineStatus.reasons,
      updatedAt: new Date().toISOString(),
    });
  }, [
    machineStatus.reasons,
    machineStatus.recommendation,
    machineStatus.state,
    setMachineHealthSnapshot,
  ]);

  useEffect(() => {
    if (!streamingStatus || !selectedId) {
      return;
    }

    const signature = `${selectedId}:${streamingStatus.status}:${streamingStatus.is_active}:${streamingStatus.streamed_points}:${streamingStatus.total_points}`;
    const statusOnlySignature = `${selectedId}:${streamingStatus.status}:${streamingStatus.is_active}`;
    if (lastLoggedStreamingStateRef.current === statusOnlySignature) {
      return;
    }
    lastLoggedStreamingStateRef.current = statusOnlySignature;

    logActivity({
      type: 'streaming',
      title:
        streamingStatus.status === 'completed'
          ? `Streaming completed for dataset #${selectedId}`
          : streamingStatus.is_active
            ? `Streaming active for dataset #${selectedId}`
            : `Streaming paused for dataset #${selectedId}`,
      description: `${streamingStatus.streamed_points.toLocaleString()} of ${streamingStatus.total_points.toLocaleString()} points streamed.`,
      datasetId: selectedId,
      href: '/dashboard/live',
      status:
        streamingStatus.status === 'completed'
          ? 'success'
          : streamingStatus.is_active
            ? 'info'
            : 'warning',
      id: `streaming-${signature}`,
    });
  }, [logActivity, selectedId, streamingStatus]);

  const { latestIndices, trailIndices } = useMemo(() => {
    if (!effectiveMonitoringData || effectiveMonitoringData.dinsight_x.length === 0) {
      return { latestIndices: new Set<number>(), trailIndices: new Set<number>() };
    }
    const count = effectiveMonitoringData.dinsight_x.length;
    const latestSize = Math.min(latestGlowCount, count);
    const latestStart = count - latestSize;
    const trailSize = Math.min(trailPoints, latestStart);
    const trailStart = latestStart - trailSize;
    return {
      latestIndices: new Set(Array.from({ length: latestSize }, (_, i) => latestStart + i)),
      trailIndices: new Set(Array.from({ length: trailSize }, (_, i) => trailStart + i)),
    };
  }, [latestGlowCount, trailPoints, effectiveMonitoringData]);

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

  const handleEChartsBrushEnd = useCallback(
    (params: any) => {
      setIsSelecting(false);
      if (!manualSelectionEnabled) {
        return;
      }

      const boundary = createBoundaryFromEChartsBrush(params, selectionMode);
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

  const liveEChartOption = useMemo(() => {
    if (!baselineData || baselineData.dinsight_x.length === 0) {
      return null;
    }

    const baselineHover = buildHoverText(baselineData.metadata) ?? [];
    const monitoringHover = effectiveMonitoringData
      ? (buildHoverText(effectiveMonitoringData.metadata) ?? [])
      : [];
    const toSeriesPoint = (
      x: number,
      y: number,
      index: number,
      hoverText: string | undefined,
      source: string,
      itemStyle?: Record<string, unknown>
    ) => ({
      value: [x, y, index, hoverText ?? '', source],
      ...(itemStyle ? { itemStyle } : {}),
    });
    const tooltipFormatter = (params: any) => {
      const value = params?.data?.value ?? params?.data;
      if (!Array.isArray(value)) {
        return `<b>${params?.seriesName ?? 'Point'}</b>`;
      }

      const metadata = value[3] ? `<br/>${value[3]}` : '';
      return `<b>${params.seriesName}</b><br/>X: ${Number(value[0]).toFixed(4)}<br/>Y: ${Number(value[1]).toFixed(4)}${metadata}`;
    };
    const formatCoordinateAxisLabel = (value: number) =>
      Number(value).toLocaleString(undefined, {
        maximumFractionDigits: Math.abs(value) >= 10 ? 1 : 2,
      });
    const scatterPerformanceOptions = hasActiveMetadata
      ? {}
      : { large: true, largeThreshold: 2000, progressive: 1000 };
    const series: any[] = [];
    let visualMap: EChartsOption['visualMap'] | undefined;

    if (showContours && baselineData.dinsight_x.length > 20) {
      const density = buildDensityHeatmapData(baselineData.dinsight_x, baselineData.dinsight_y);
      if (density.data.length > 0) {
        const densitySeriesIndex = series.length;
        series.push({
          type: 'scatter',
          name: 'Baseline density',
          data: density.data,
          symbol: 'rect',
          symbolSize: 11,
          silent: true,
          progressive: 1000,
          z: 1,
          emphasis: { disabled: true },
        });
        visualMap = {
          show: false,
          dimension: 2,
          min: 0,
          max: density.maxDensity,
          seriesIndex: [densitySeriesIndex],
          inRange: {
            color: [
              'rgba(37, 99, 235, 0)',
              alphaColor(plotTheme.baseline, 0.08),
              alphaColor(plotTheme.baseline, 0.18),
            ],
          },
        } as any;
      }
    }

    series.push({
      type: 'scatter',
      name: 'Baseline',
      data: baselineData.dinsight_x.map((x, index) =>
        toSeriesPoint(x, baselineData.dinsight_y[index], index, baselineHover[index], 'Baseline')
      ),
      symbolSize: pointSize,
      ...scatterPerformanceOptions,
      itemStyle: { color: alphaColor(plotTheme.baseline, 0.38) },
      z: 4,
    });

    if (effectiveMonitoringData && effectiveMonitoringData.dinsight_x.length > 0) {
      const visibleStartIndex =
        monitorView === 'recent'
          ? Math.max(0, effectiveMonitoringData.dinsight_x.length - LIVE_RECENT_WINDOW_POINTS)
          : 0;
      const isVisibleMonitoringIndex = (index: number) => index >= visibleStartIndex;
      const pointForIndex = (index: number, source: string, itemStyle?: Record<string, unknown>) =>
        toSeriesPoint(
          effectiveMonitoringData.dinsight_x[index],
          effectiveMonitoringData.dinsight_y[index],
          index,
          monitoringHover[index],
          source,
          itemStyle
        );

      if (manualClassification) {
        const visibleNormalIndices =
          manualClassification.normalIndices.filter(isVisibleMonitoringIndex);
        const visibleAnomalyIndices =
          manualClassification.anomalyIndices.filter(isVisibleMonitoringIndex);
        const normalLatest = visibleNormalIndices.filter((index) => latestIndices.has(index));
        const anomalyLatest = visibleAnomalyIndices.filter((index) => latestIndices.has(index));

        if (visibleNormalIndices.length > 0) {
          series.push({
            type: 'scatter',
            name: `Normal (${visibleNormalIndices.length.toLocaleString()})`,
            data: visibleNormalIndices.map((index) => pointForIndex(index, 'Normal')),
            symbolSize: pointSize + 1,
            ...scatterPerformanceOptions,
            itemStyle: { color: alphaColor(plotTheme.normal, 0.86) },
          });
        }
        if (visibleAnomalyIndices.length > 0) {
          series.push({
            type: 'scatter',
            name: `Anomaly (${visibleAnomalyIndices.length.toLocaleString()})`,
            data: visibleAnomalyIndices.map((index) => pointForIndex(index, 'Anomaly')),
            symbolSize: pointSize + 2,
            ...scatterPerformanceOptions,
            itemStyle: { color: alphaColor(plotTheme.anomaly, 0.92) },
          });
        }
        if (normalLatest.length > 0) {
          series.push({
            type: 'scatter',
            name: `Normal latest (${normalLatest.length})`,
            data: normalLatest.map((index) => pointForIndex(index, 'Normal latest')),
            symbolSize: pointSize + 6,
            itemStyle: {
              color: plotTheme.normal,
              borderColor: plotTheme.latest,
              borderWidth: 2,
            },
            z: 20,
          });
        }
        if (anomalyLatest.length > 0) {
          series.push({
            type: 'scatter',
            name: `Anomaly latest (${anomalyLatest.length})`,
            data: anomalyLatest.map((index) => pointForIndex(index, 'Anomaly latest')),
            symbolSize: pointSize + 7,
            itemStyle: {
              color: plotTheme.anomaly,
              borderColor: plotTheme.latest,
              borderWidth: 2,
            },
            z: 20,
          });
        }
      } else if (anomalyResult?.anomalous_points?.length) {
        const normal = anomalyResult.anomalous_points.filter(
          (point) => !point.is_anomaly && isVisibleMonitoringIndex(point.index)
        );
        const anomalies = anomalyResult.anomalous_points.filter(
          (point) => point.is_anomaly && isVisibleMonitoringIndex(point.index)
        );

        if (normal.length > 0) {
          series.push({
            type: 'scatter',
            name: 'Monitoring (normal)',
            data: normal.map((point) => pointForIndex(point.index, 'Monitoring normal')),
            symbolSize: pointSize,
            ...scatterPerformanceOptions,
            itemStyle: { color: alphaColor(plotTheme.normal, 0.78) },
          });
        }
        if (anomalies.length > 0) {
          series.push({
            type: 'scatter',
            name: 'Monitoring (anomaly)',
            data: anomalies.map((point) => pointForIndex(point.index, 'Monitoring anomaly')),
            symbolSize: pointSize + 2,
            ...scatterPerformanceOptions,
            itemStyle: { color: alphaColor(plotTheme.anomaly, 0.95) },
          });
        }
      } else {
        const regularIndices = effectiveMonitoringData.dinsight_x
          .map((_, index) => index)
          .filter(
            (index) =>
              isVisibleMonitoringIndex(index) &&
              !latestIndices.has(index) &&
              !trailIndices.has(index)
          );
        const trailOnly = effectiveMonitoringData.dinsight_x
          .map((_, index) => index)
          .filter((index) => trailIndices.has(index));
        const latestOnly = effectiveMonitoringData.dinsight_x
          .map((_, index) => index)
          .filter((index) => latestIndices.has(index));
        const trajectoryLine = [...trailOnly, ...latestOnly];

        if (regularIndices.length > 0) {
          series.push({
            type: 'scatter',
            name: 'Monitoring',
            data: regularIndices.map((index) => pointForIndex(index, 'Monitoring')),
            symbolSize: pointSize,
            ...scatterPerformanceOptions,
            itemStyle: {
              color: alphaColor(plotTheme.monitoring, monitorView === 'recent' ? 0.82 : 0.7),
            },
          });
        }

        if (showTrajectoryLine && trajectoryLine.length > 1) {
          series.push({
            type: 'line',
            name: 'Trajectory',
            data: trajectoryLine.map((index) => [
              effectiveMonitoringData.dinsight_x[index],
              effectiveMonitoringData.dinsight_y[index],
            ]),
            showSymbol: false,
            silent: true,
            lineStyle: { color: alphaColor(plotTheme.trailMid, 0.22), width: 2 },
            tooltip: { show: false },
          });
        }

        if (trailOnly.length > 0) {
          series.push({
            type: 'scatter',
            name: `Trail (${trailOnly.length})`,
            data: trailOnly.map((index, position) => {
              const opacity =
                trailOnly.length === 1 ? 0.7 : 0.32 + (position / (trailOnly.length - 1)) * 0.48;
              return pointForIndex(index, 'Trail', {
                color: alphaColor(plotTheme.trailMid, opacity),
                borderColor: alphaColor(plotTheme.trailLatest, 0.45),
                borderWidth: 0.5,
              });
            }),
            symbolSize: pointSize + 2,
            z: 12,
          });
        }

        if (latestOnly.length > 0) {
          series.push({
            type: 'scatter',
            name: `Latest (${latestOnly.length})`,
            data: latestOnly.map((index) => pointForIndex(index, 'Latest')),
            symbolSize: pointSize + 7,
            itemStyle: {
              color: plotTheme.latest,
              borderColor: plotTheme.latestLine,
              borderWidth: 2,
            },
            z: 20,
          });
        }
      }
    }

    boundaries.forEach((boundary, index) => {
      const lineData = boundaryToLineData(boundary);
      if (lineData.length === 0) {
        return;
      }
      series.push({
        type: 'line',
        name: `Normal area ${index + 1}`,
        data: lineData,
        showSymbol: false,
        silent: true,
        lineStyle: { color: plotTheme.accent, width: 2 },
        tooltip: { show: false },
        z: 30,
      });
    });

    const monitoringRangeStart = (() => {
      if (!effectiveMonitoringData) {
        return 0;
      }
      const count = effectiveMonitoringData.dinsight_x.length;
      if (followLatest) {
        return Math.max(0, count - Math.max(50, latestGlowCount + trailPoints + 25));
      }
      if (monitorView === 'recent') {
        return Math.max(0, count - LIVE_RECENT_WINDOW_POINTS);
      }
      return 0;
    })();
    const monitoringRangeX = effectiveMonitoringData?.dinsight_x.slice(monitoringRangeStart) ?? [];
    const monitoringRangeY = effectiveMonitoringData?.dinsight_y.slice(monitoringRangeStart) ?? [];
    const xAxisRange = buildPaddedAxisRange([
      ...baselineData.dinsight_x,
      ...monitoringRangeX,
      ...(anomalyResult?.anomalous_points?.map((point) => point.x) ?? []),
    ]);
    const yAxisRange = buildPaddedAxisRange([
      ...baselineData.dinsight_y,
      ...monitoringRangeY,
      ...(anomalyResult?.anomalous_points?.map((point) => point.y) ?? []),
    ]);

    const option: EChartsOption = {
      animation: false,
      backgroundColor: 'transparent',
      color: [
        plotTheme.baseline,
        plotTheme.monitoring,
        plotTheme.normal,
        plotTheme.anomaly,
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
        yAxisIndex: 0,
        brushMode: enableMultipleSelections ? 'multiple' : 'single',
        throttleType: 'debounce',
        throttleDelay: 250,
      },
      visualMap,
      grid: { top: 64, right: 84, bottom: 96, left: 78, containLabel: true },
      dataZoom: [
        { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
        { type: 'slider', xAxisIndex: 0, filterMode: 'none', height: 24, bottom: 30 },
        { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
        { type: 'slider', yAxisIndex: 0, filterMode: 'none', width: 18, right: 18 },
      ],
      xAxis: {
        type: 'value',
        name: "D'insight X Coordinate",
        nameLocation: 'middle',
        nameGap: 44,
        min: xAxisRange?.[0],
        max: xAxisRange?.[1],
        scale: true,
        axisLabel: { formatter: formatCoordinateAxisLabel },
        splitLine: { lineStyle: { color: alphaColor(plotTheme.chartGrid, 0.75) } },
      },
      yAxis: {
        type: 'value',
        name: "D'insight Y Coordinate",
        nameLocation: 'middle',
        nameGap: 52,
        min: yAxisRange?.[0],
        max: yAxisRange?.[1],
        scale: true,
        axisLabel: { formatter: formatCoordinateAxisLabel },
        splitLine: { lineStyle: { color: alphaColor(plotTheme.chartGrid, 0.75) } },
      },
      series,
    };

    return { option };
  }, [
    anomalyResult,
    baselineData,
    boundaries,
    buildHoverText,
    effectiveMonitoringData,
    enableMultipleSelections,
    followLatest,
    hasActiveMetadata,
    latestGlowCount,
    latestIndices,
    manualClassification,
    monitorView,
    plotTheme,
    pointSize,
    showContours,
    showTrajectoryLine,
    trailIndices,
    trailPoints,
  ]);

  const liveEChartEvents = useMemo(
    () => ({
      brush: () => {
        if (manualSelectionEnabled) {
          setIsSelecting(true);
        }
      },
      brushEnd: handleEChartsBrushEnd,
    }),
    [handleEChartsBrushEnd, manualSelectionEnabled]
  );

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
    <div className="space-y-5">
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
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-5 w-5" />
                    Live Controls
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Streaming controls, normal-area boundaries, and hover metadata.
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsControlsCollapsed(true)}
                  className="shrink-0 gap-2"
                  aria-label="Hide live controls"
                >
                  <PanelLeftClose className="h-4 w-4" />
                  Hide
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 py-4 xl:max-h-[calc(100vh-13rem)] xl:overflow-y-auto">
              <div className={cn('rounded-lg border p-3 text-sm', stateTone[machineStatus.state])}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase">Machine state</p>
                    <p className="mt-1 text-2xl font-bold leading-none">{machineStatus.state}</p>
                    <p className="mt-2 text-xs">{machineStatus.recommendation}</p>
                  </div>
                  <Badge variant={statusLabel === 'streaming' ? 'success' : 'outline'}>
                    {statusLabel === 'not_started' ? 'Not started' : statusLabel}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <p className="opacity-75">Abnormal</p>
                    <p className="font-semibold">
                      {anomalyPercentage != null ? `${anomalyPercentage.toFixed(1)}%` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="opacity-75">Monitor</p>
                    <p className="font-semibold">{monitoringCount.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="opacity-75">Baseline</p>
                    <p className="font-semibold">{baselineCount.toLocaleString()}</p>
                  </div>
                </div>
                <div className="mt-3 rounded-md border border-current/20 bg-white/25 p-2 dark:bg-black/10">
                  <p className="text-xs font-semibold uppercase">Why</p>
                  <ul className="mt-1 space-y-1 text-xs">
                    {machineStatus.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
                <p className="text-xs font-semibold uppercase text-muted-foreground">
                  Active dataset
                </p>
                <p className="mt-1 text-lg font-semibold text-fg">
                  {selectedId ? `#${selectedId}` : 'None selected'}
                </p>
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

              <div className="space-y-3 rounded-md border border-input p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Plot focus</p>
                  <Badge variant={monitorView === 'recent' ? 'info' : 'outline'}>
                    {monitorView === 'recent'
                      ? `Recent ${LIVE_RECENT_WINDOW_POINTS}`
                      : 'All points'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant={monitorView === 'all' ? 'default' : 'outline'}
                    onClick={() => setMonitorView('all')}
                  >
                    All points
                  </Button>
                  <Button
                    size="sm"
                    variant={monitorView === 'recent' ? 'default' : 'outline'}
                    onClick={() => setMonitorView('recent')}
                  >
                    Recent
                  </Button>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={followLatest}
                    onChange={(event) => setFollowLatest(event.target.checked)}
                  />
                  Follow latest range
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showTrajectoryLine}
                    onChange={(event) => setShowTrajectoryLine(event.target.checked)}
                  />
                  Show faint trajectory line
                </label>
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
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Batch size</p>
                    <p className="font-semibold">{streamingStatus?.batch_size ?? '-'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Delay</p>
                    <p className="font-semibold">
                      {streamingStatus ? `${streamingStatus.delay_seconds}s` : '-'}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Glow points</p>
                    <p className="font-semibold">{latestGlowCount}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Trail points</p>
                    <p className="font-semibold">{trailPoints}</p>
                  </div>
                </div>
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
        )}

        <div className="min-w-0 space-y-5">
          {isControlsCollapsed && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">Live controls hidden</p>
                <p className="text-xs text-fg-muted">
                  The coordinate map is using the full available width.
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

          <Card className="min-w-0 border-border/60">
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeBoundary(boundary.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <ChartFrame
                title="Coordinate map"
                description={
                  followLatest
                    ? 'Apache ECharts. Range follows the latest monitoring segment; the page and plot stay mounted.'
                    : 'Apache ECharts. Baseline, monitoring, recent trail, and latest stream points in one view.'
                }
                stats={
                  <>
                    <ChartStat label="Dataset" value={selectedId ? `#${selectedId}` : '—'} />
                    <ChartStat label="View" value={monitorView === 'recent' ? 'Recent' : 'All'} />
                    <ChartStat
                      label="Streamed"
                      value={`${monitoringCount.toLocaleString()} / ${
                        streamingStatus?.total_points?.toLocaleString() ?? '—'
                      }`}
                      tone="info"
                    />
                    <ChartStat
                      label="Abnormal"
                      value={anomalyPercentage != null ? `${anomalyPercentage.toFixed(1)}%` : '—'}
                      tone={
                        anomalyPercentage == null
                          ? 'neutral'
                          : anomalyPercentage >= 25
                            ? 'danger'
                            : anomalyPercentage >= 10
                              ? 'warning'
                              : 'success'
                      }
                    />
                  </>
                }
                actions={
                  <>
                    <ChartSwatch color={plotTheme.baseline} label="Baseline" />
                    <ChartSwatch color={plotTheme.monitoring} label="Monitoring" />
                    <ChartSwatch color={plotTheme.latest} label="Latest" />
                  </>
                }
                bodyClassName="p-2"
              >
                {isLoadingBaseline || (selectedId && isLoadingMonitoring) ? (
                  <WorkflowState
                    icon={<RefreshCw className="h-5 w-5 animate-spin" aria-hidden="true" />}
                    title="Loading monitor view"
                    description="Fetching baseline coordinates, monitoring coordinates, and metadata for the selected dataset."
                    className="h-[clamp(560px,74vh,800px)]"
                  />
                ) : liveEChartOption ? (
                  <>
                    <EChartsCanvas
                      option={liveEChartOption.option}
                      onEvents={liveEChartEvents}
                      style={{ width: '100%', height: 'clamp(560px, 74vh, 800px)' }}
                    />
                    <p className="border-t border-border px-2 py-1 text-xs text-muted-foreground">
                      Interactions: use the ECharts toolbox for zoom, brush, restore, and image
                      export; use bottom/right sliders or mouse wheel to inspect dense ranges.
                      {showContours
                        ? ' Baseline density overlay is rendered natively in ECharts.'
                        : ''}
                    </p>
                  </>
                ) : (
                  <WorkflowState
                    icon={<Database className="h-5 w-5" aria-hidden="true" />}
                    title="No coordinate map available"
                    description="Select a processed dataset with baseline coordinates, or upload a baseline from Data Ingestion before starting live monitoring."
                    action={
                      <Button asChild variant="outline" size="sm">
                        <Link href="/dashboard/data">Open Data Ingestion</Link>
                      </Button>
                    }
                    className="h-[clamp(560px,74vh,800px)]"
                  />
                )}
              </ChartFrame>
            </CardContent>
          </Card>
        </div>
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
