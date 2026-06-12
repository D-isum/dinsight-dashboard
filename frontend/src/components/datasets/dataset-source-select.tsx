import type { DatasetSourceGroup } from '@/lib/dataset-source-groups';

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
  return (
    <select
      value={selectedSourceKey ?? ''}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || groups.length === 0}
      className={
        className ??
        'w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60'
      }
      title="Select device or dataset source"
    >
      <option value="" disabled>
        {groups.length === 0 ? 'No dataset sources found' : 'Select device / source'}
      </option>
      {groups.map((group) => (
        <option key={group.key} value={group.key}>
          {group.label} ({group.datasets.length})
        </option>
      ))}
    </select>
  );
}
