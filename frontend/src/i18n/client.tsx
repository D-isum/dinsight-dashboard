'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  localeDirections,
  localeIntlTags,
  type Locale,
  type TextDirection,
  resolveLocale,
} from '@/i18n/config';
import { messages, type Messages } from '@/i18n/messages';

type Primitive = string | number | boolean | null | undefined;

interface I18nContextValue {
  locale: Locale;
  direction: TextDirection;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: Record<string, Primitive>) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const getPathValue = (source: Messages, path: string): string | undefined => {
  const value = path.split('.').reduce<unknown>((current, part) => {
    if (current && typeof current === 'object' && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);

  return typeof value === 'string' ? value : undefined;
};

const interpolate = (template: string, values?: Record<string, Primitive>) => {
  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = values[key];
    return value == null ? match : String(value);
  });
};

const getInitialBrowserLocale = (initialLocale: Locale): Locale => {
  if (typeof window === 'undefined') {
    return initialLocale;
  }

  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) {
      return resolveLocale(stored);
    }
  } catch {
    // Ignore storage failures.
  }

  return initialLocale;
};

const persistLocale = (locale: Locale) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDirections[locale];
    document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures.
  }
};

export function I18nProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}: {
  initialLocale?: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => getInitialBrowserLocale(initialLocale));
  const direction = localeDirections[locale];

  useEffect(() => {
    persistLocale(locale);
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(resolveLocale(nextLocale));
  }, []);

  const t = useCallback(
    (key: string, values?: Record<string, Primitive>) => {
      const localized =
        getPathValue(messages[locale], key) ?? getPathValue(messages.en, key) ?? key;
      return interpolate(localized, values);
    },
    [locale]
  );

  const formatNumber = useCallback(
    (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(localeIntlTags[locale], options).format(value),
    [locale]
  );

  const formatDate = useCallback(
    (value: string | number | Date, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(localeIntlTags[locale], {
        dateStyle: 'medium',
        ...options,
      }).format(new Date(value)),
    [locale]
  );

  const formatTime = useCallback(
    (value: string | number | Date, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(localeIntlTags[locale], {
        timeStyle: 'short',
        ...options,
      }).format(new Date(value)),
    [locale]
  );

  const value = useMemo(
    () => ({ locale, direction, setLocale, t, formatNumber, formatDate, formatTime }),
    [direction, formatDate, formatNumber, formatTime, locale, setLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
};
