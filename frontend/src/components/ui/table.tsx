import * as React from 'react';
import { cn } from '@/utils/cn';

/**
 * Table primitive — design-system.md §11.9.
 *
 * Implements the structural and state pieces tables share across the app
 * so pages can compose data tables without reinventing chrome. Pairs with
 * AlertTitle/Alert for empty/error states and Spinner for loading.
 *
 * Composition:
 *   <Table>
 *     <TableHeader>
 *       <TableRow>
 *         <TableHead>Asset</TableHead>
 *         <TableHead align="right">Anomaly</TableHead>
 *       </TableRow>
 *     </TableHeader>
 *     <TableBody>
 *       <TableRow selected aria-selected="true">
 *         <TableCell>Pump A</TableCell>
 *         <TableCell align="right" mono>12.3%</TableCell>
 *       </TableRow>
 *     </TableBody>
 *   </Table>
 *
 * For empty / loading / error states, wrap or replace TableBody with
 * <TableEmpty>, <TableLoading>, or <TableError>.
 */

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="w-full overflow-auto">
      <table
        ref={ref}
        className={cn('w-full caption-bottom text-sm text-fg', className)}
        {...props}
      />
    </div>
  )
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('border-b border-border [&_tr]:border-0', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t border-border bg-surface-muted text-sm font-medium text-fg [&>tr]:last:border-b-0',
      className
    )}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Persistent selected styling using semantic selected-surface token. */
  selected?: boolean;
  /** Severity highlight for alert/critical rows. */
  intent?: 'success' | 'warning' | 'danger' | 'info';
}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, selected, intent, ...props }, ref) => (
    <tr
      ref={ref}
      data-state={selected ? 'selected' : undefined}
      className={cn(
        'border-b border-border transition-colors duration-150',
        'hover:bg-surface-hover',
        selected && 'bg-surface-selected',
        intent === 'success' && 'bg-success-bg',
        intent === 'warning' && 'bg-warning-bg',
        intent === 'danger' && 'bg-danger-bg',
        intent === 'info' && 'bg-info-bg',
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = 'TableRow';

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center';
  /** When set, indicates the column is sorted; pass 'asc' or 'desc'. */
  sorted?: 'asc' | 'desc';
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, align = 'left', sorted, ...props }, ref) => (
    <th
      ref={ref}
      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
      className={cn(
        'h-10 px-3 text-xs font-medium uppercase tracking-wide text-fg-muted',
        align === 'left' && 'text-start',
        align === 'right' && 'text-end',
        align === 'center' && 'text-center',
        sorted && 'text-fg',
        className
      )}
      {...props}
    />
  )
);
TableHead.displayName = 'TableHead';

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center';
  /** Render numeric / technical values in monospace with tabular numerals. */
  mono?: boolean;
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, align = 'left', mono, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        'px-3 py-2 align-middle',
        align === 'left' && 'text-start',
        align === 'right' && 'text-end tabular-nums',
        align === 'center' && 'text-center',
        mono && 'font-mono text-xs tabular-nums',
        className
      )}
      {...props}
    />
  )
);
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-3 text-xs text-fg-subtle', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

/** Centered message for the loading state. Keeps layout stable. */
function TableLoading({
  message = 'Loading…',
  rowSpan = 8,
}: {
  message?: string;
  rowSpan?: number;
}) {
  return (
    <tr>
      <td
        colSpan={rowSpan}
        className="px-3 py-10 text-center text-sm text-fg-muted"
        aria-busy="true"
      >
        <span className="inline-flex items-center gap-2">
          <span className="spinner" aria-hidden="true" />
          {message}
        </span>
      </td>
    </tr>
  );
}

/** Centered message for the empty state. Operator-friendly copy. */
function TableEmpty({
  message = 'Nothing to show yet.',
  rowSpan = 8,
}: {
  message?: React.ReactNode;
  rowSpan?: number;
}) {
  return (
    <tr>
      <td colSpan={rowSpan} className="px-3 py-10 text-center text-sm text-fg-muted">
        {message}
      </td>
    </tr>
  );
}

/** Centered danger-tinted message for the error state. */
function TableError({
  message = 'Something went wrong loading this data.',
  rowSpan = 8,
}: {
  message?: React.ReactNode;
  rowSpan?: number;
}) {
  return (
    <tr>
      <td colSpan={rowSpan} className="px-3 py-10 text-center text-sm text-danger-text">
        {message}
      </td>
    </tr>
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  TableLoading,
  TableEmpty,
  TableError,
};
