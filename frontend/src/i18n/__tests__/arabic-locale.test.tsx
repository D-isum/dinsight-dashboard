import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import { I18nProvider, useI18n } from '@/i18n/client';
import {
  LOCALES,
  LOCALE_STORAGE_KEY,
  localeDirections,
  localeIntlTags,
  localeLabels,
  resolveLocale,
} from '@/i18n/config';
import { messages } from '@/i18n/messages';

const flattenMessages = (source: object, prefix = ''): Record<string, string> =>
  Object.entries(source).reduce<Record<string, string>>((result, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      result[path] = value;
    } else if (value && typeof value === 'object') {
      Object.assign(result, flattenMessages(value, path));
    }
    return result;
  }, {});

const placeholders = (value: string) =>
  [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

function LocaleProbe() {
  const { direction, formatNumber, locale } = useI18n();
  return (
    <output data-testid="locale-probe">
      {locale}|{direction}|{formatNumber(12345.6)}
    </output>
  );
}

describe('Arabic locale catalog', () => {
  it('registers Arabic as a right-to-left locale', () => {
    expect(LOCALES).toEqual(['en', 'ja', 'ar']);
    expect(localeLabels.ar).toEqual({ native: 'العربية', english: 'Arabic' });
    expect(localeDirections.ar).toBe('rtl');
    expect(localeIntlTags.ar).toBe('ar-EG-u-nu-latn');
    expect(resolveLocale('ar')).toBe('ar');
  });

  it('has exactly the same message keys as English and Japanese', () => {
    const englishKeys = Object.keys(flattenMessages(messages.en)).sort();

    expect(englishKeys).toHaveLength(1497);
    expect(Object.keys(flattenMessages(messages.ja)).sort()).toEqual(englishKeys);
    expect(Object.keys(flattenMessages(messages.ar)).sort()).toEqual(englishKeys);
  });

  it('preserves every interpolation placeholder', () => {
    const english = flattenMessages(messages.en);
    const arabic = flattenMessages(messages.ar);

    for (const [key, source] of Object.entries(english)) {
      expect(placeholders(arabic[key]), key).toEqual(placeholders(source));
    }
  });

  it('uses the reviewed predictive-maintenance terminology', () => {
    expect(messages.ar.nav.liveMonitor).toBe('المراقبة المباشرة');
    expect(messages.ar.nav.healthInsights).toBe('رؤى صحة الأصول');
    expect(messages.ar.data.title).toBe('مساحة عمل البيانات');
    expect(messages.ar.insights.baselineRolling).toBe('المتوسط المتحرك لخط الأساس');
    expect(messages.ar.insights.monitoringRolling).toBe('المتوسط المتحرك للمراقبة');
  });

  it('contains Arabic text throughout the translated catalog', () => {
    const values = Object.values(flattenMessages(messages.ar));
    const arabicValues = values.filter((value) => /[\u0600-\u06ff]/.test(value));

    // A small number of values are intentionally language-neutral, such as API,
    // CSV, D'Insight, keyboard shortcuts, and email placeholders.
    expect(arabicValues.length / values.length).toBeGreaterThan(0.96);
  });
});

describe('Arabic locale runtime', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = 'en';
    document.documentElement.dir = 'ltr';
    document.cookie = 'dinsight_locale=; Path=/; Max-Age=0';
  });

  it('switches the document to RTL and persists the selection', async () => {
    render(
      <I18nProvider initialLocale="en">
        <LanguageSwitcher />
        <LocaleProbe />
      </I18nProvider>
    );

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), {
      target: { value: 'ar' },
    });

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('lang', 'ar');
      expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    });

    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ar');
    expect(document.cookie).toContain('dinsight_locale=ar');
    expect(screen.getByRole('combobox', { name: 'اللغة' })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('locale-probe')).toHaveTextContent('ar|rtl|12,345.6');
  });
});
