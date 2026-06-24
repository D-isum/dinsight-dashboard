'use client';

import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface ChartFrameProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  stats?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function ChartFrame({
  title,
  description,
  actions,
  stats,
  children,
  className,
  bodyClassName,
}: ChartFrameProps) {
  return (
    <div className={cn('min-w-0 rounded-lg border border-border bg-surface', className)}>
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid min-w-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-fg">{title}</h3>
            {description && <p className="mt-1 text-xs text-fg-muted">{description}</p>}
          </div>
          {actions && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
              {actions}
            </div>
          )}
          {stats && (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:col-span-2">{stats}</div>
          )}
        </div>
      </div>
      <div className={cn('min-w-0 p-3', bodyClassName)}>{children}</div>
    </div>
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
