'use client';

import type { DatasetSourceGroup } from '@/lib/dataset-source-groups';
import { useI18n } from '@/i18n/client';

interface DatasetSourceSelectProps {
  groups: DatasetSourceGroup[];
  selectedSourceKey: string | null;
  onChange: (key: string) => void;
  disabled?: boolean;
  className?: string;
}

export function DatasetSourceSelect({
  groups,
  selectedSourceKey,
  onChange,
  disabled,
  className,
}: DatasetSourceSelectProps) {
  const { t, formatNumber } = useI18n();

  return (
    <select
      value={selectedSourceKey ?? ''}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || groups.length === 0}
      className={
        className ??
        'w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60'
      }
      title={t('header.selectSource')}
    >
      <option value="" disabled>
        {groups.length === 0 ? t('header.noDatasetSources') : t('header.selectSource')}
      </option>
      {groups.map((group) => (
        <option key={group.key} value={group.key}>
          {group.label} ({formatNumber(group.datasets.length)})
        </option>
      ))}
    </select>
  );
}
