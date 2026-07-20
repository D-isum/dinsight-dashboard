import { describe, expect, it } from 'vitest';
import type { DashboardActivity } from '@/context/dashboard-workspace-context';
import { localizeDashboardActivity } from '@/i18n/activity';
import { localizeDataError } from '@/i18n/data-errors';
import { messages } from '@/i18n/messages';

const getMessage = (key: string) =>
  key.split('.').reduce<unknown>((value, part) => {
    if (value && typeof value === 'object' && part in value) {
      return (value as Record<string, unknown>)[part];
    }
    return undefined;
  }, messages.ar);

const t = (key: string, values?: Record<string, string | number | boolean | null | undefined>) => {
  const message = getMessage(key);
  if (typeof message !== 'string') {
    return key;
  }
  return message.replace(/\{(\w+)\}/g, (placeholder, name) => {
    const value = values?.[name];
    return value == null ? placeholder : String(value);
  });
};

const activity = (overrides: Partial<DashboardActivity>): DashboardActivity => ({
  id: 'activity-1',
  type: 'system',
  title: 'Activity',
  timestamp: '2026-07-20T12:00:00.000Z',
  ...overrides,
});

describe('localized runtime content', () => {
  it('translates stored wear-trend activity created before the locale changed', () => {
    const localized = localizeDashboardActivity(
      activity({
        type: 'analysis',
        title: 'Wear trend result ready for dataset #56',
        description: '2,156 intervals analyzed: 540 baseline points and 1,616 monitoring points.',
      }),
      t
    );

    expect(localized.title).toBe('نتيجة اتجاه التآكل جاهزة لمجموعة البيانات #56');
    expect(localized.description).toBe(
      'تم تحليل 2,156 فترة: 540 نقطة لخط الأساس و1,616 نقطة للمراقبة.'
    );
  });

  it('translates stored streaming activity created before the locale changed', () => {
    const localized = localizeDashboardActivity(
      activity({
        type: 'streaming',
        title: 'Streaming completed for dataset #56',
        description: '1,616 of 1,616 points streamed.',
      }),
      t
    );

    expect(localized.title).toBe('اكتمل البث لمجموعة البيانات #56');
    expect(localized.description).toBe('تم بث 1,616 من أصل 1,616 نقطة.');
  });

  it('translates known client-side coordinate errors and preserves API detail', () => {
    expect(
      localizeDataError(
        'Monitoring data not found for this baseline. Upload monitoring data to continue.',
        t
      )
    ).toBe('لم يتم العثور على بيانات مراقبة لخط الأساس هذا. حمّل بيانات المراقبة للمتابعة.');
    expect(localizeDataError('Sensor gateway returned status 503.', t)).toBe(
      'Sensor gateway returned status 503.'
    );
  });
});
