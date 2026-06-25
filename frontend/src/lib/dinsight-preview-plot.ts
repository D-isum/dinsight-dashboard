import {
  axisRangeRevisionPart,
  buildPaddedAxisRange,
  plotRevisionFromParts,
} from '@/lib/plot-autoscale';
import { alphaColor, type PlotTheme } from '@/lib/plot-theme';
import type { EChartsOption } from 'echarts';

interface CoordinateInput {
  dinsight_x: number[];
  dinsight_y: number[];
}

export function createDinsightPreviewPlot(
  baselineData: CoordinateInput | null | undefined,
  monitoringData: CoordinateInput | null | undefined,
  theme: PlotTheme,
  options: {
    compact?: boolean;
    datasetId?: number | null;
    modeBar?: boolean;
    title?: string;
  } = {}
) {
  if (!baselineData || baselineData.dinsight_x.length === 0) {
    return null;
  }

  const compact = options.compact ?? false;
  const modeBar = options.modeBar ?? !compact;
  const baselineCount = baselineData.dinsight_x.length;
  const monitoringCount = monitoringData?.dinsight_x.length ?? 0;
  const pointSize = compact ? 4 : 6;
  const tooltipFormatter = (params: any) => {
    const value = params?.data?.value ?? params?.data;
    if (!Array.isArray(value)) {
      return `<b>${params?.seriesName ?? 'Point'}</b>`;
    }
    return `<b>${params.seriesName}</b><br/>Point: ${Number(value[2]).toLocaleString()}<br/>X: ${Number(value[0]).toFixed(4)}<br/>Y: ${Number(value[1]).toFixed(4)}`;
  };
  const series: any[] = [
    {
      type: 'scatter',
      name: `Baseline (${baselineCount.toLocaleString()})`,
      data: baselineData.dinsight_x.map((x, index) => [
        x,
        baselineData.dinsight_y[index],
        index + 1,
      ]),
      symbolSize: pointSize,
      large: true,
      largeThreshold: 2000,
      progressive: 1000,
      itemStyle: { color: alphaColor(theme.baseline, compact ? 0.5 : 0.58), borderWidth: 0 },
    },
  ];

  if (monitoringData && monitoringData.dinsight_x.length > 0) {
    series.push({
      type: 'scatter',
      name: `Monitoring (${monitoringCount.toLocaleString()})`,
      data: monitoringData.dinsight_x.map((x, index) => [
        x,
        monitoringData.dinsight_y[index],
        index + 1,
      ]),
      symbolSize: pointSize,
      large: true,
      largeThreshold: 2000,
      progressive: 1000,
      itemStyle: { color: alphaColor(theme.monitoring, compact ? 0.62 : 0.72), borderWidth: 0 },
    });
  }

  const xAxisRange = buildPaddedAxisRange([
    ...baselineData.dinsight_x,
    ...(monitoringData?.dinsight_x ?? []),
  ]);
  const yAxisRange = buildPaddedAxisRange([
    ...baselineData.dinsight_y,
    ...(monitoringData?.dinsight_y ?? []),
  ]);
  const revision = plotRevisionFromParts([
    options.datasetId ?? 'preview',
    baselineCount,
    monitoringCount,
    axisRangeRevisionPart(xAxisRange),
    axisRangeRevisionPart(yAxisRange),
  ]);
  const formatAxisLabel = (value: number) =>
    Number(value).toLocaleString(undefined, {
      maximumFractionDigits: Math.abs(value) >= 10 ? 1 : 2,
    });
  const option: EChartsOption = {
    animation: false,
    backgroundColor: 'transparent',
    color: [theme.baseline, theme.monitoring],
    tooltip: {
      trigger: 'item',
      confine: true,
      axisPointer: { type: 'cross' },
      formatter: tooltipFormatter,
    },
    legend: {
      type: 'scroll',
      top: compact ? 0 : 4,
      right: compact ? 4 : 12,
      itemWidth: 10,
      itemHeight: 8,
      textStyle: { color: theme.mutedText, fontSize: compact ? 10 : 12 },
    },
    toolbox: modeBar
      ? {
          show: true,
          right: 8,
          top: compact ? 22 : 28,
          feature: {
            dataZoom: { yAxisIndex: 'none' },
            brush: { type: ['rect', 'polygon', 'keep', 'clear'] },
            restore: {},
            saveAsImage: { pixelRatio: 2 },
          },
        }
      : undefined,
    brush: modeBar
      ? {
          toolbox: ['rect', 'polygon', 'keep', 'clear'],
          xAxisIndex: 0,
          yAxisIndex: 0,
          brushMode: 'multiple',
          throttleType: 'debounce',
          throttleDelay: 250,
        }
      : undefined,
    grid: compact
      ? { top: 32, right: 16, bottom: 42, left: 46, containLabel: true }
      : { top: options.title ? 76 : 58, right: 54, bottom: 80, left: 72, containLabel: true },
    title:
      options.title && !compact
        ? {
            text: options.title,
            left: 4,
            top: 4,
            textStyle: { color: theme.text, fontSize: 13, fontWeight: 600 },
          }
        : undefined,
    dataZoom: modeBar
      ? [
          { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
          { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
          { type: 'slider', xAxisIndex: 0, filterMode: 'none', height: 18, bottom: 18 },
          { type: 'slider', yAxisIndex: 0, filterMode: 'none', width: 16, right: 12 },
        ]
      : [
          { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
          { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
        ],
    xAxis: {
      type: 'value',
      name: compact ? '' : "D'insight X",
      nameLocation: 'middle',
      nameGap: compact ? 28 : 44,
      min: xAxisRange?.[0],
      max: xAxisRange?.[1],
      scale: true,
      axisLabel: { formatter: formatAxisLabel },
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { lineStyle: { color: theme.border } },
      splitLine: { lineStyle: { color: alphaColor(theme.chartGrid, 0.75) } },
    },
    yAxis: {
      type: 'value',
      name: compact ? '' : "D'insight Y",
      nameLocation: 'middle',
      nameGap: compact ? 34 : 52,
      min: yAxisRange?.[0],
      max: yAxisRange?.[1],
      scale: true,
      axisLabel: { formatter: formatAxisLabel },
      axisLine: { lineStyle: { color: theme.border } },
      axisTick: { lineStyle: { color: theme.border } },
      splitLine: { lineStyle: { color: alphaColor(theme.chartGrid, 0.75) } },
    },
    series,
  };

  return {
    option,
    revision,
  };
}
