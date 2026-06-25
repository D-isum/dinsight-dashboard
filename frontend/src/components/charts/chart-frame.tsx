'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Maximize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/utils/cn';

interface ChartFrameProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  stats?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  enableFullscreen?: boolean;
}

export function ChartFrame({
  title,
  description,
  actions,
  stats,
  children,
  className,
  bodyClassName,
  enableFullscreen = true,
}: ChartFrameProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFullscreen]);

  const header = (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
      <div className="grid min-w-0 flex-1 gap-3">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">{title}</h3>
            {description && <p className="mt-1 max-w-3xl text-xs text-fg-muted">{description}</p>}
          </div>
          {enableFullscreen && (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => setIsFullscreen(true)}
              aria-label={`Open ${title} fullscreen`}
              title="Open fullscreen"
              className="shrink-0"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        {actions && <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>}
        {stats && <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{stats}</div>}
      </div>
    </div>
  );

  const body = <div className={cn('min-w-0 p-3', bodyClassName)}>{children}</div>;

  return (
    <>
      <div className={cn('min-w-0 rounded-lg border border-border bg-surface', className)}>
        {header}
        {!isFullscreen && body}
      </div>

      {isFullscreen && (
        <div
          className="fixed inset-0 z-[90] flex min-w-0 flex-col bg-canvas p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={`${title} fullscreen chart`}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
            <div className="flex min-w-0 items-start justify-between gap-4 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-fg">{title}</h2>
                {description && (
                  <p className="mt-1 max-w-4xl text-xs text-fg-muted">{description}</p>
                )}
              </div>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setIsFullscreen(false)}
                aria-label={`Close ${title} fullscreen`}
                title="Close fullscreen"
                className="shrink-0"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            {(actions || stats) && (
              <div className="grid gap-2 border-b border-border px-4 py-3">
                {actions && (
                  <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
                )}
                {stats && (
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">{stats}</div>
                )}
              </div>
            )}
            <div className={cn('min-h-0 flex-1 overflow-auto p-3', bodyClassName)}>{children}</div>
          </div>
        </div>
      )}
    </>
  );
}

export function ChartStat({
  label,
  value,
  description,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  description?: string;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'baseline' | 'monitoring';
}) {
  return (
    <div
      title={description}
      tabIndex={description ? 0 : undefined}
      aria-label={description ? `${label}: ${description}` : undefined}
      className={cn(
        'min-h-[3.25rem] min-w-0 rounded-md border px-2.5 py-1.5 text-xs sm:min-w-[7.25rem]',
        description && 'cursor-help',
        tone === 'neutral' && 'border-border bg-surface-muted/60 text-fg',
        tone === 'info' && 'border-info-border bg-info-bg text-info-text',
        tone === 'success' && 'border-success-border bg-success-bg text-success-text',
        tone === 'warning' && 'border-warning-border bg-warning-bg text-warning-text',
        tone === 'danger' && 'border-danger-border bg-danger-bg text-danger-text',
        tone === 'baseline' && 'border-blue-200 bg-blue-50 text-blue-800',
        tone === 'monitoring' && 'border-red-200 bg-red-50 text-red-800'
      )}
    >
      <span className="block text-[0.68rem] font-medium uppercase leading-3 text-current opacity-70">
        {label}
      </span>
      <span className="mt-0.5 block font-semibold leading-4">{value}</span>
    </div>
  );
}

export function ChartSwatch({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-muted/60 px-2 py-1 text-xs text-fg-muted">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-medium text-fg">{label}</span>
      {value != null && <span>{value}</span>}
    </span>
  );
}

export function ChartEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-surface-muted/30 px-4 text-center">
      <p className="text-sm font-medium text-fg">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-fg-muted">{description}</p>
    </div>
  );
}
