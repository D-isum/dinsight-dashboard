import { useEffect, useState } from 'react';

export interface PlotTheme {
  canvas: string;
  surface: string;
  surfaceRaised: string;
  surfaceMuted: string;
  border: string;
  text: string;
  mutedText: string;
  subtleText: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  chartGrid: string;
  chartAxis: string;
  chartNeutralLine: string;
  chartThreshold: string;
  baseline: string;
  baselineSoft: string;
  monitoring: string;
  monitoringSoft: string;
  baselineRolling: string;
  monitoringRolling: string;
  latest: string;
  latestLine: string;
  trailOld: string;
  trailMid: string;
  trailLatest: string;
  anomaly: string;
  normal: string;
}

export const DEFAULT_PLOT_THEME: PlotTheme = {
  canvas: '#f3f5f7',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  surfaceMuted: '#e9eef3',
  border: '#d5dee7',
  text: '#0f1720',
  mutedText: '#475467',
  subtleText: '#667085',
  accent: '#155eef',
  success: '#15803d',
  warning: '#b45309',
  danger: '#b42318',
  info: '#0f6e8c',
  chartGrid: '#e4e7ec',
  chartAxis: '#667085',
  chartNeutralLine: '#98a2b3',
  chartThreshold: '#b45309',
  baseline: '#2563eb',
  baselineSoft: 'rgba(37, 99, 235, 0.16)',
  monitoring: '#dc2626',
  monitoringSoft: 'rgba(220, 38, 38, 0.24)',
  baselineRolling: '#0f766e',
  monitoringRolling: '#7c3aed',
  latest: '#facc15',
  latestLine: '#111827',
  trailOld: '#991b1b',
  trailMid: '#f97316',
  trailLatest: '#facc15',
  anomaly: '#ef4444',
  normal: '#16a34a',
};

const cssVar = (
  styles: CSSStyleDeclaration,
  name: string,
  fallback: string = DEFAULT_PLOT_THEME.surface
) => styles.getPropertyValue(name).trim() || fallback;

