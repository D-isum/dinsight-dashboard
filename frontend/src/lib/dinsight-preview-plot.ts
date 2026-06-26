import {
  axisRangeRevisionPart,
  buildPaddedAxisRange,
  plotRevisionFromParts,
} from '@/lib/plot-autoscale';
import { alphaColor, type PlotTheme } from '@/lib/plot-theme';
import type { MetadataEntry } from '@/types';
import type { EChartsOption } from 'echarts';

interface CoordinateInput {
  dinsight_x: number[];
  dinsight_y: number[];
  metadata?: MetadataEntry[];
}

const escapeHtml = (value: unknown): string =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatMetadataValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '-';
  }
  if (typeof value === 'string') {
    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 120 ? `${serialized.slice(0, 117)}...` : serialized;
  } catch {
    return '-';
  }
};

const metadataTooltipHtml = (
  metadata: MetadataEntry | undefined,
  labels: { metadata: string; moreFields: (count: number) => string }
): string => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return '';
  }

  const entries = Object.entries(metadata).filter(([key]) => key.trim().length > 0);
  if (entries.length === 0) {
    return '';
  }

  const visibleEntries = entries.slice(0, 8);
  const rows = visibleEntries
    .map(([key, value]) => `${escapeHtml(key)}: ${escapeHtml(formatMetadataValue(value))}`)
    .join('<br/>');
  const remaining = entries.length - visibleEntries.length;

  return `<br/><br/><b>${escapeHtml(labels.metadata)}</b><br/>${rows}${
    remaining > 0 ? `<br/>${escapeHtml(labels.moreFields(remaining))}` : ''
  }`;
};

const hasMetadataEntries = (metadata?: MetadataEntry[]): boolean =>
  Boolean(
    metadata?.some(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        Object.keys(entry).some((key) => key.trim().length > 0)
    )
  );

export function createDinsightPreviewPlot(
  baselineData: CoordinateInput | null | undefined,
  monitoringData: CoordinateInput | null | undefined,
  theme: PlotTheme,
  options: {
    compact?: boolean;
    datasetId?: number | null;
    modeBar?: boolean;
    title?: string;
    labels?: {
      baseline?: string;
      monitoring?: string;
      point?: string;
      metadata?: string;
      moreFields?: (count: number) => string;
      xAxis?: string;
      yAxis?: string;
      formatNumber?: (value: number, options?: Intl.NumberFormatOptions) => string;
    };
  } = {}
) {
  if (!baselineData || baselineData.dinsight_x.length === 0) {
    return null;
  }

  const compact = options.compact ?? false;
  const modeBar = options.modeBar ?? !compact;
  const baselineCount = baselineData.dinsight_x.length;
  const monitoringCount = monitoringData?.dinsight_x.length ?? 0;
  const labels = {
    baseline: options.labels?.baseline ?? 'Baseline',
    monitoring: options.labels?.monitoring ?? 'Monitoring',
    point: options.labels?.point ?? 'Point',
    metadata: options.labels?.metadata ?? 'Metadata',
    moreFields:
      options.labels?.moreFields ??
      ((count: number) => `+${count} more field${count === 1 ? '' : 's'}`),
    xAxis: options.labels?.xAxis ?? "D'insight X",
    yAxis: options.labels?.yAxis ?? "D'insight Y",
    formatNumber:
      options.labels?.formatNumber ??
      ((value: number, formatOptions?: Intl.NumberFormatOptions) =>
        value.toLocaleString(undefined, formatOptions)),
  };
  const scatterPerformanceOptions =
    hasMetadataEntries(baselineData.metadata) || hasMetadataEntries(monitoringData?.metadata)
      ? {}
      : { large: true, largeThreshold: 2000, progressive: 1000 };
  const pointSize = compact ? 4 : 6;
  const tooltipFormatter = (params: any) => {
    const value = params?.data?.value ?? params?.data;
    if (!Array.isArray(value)) {
      return `<b>${params?.seriesName ?? labels.point}</b>`;
    }
    const metadata = typeof value[3] === 'string' ? value[3] : '';
    return `<b>${params.seriesName}</b><br/>${labels.point}: ${labels.formatNumber(Number(value[2]))}<br/>X: ${Number(value[0]).toFixed(4)}<br/>Y: ${Number(value[1]).toFixed(4)}${metadata}`;
  };
  const series: any[] = [
    {
      type: 'scatter',
      name: `${labels.baseline} (${labels.formatNumber(baselineCount)})`,
      data: baselineData.dinsight_x.map((x, index) => [
        x,
        baselineData.dinsight_y[index],
        index + 1,
        metadataTooltipHtml(baselineData.metadata?.[index], labels),
      ]),
      symbolSize: pointSize,
      ...scatterPerformanceOptions,
      itemStyle: { color: alphaColor(theme.baseline, compact ? 0.5 : 0.58), borderWidth: 0 },
    },
  ];

  if (monitoringData && monitoringData.dinsight_x.length > 0) {
    series.push({
      type: 'scatter',
      name: `${labels.monitoring} (${labels.formatNumber(monitoringCount)})`,
      data: monitoringData.dinsight_x.map((x, index) => [
        x,
        monitoringData.dinsight_y[index],
        index + 1,
        metadataTooltipHtml(monitoringData.metadata?.[index], labels),
      ]),
      symbolSize: pointSize,
      ...scatterPerformanceOptions,
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
      labels.formatNumber(Number(value), {
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
      name: compact ? '' : labels.xAxis,
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
      name: compact ? '' : labels.yAxis,
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
