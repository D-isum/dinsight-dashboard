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
  onEvents?: Record<string, EChartsEventHandler>;
  onReady?: (chart: ECharts) => void;
  onOptionApplied?: (chart: ECharts) => void;
}

function EChartsSurface({
  option,
  className,
  style,
  renderer = 'canvas',
  notMerge = true,
  lazyUpdate = true,
  onEvents,
  onReady,
  onOptionApplied,
}: EChartsCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const optionRef = useRef(option);
  const onReadyRef = useRef(onReady);
  const onOptionAppliedRef = useRef(onOptionApplied);
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

    chartRef.current.setOption(option, { notMerge, lazyUpdate });
    onOptionAppliedRef.current?.(chartRef.current);
  }, [chartReadyRevision, lazyUpdate, notMerge, option]);

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