export function alphaColor(color: string, alpha: number): string {
  const normalized = color.trim();
  const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const expanded =
      hex.length === 3
        ? hex
            .split('')
            .map((char) => `${char}${char}`)
            .join('')
        : hex;
    const r = Number.parseInt(expanded.slice(0, 2), 16);
    const g = Number.parseInt(expanded.slice(2, 4), 16);
    const b = Number.parseInt(expanded.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const rgb = normalized.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((part) => part.trim());
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return normalized;
}

function readPlotThemeFromDom(): PlotTheme {
  if (typeof window === 'undefined') {
    return DEFAULT_PLOT_THEME;
  }

  const styles = window.getComputedStyle(document.documentElement);
  const surface = cssVar(styles, '--color-surface', DEFAULT_PLOT_THEME.surface);
  const surfaceRaised = cssVar(styles, '--color-surface-raised', DEFAULT_PLOT_THEME.surfaceRaised);
  const accent = cssVar(styles, '--color-accent', DEFAULT_PLOT_THEME.accent);
  const success = cssVar(styles, '--color-success', DEFAULT_PLOT_THEME.success);
  const warning = cssVar(styles, '--color-warning', DEFAULT_PLOT_THEME.warning);
  const danger = cssVar(styles, '--color-danger', DEFAULT_PLOT_THEME.danger);

  return {
    canvas: cssVar(styles, '--color-canvas', DEFAULT_PLOT_THEME.canvas),
    surface,
    surfaceRaised,
    surfaceMuted: cssVar(styles, '--color-surface-muted', DEFAULT_PLOT_THEME.surfaceMuted),
    border: cssVar(styles, '--color-border', DEFAULT_PLOT_THEME.border),
    text: cssVar(styles, '--color-text', DEFAULT_PLOT_THEME.text),
    mutedText: cssVar(styles, '--color-text-muted', DEFAULT_PLOT_THEME.mutedText),
    subtleText: cssVar(styles, '--color-text-subtle', DEFAULT_PLOT_THEME.subtleText),
    accent,
    success,
    warning,
    danger,
    info: cssVar(styles, '--color-info', DEFAULT_PLOT_THEME.info),
    chartGrid: cssVar(styles, '--color-chart-grid', DEFAULT_PLOT_THEME.chartGrid),
    chartAxis: cssVar(styles, '--color-chart-axis', DEFAULT_PLOT_THEME.chartAxis),
    chartNeutralLine: cssVar(
      styles,
      '--color-chart-neutral-line',
      DEFAULT_PLOT_THEME.chartNeutralLine
    ),
    chartThreshold: cssVar(styles, '--color-chart-threshold', DEFAULT_PLOT_THEME.chartThreshold),
    baseline: accent,
    baselineSoft: alphaColor(accent, 0.16),
    monitoring: danger,
    monitoringSoft: alphaColor(danger, 0.24),
    baselineRolling: cssVar(styles, '--color-chart-baseline-rolling', '#0f766e'),
    monitoringRolling: cssVar(styles, '--color-chart-monitoring-rolling', '#7c3aed'),
    latest: '#facc15',
    latestLine: cssVar(styles, '--color-text', DEFAULT_PLOT_THEME.text),
    trailOld: alphaColor(danger, 0.72),
    trailMid: warning,
    trailLatest: '#facc15',
    anomaly: danger,
    normal: success,
  };
}

export function usePlotTheme(): PlotTheme {
  const [theme, setTheme] = useState<PlotTheme>(DEFAULT_PLOT_THEME);

  useEffect(() => {
    const update = () => setTheme(readPlotThemeFromDom());
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    return () => observer.disconnect();
  }, []);

  return theme;
}

export function createThemedPlotLayout(
  theme: PlotTheme,
  layout: Record<string, unknown> = {},
  options: { compact?: boolean } = {}
): Record<string, unknown> {
  const compact = options.compact ?? false;
  const xaxis = (layout.xaxis ?? {}) as Record<string, unknown>;
  const yaxis = (layout.yaxis ?? {}) as Record<string, unknown>;

  const axisDefaults = {
    color: theme.chartAxis,
    gridcolor: theme.chartGrid,
    zerolinecolor: alphaColor(theme.chartNeutralLine, 0.82),
    linecolor: theme.border,
    tickcolor: theme.border,
    automargin: true,
    titlefont: { color: theme.mutedText, size: compact ? 11 : 12 },
    tickfont: { color: theme.chartAxis, size: compact ? 10 : 11 },
  };

  return {
    autosize: true,
    template: 'plotly_white',
    paper_bgcolor: theme.surface,
    plot_bgcolor: theme.surface,
    font: {
      color: theme.text,
      family: 'IBM Plex Sans, system-ui, sans-serif',
      size: compact ? 11 : 12,
    },
    hoverlabel: {
      bgcolor: theme.surfaceRaised,
      bordercolor: theme.border,
      font: { color: theme.text },
    },
    legend: {
      orientation: 'h',
      yanchor: 'bottom',
      y: 1.02,
      xanchor: 'right',
      x: 1,
      font: { color: theme.mutedText, size: compact ? 10 : 12 },
      bgcolor: alphaColor(theme.surface, 0),
      ...(layout.legend as Record<string, unknown> | undefined),
    },
    margin: compact ? { t: 12, r: 12, b: 34, l: 42 } : { t: 46, r: 24, b: 56, l: 62 },
    ...layout,
    xaxis: {
      ...axisDefaults,
      ...xaxis,
    },
    yaxis: {
      ...axisDefaults,
      ...yaxis,
    },
  };
}

export function createThemedPlotConfig(options: { modeBar?: boolean } = {}) {
  return {
    responsive: true,
    displaylogo: false,
    displayModeBar: options.modeBar ?? true,
    scrollZoom: true,
    modeBarButtonsToRemove: [
      'toImage',
      'toggleSpikelines',
      'hoverCompareCartesian',
      'hoverClosestCartesian',
    ],
  };
}
