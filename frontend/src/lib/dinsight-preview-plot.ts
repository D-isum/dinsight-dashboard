import {
  axisRangeRevisionPart,
  buildPaddedAxisRange,
  plotRevisionFromParts,
} from '@/lib/plot-autoscale';
import { createThemedPlotConfig, createThemedPlotLayout, type PlotTheme } from '@/lib/plot-theme';

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
  const baselineCount = baselineData.dinsight_x.length;
  const monitoringCount = monitoringData?.dinsight_x.length ?? 0;
  const traces: any[] = [
    {
      x: baselineData.dinsight_x,
      y: baselineData.dinsight_y,
      type: 'scattergl',
      mode: 'markers',
      name: `Baseline (${baselineCount.toLocaleString()})`,
      marker: {
        color: theme.baseline,
        size: compact ? 4 : 6,
        opacity: compact ? 0.5 : 0.58,
        line: { color: theme.surface, width: compact ? 0 : 0.25 },
      },
      customdata: baselineData.dinsight_x.map((_, index) => index + 1),
      hovertemplate: 'Baseline point %{customdata}<br>X: %{x:.4f}<br>Y: %{y:.4f}<extra></extra>',
    },
  ];

  if (monitoringData && monitoringData.dinsight_x.length > 0) {
    traces.push({
      x: monitoringData.dinsight_x,
      y: monitoringData.dinsight_y,
      type: 'scattergl',
      mode: 'markers',
      name: `Monitoring (${monitoringCount.toLocaleString()})`,
      marker: {
        color: theme.monitoring,
        size: compact ? 4 : 6,
        opacity: compact ? 0.62 : 0.72,
        line: { color: theme.surface, width: compact ? 0 : 0.25 },
      },
      customdata: monitoringData.dinsight_x.map((_, index) => index + 1),
      hovertemplate: 'Monitoring point %{customdata}<br>X: %{x:.4f}<br>Y: %{y:.4f}<extra></extra>',
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

  return {
    data: traces,
    revision,
    layout: createThemedPlotLayout(
      theme,
      {
        title: options.title ? { text: options.title, x: 0, xanchor: 'left' } : '',
        margin: compact ? { t: 14, r: 10, b: 34, l: 42 } : { t: 42, r: 22, b: 56, l: 62 },
        xaxis: {
          title: compact ? '' : "D'insight X",
          autorange: !xAxisRange,
          ...(xAxisRange ? { range: xAxisRange } : {}),
        },
        yaxis: {
          title: compact ? '' : "D'insight Y",
          autorange: !yAxisRange,
          ...(yAxisRange ? { range: yAxisRange } : {}),
        },
        legend: {
          orientation: 'h',
          yanchor: 'bottom',
          y: 1.02,
          xanchor: 'right',
          x: 1,
        },
        uirevision: options.datasetId ?? 'preview',
      },
      { compact }
    ),
    config: createThemedPlotConfig({ modeBar: options.modeBar ?? !compact }),
  };
}
