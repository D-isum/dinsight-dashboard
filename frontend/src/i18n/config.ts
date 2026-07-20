export const LOCALES = ['en', 'ja', 'ar'] as const;

export type Locale = (typeof LOCALES)[number];
export type TextDirection = 'ltr' | 'rtl';

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'dinsight_locale';
export const LOCALE_STORAGE_KEY = 'dinsight:locale';

export const localeLabels: Record<Locale, { native: string; english: string }> = {
  en: { native: 'English', english: 'English' },
  ja: { native: '日本語', english: 'Japanese' },
  ar: { native: 'العربية', english: 'Arabic' },
};

export const localeDirections: Record<Locale, TextDirection> = {
  en: 'ltr',
  ja: 'ltr',
  ar: 'rtl',
};

export const localeIntlTags: Record<Locale, string> = {
  en: 'en-US',
  ja: 'ja-JP',
  // Arabic labels with Latin digits keep dataset IDs and engineering values easy to compare.
  ar: 'ar-EG-u-nu-latn',
};

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && LOCALES.includes(value as Locale);

export const resolveLocale = (value: unknown): Locale => (isLocale(value) ? value : DEFAULT_LOCALE);
