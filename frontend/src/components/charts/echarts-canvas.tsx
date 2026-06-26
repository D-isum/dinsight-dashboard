'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ECharts, EChartsOption } from 'echarts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ErrorBoundary } from '@/components/error-boundary';

type EChartsModule = typeof import('echarts');
type EChartsEventHandler = (params: any, chart: ECharts) => void;

let echartsPromise: Promise<EChartsModule> | null = null;

function loadECharts() {
  echartsPromise ??= import('echarts');
  return echartsPromise;
}

interface EChartsCanvasProps {
  option: EChartsOption;
  className?: string;
  style?: CSSProperties;
  renderer?: 'canvas' | 'svg';
  notMerge?: boolean;
  lazyUpdate?: boolean;
  preserveDataZoom?: boolean;
  dataZoomStorageKey?: string;
  onEvents?: Record<string, EChartsEventHandler>;
  onReady?: (chart: ECharts) => void;
  onOptionApplied?: (chart: ECharts) => void;
}

type DataZoomSnapshot = Array<Record<string, unknown>>;

const DATA_ZOOM_ID_KEYS = ['id', 'xAxisIndex', 'yAxisIndex'] as const;

function extractDataZoomSnapshot(chart: ECharts): DataZoomSnapshot | null {
  const option = chart.getOption() as { dataZoom?: Array<Record<string, unknown>> };
  const dataZoom = option?.dataZoom;
  if (!Array.isArray(dataZoom) || dataZoom.length === 0) {
    return null;
  }

  const snapshot = dataZoom
    .map((zoom) => {
      const entry: Record<string, unknown> = {};
      DATA_ZOOM_ID_KEYS.forEach((key) => {
        const value = zoom[key];
        if (value != null) {
          entry[key] = value;
        }
      });
      const hasValueBounds = zoom.startValue != null || zoom.endValue != null;
      if (hasValueBounds) {
        if (zoom.startValue != null) {
          entry.startValue = zoom.startValue;
        }
        if (zoom.endValue != null) {
          entry.endValue = zoom.endValue;
        }
      } else {
        if (zoom.start != null) {
          entry.start = zoom.start;
        }
        if (zoom.end != null) {
          entry.end = zoom.end;
        }
      }
      return entry;
    })
    .filter((entry) => Object.keys(entry).length > 0);

  return snapshot.length > 0 ? snapshot : null;
}

function readDataZoomSnapshot(storageKey?: string): DataZoomSnapshot | null {
  if (!storageKey || typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DataZoomSnapshot) : null;
  } catch {
    return null;
  }
}

function writeDataZoomSnapshot(storageKey: string | undefined, snapshot: DataZoomSnapshot | null) {
  if (!storageKey || typeof window === 'undefined') {
    return;
  }
  try {
    if (snapshot) {
      window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } else {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // Ignore storage failures; in-memory preservation still applies.
  }
}

function applyDataZoomSnapshot(chart: ECharts, snapshot: DataZoomSnapshot | null) {
  if (!snapshot || snapshot.length === 0) {
    return;
  }
  chart.setOption({ dataZoom: snapshot } as EChartsOption, {
    notMerge: false,
    lazyUpdate: false,
  });
}

function EChartsSurface({
  option,
  className,
  style,
  renderer = 'canvas',
  notMerge = true,
  lazyUpdate = true,
  preserveDataZoom = false,
  dataZoomStorageKey,
  onEvents,
  onReady,
  onOptionApplied,
}: EChartsCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const optionRef = useRef(option);
  const onReadyRef = useRef(onReady);
  const onOptionAppliedRef = useRef(onOptionApplied);
  const dataZoomSnapshotRef = useRef<DataZoomSnapshot | null>(null);
  const dataZoomStorageKeyRef = useRef<string | undefined>(dataZoomStorageKey);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chartReadyRevision, setChartReadyRevision] = useState(0);

  optionRef.current = option;
  onReadyRef.current = onReady;
  onOptionAppliedRef.current = onOptionApplied;

  useEffect(() => {
    let cancelled = false;

    loadECharts()
      .then((echarts) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        chartRef.current = echarts.init(containerRef.current, undefined, { renderer });
        chartRef.current.setOption(optionRef.current, { notMerge, lazyUpdate });
        if (preserveDataZoom) {
          dataZoomSnapshotRef.current = readDataZoomSnapshot(dataZoomStorageKey);
          applyDataZoomSnapshot(chartRef.current, dataZoomSnapshotRef.current);
        }
        onReadyRef.current?.(chartRef.current);
        onOptionAppliedRef.current?.(chartRef.current);
        setChartReadyRevision((revision) => revision + 1);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load ECharts.');
        }
      });

    return () => {
      cancelled = true;
      chartRef.current?.dispose();
      chartRef.current = null;
    };
    // Init must run only for the renderer/container lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer]);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }

    if (dataZoomStorageKeyRef.current !== dataZoomStorageKey) {
      dataZoomStorageKeyRef.current = dataZoomStorageKey;
      dataZoomSnapshotRef.current = preserveDataZoom
        ? readDataZoomSnapshot(dataZoomStorageKey)
        : null;
    }

    chartRef.current.setOption(option, { notMerge, lazyUpdate });
    if (preserveDataZoom) {
      applyDataZoomSnapshot(chartRef.current, dataZoomSnapshotRef.current);
    }
    onOptionAppliedRef.current?.(chartRef.current);
  }, [chartReadyRevision, dataZoomStorageKey, lazyUpdate, notMerge, option, preserveDataZoom]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !preserveDataZoom) {
      return;
    }

    const handleDataZoom = () => {
      const snapshot = extractDataZoomSnapshot(chart);
      dataZoomSnapshotRef.current = snapshot;
      writeDataZoomSnapshot(dataZoomStorageKeyRef.current, snapshot);
    };
    const handleRestore = () => {
      dataZoomSnapshotRef.current = null;
      writeDataZoomSnapshot(dataZoomStorageKeyRef.current, null);
    };

    chart.on('datazoom', handleDataZoom);
    chart.on('restore', handleRestore);

    return () => {
      chart.off('datazoom', handleDataZoom);
      chart.off('restore', handleRestore);
    };
  }, [chartReadyRevision, preserveDataZoom]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) {
      return;
    }

    const entries = Object.entries(onEvents);
    const boundHandlers = entries.map(([eventName, handler]) => {
      const boundHandler = (params: any) => handler(params, chart);
      chart.on(eventName, boundHandler);
      return [eventName, boundHandler] as const;
    });

    return () => {
      boundHandlers.forEach(([eventName, boundHandler]) => {
        chart.off(eventName, boundHandler);
      });
    };
  }, [chartReadyRevision, onEvents]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      chartRef.current?.resize();
    });
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  if (loadError) {
    return (
      <Alert variant="warning" className="m-4">
        <AlertTitle>ECharts failed to load</AlertTitle>
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    );
  }

  return <div ref={containerRef} className={className} style={style} />;
}

export function EChartsCanvas(props: EChartsCanvasProps) {
  return (
    <ErrorBoundary
      fallback={
        <Alert variant="warning" className="m-4">
          <AlertTitle>Chart failed to render</AlertTitle>
          <AlertDescription>
            Something went wrong rendering this ECharts chart. The rest of the page is unaffected;
            refresh to try again.
          </AlertDescription>
        </Alert>
      }
    >
      <EChartsSurface {...props} />
    </ErrorBoundary>
  );
}
