import { describe, expect, it } from 'vitest';
import { createDinsightPreviewPlot } from '@/lib/dinsight-preview-plot';
import { DEFAULT_PLOT_THEME } from '@/lib/plot-theme';

describe('createDinsightPreviewPlot', () => {
  it('keeps point-level metadata hoverable when metadata is present', () => {
    const plot = createDinsightPreviewPlot(
      {
        dinsight_x: [1],
        dinsight_y: [2],
        metadata: [{ timestamp: '2003/10/22  12:06:24', source: '<baseline>' }],
      },
      null,
      DEFAULT_PLOT_THEME
    );

    const series = plot?.option.series as any[];
    const point = series[0].data[0];
    const tooltipFormatter = (plot?.option.tooltip as any).formatter;

    expect(series[0].large).toBeUndefined();
    expect(point[3]).toContain('timestamp');
    expect(point[3]).toContain('&lt;baseline&gt;');
    expect(tooltipFormatter({ seriesName: 'Baseline', data: point })).toContain('Metadata');
  });

  it('keeps large scatter rendering available when no metadata is present', () => {
    const plot = createDinsightPreviewPlot(
      { dinsight_x: [1], dinsight_y: [2] },
      null,
      DEFAULT_PLOT_THEME
    );

    const series = plot?.option.series as any[];

    expect(series[0].large).toBe(true);
  });
});
