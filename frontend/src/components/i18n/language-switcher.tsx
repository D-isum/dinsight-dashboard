'use client';

import { Languages } from 'lucide-react';
import { LOCALES, localeLabels, type Locale } from '@/i18n/config';
import { useI18n } from '@/i18n/client';
import { cn } from '@/utils/cn';

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, direction, setLocale, t } = useI18n();

  return (
    <label
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border border-border bg-background px-2 text-xs text-fg',
        compact ? 'h-9' : 'h-10'
      )}
      title={t('common.language')}
    >
      <Languages className="h-4 w-4 text-fg-muted" aria-hidden="true" />
      <span className="sr-only">{t('common.language')}</span>
      <select
        value={locale}
        dir={direction}
        onChange={(event) => setLocale(event.target.value as Locale)}
        className="h-full bg-transparent text-xs outline-none"
        aria-label={t('common.language')}
      >
        {LOCALES.map((item) => (
          <option key={item} value={item}>
            {localeLabels[item].native}
          </option>
        ))}
      </select>
    </label>
  );
}
