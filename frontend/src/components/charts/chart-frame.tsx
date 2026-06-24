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
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {description && <p className="mt-1 text-xs text-fg-muted">{description}</p>}
          {stats && <div className="mt-3 flex flex-wrap gap-2">{stats}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className={cn('min-w-0 p-3', bodyClassName)}>{children}</div>
    </div>
  );
}

export function ChartStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger';
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-2.5 py-1.5 text-xs',
        tone === 'neutral' && 'border-border bg-surface-muted/60 text-fg',
        tone === 'info' && 'border-info-border bg-info-bg text-info-text',
        tone === 'success' && 'border-success-border bg-success-bg text-success-text',
        tone === 'warning' && 'border-warning-border bg-warning-bg text-warning-text',
        tone === 'danger' && 'border-danger-border bg-danger-bg text-danger-text'
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
