import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/utils/cn';

/**
 * Alert / notice surface — design-system.md §11.8.
 *
 * Severities map to the semantic ramps so colour stays consistent with
 * every other surface that consumes the same family (badge, kpi card,
 * table row, toast). Title and Description compose on the same surface.
 *
 * Layout: a leading icon (rendered as a sibling <svg>) gets positioned
 * top-left; the text content shifts right via the [&>svg~*] selector so
 * authors don't need to add manual padding.
 */
const alertVariants = cva(
  'relative w-full rounded-lg border p-4 text-sm [&>svg]:absolute [&>svg]:start-4 [&>svg]:top-4 [&>svg]:h-4 [&>svg]:w-4 [&>svg~*]:ps-7',
  {
    variants: {
      variant: {
        default: 'border-border bg-surface text-fg [&>svg]:text-fg-muted',
        info: 'border-info-border bg-info-bg text-info-text [&>svg]:text-info-text',
        success: 'border-success-border bg-success-bg text-success-text [&>svg]:text-success-text',
        warning: 'border-warning-border bg-warning-bg text-warning-text [&>svg]:text-warning-text',
        // `destructive` retained as an alias for `danger` so existing call
        // sites keep working until Phase C5 codemod swaps them.
        destructive: 'border-danger-border bg-danger-bg text-danger-text [&>svg]:text-danger-text',
        danger: 'border-danger-border bg-danger-bg text-danger-text [&>svg]:text-danger-text',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5
      ref={ref}
      className={cn('mb-1 font-semibold leading-tight tracking-tight', className)}
      {...props}
    />
  )
);
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm leading-relaxed [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription, alertVariants };
