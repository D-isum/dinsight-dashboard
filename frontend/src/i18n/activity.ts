import type { DashboardActivity } from '@/context/dashboard-workspace-context';

type Primitive = string | number | boolean | null | undefined;
type Translate = (key: string, values?: Record<string, Primitive>) => string;

export const localizeDashboardActivity = (activity: DashboardActivity, t: Translate) => {
  let title = activity.title;
  let description = activity.description;

  const wearTrendMatch = title.match(/^Wear trend result ready for dataset #(\d+)$/);
  if (wearTrendMatch) {
    title = t('activity.wearTrendReady', { id: wearTrendMatch[1] });
  }

  const streamingMatch = title.match(/^Streaming (completed|active|paused) for dataset #(\d+)$/);
  if (streamingMatch) {
    const statusKey =
      streamingMatch[1] === 'completed'
        ? 'activity.streamingCompleted'
        : streamingMatch[1] === 'active'
          ? 'activity.streamingActive'
          : 'activity.streamingPaused';
    title = t(statusKey, { id: streamingMatch[2] });
  }

  const intervalsMatch = description?.match(
    /^([\d,.]+) intervals analyzed: ([\d,.]+) baseline points and ([\d,.]+) monitoring points\.$/
  );
  if (intervalsMatch) {
    description = t('insights.intervalsAnalyzed', {
      intervals: intervalsMatch[1],
      baseline: intervalsMatch[2],
      monitoring: intervalsMatch[3],
    });
  }

  const streamedMatch = description?.match(/^([\d,.]+) of ([\d,.]+) points streamed\.$/);
  if (streamedMatch) {
    description = t('activity.pointsStreamed', {
      streamed: streamedMatch[1],
      total: streamedMatch[2],
    });
  }

  return { title, description };
};
