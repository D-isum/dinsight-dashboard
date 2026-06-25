import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export function WorkflowState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-[220px] flex-col items-center justify-center rounded-md border border-dashed border-border bg-surface-muted/30 px-4 py-8 text-center',
        className
      )}
    >
      {icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-fg-muted">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-5 text-fg-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
