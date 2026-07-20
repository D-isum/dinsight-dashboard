import { useState } from 'react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfigDialog } from '@/components/ui/config-dialog';
import { useI18n } from '@/i18n/client';

interface MetadataHoverControlsProps {
  availableKeys: string[];
  selectedKeys: string[];
  onToggleKey: (key: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  metadataEnabled: boolean;
  onToggleEnabled: (value: boolean) => void;
  className?: string;
  disabled?: boolean;
}

export function MetadataHoverControls({
  availableKeys,
  selectedKeys,
  onToggleKey,
  onSelectAll,
  onClearAll,
  metadataEnabled,
  onToggleEnabled,
  className,
  disabled = false,
}: MetadataHoverControlsProps) {
  const { t } = useI18n();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const hasSelection = metadataEnabled && selectedKeys.length > 0;
  const previewKeys = selectedKeys.slice(0, 3);
  const remainingCount = selectedKeys.length - previewKeys.length;
  const hasMetadataAvailable = availableKeys.length > 0;
  const toggleId = 'metadata-hover-enabled';

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-fg">{t('live.hoverMetadata')}</p>
          <p className="text-xs text-fg-muted">{t('live.hoverMetadataDescription')}</p>
        </div>
        <label className="mt-1 inline-flex items-center gap-2 text-xs text-fg-muted">
          <span className="sr-only">{t('live.enableHoverMetadata')}</span>
          <input
            id={toggleId}
            type="checkbox"
            className="rounded border-strong"
            checked={metadataEnabled && hasMetadataAvailable && !disabled}
            onChange={(event) => onToggleEnabled(event.target.checked)}
            disabled={!hasMetadataAvailable || disabled}
            aria-describedby={`${toggleId}-status`}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {hasSelection ? (
          <>
            {previewKeys.map((key) => (
              <Badge key={key} variant="secondary" className="text-xs">
                {key}
              </Badge>
            ))}
            {remainingCount > 0 && (
              <span className="text-xs text-fg-muted">
                {t('live.moreMetadataFields', { count: remainingCount })}
              </span>
            )}
          </>
        ) : (
          <span id={`${toggleId}-status`} className="text-xs text-fg-muted">
            {hasMetadataAvailable
              ? t('live.noMetadataFieldsSelected')
              : t('live.metadataFieldsAfterLoad')}
          </span>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="text-sm"
        onClick={() => setIsDialogOpen(true)}
        disabled={!hasMetadataAvailable || disabled}
      >
        {t('live.configureFields')}
      </Button>

      <ConfigDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        title={t('live.configureHoverMetadata')}
        description={t('live.configureHoverMetadataDescription')}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={onSelectAll}
              disabled={!hasMetadataAvailable}
            >
              {t('common.selectAll')}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClearAll}>
              {t('common.clear')}
            </Button>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {hasMetadataAvailable ? (
              availableKeys.map((key) => {
                const checked = selectedKeys.includes(key);
                return (
                  <label
                    key={key}
                    className={cn(
                      'flex items-center justify-between px-4 py-2 text-sm',
                      checked
                        ? 'bg-surface-selected dark:bg-surface-selected text-accent '
                        : 'text-fg'
                    )}
                  >
                    <span className="truncate pe-3">{key}</span>
                    <input
                      type="checkbox"
                      className="rounded border-strong"
                      checked={checked}
                      onChange={() => onToggleKey(key)}
                    />
                  </label>
                );
              })
            ) : (
              <div className="px-4 py-6 text-center text-sm text-fg-muted">
                {t('live.metadataFieldsAfterLoad')}
              </div>
            )}
          </div>

          <div className="text-xs text-fg-muted">{t('live.hoverMetadataTip')}</div>
        </div>
      </ConfigDialog>
    </div>
  );
}
