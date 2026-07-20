import * as React from 'react';
import { cn } from '@/utils/cn';

/**
 * Text input — design-system.md §11.5 universal state model.
 *
 * Implements the seven required states at the primitive level so pages
 * don't reinvent them inline:
 *   - default / hover / focus-visible — semantic control tokens
 *   - invalid                          — aria-invalid switches border + ring to danger
 *   - read-only                        — readOnly distinguishes from disabled
 *   - disabled                         — distinct surface, preserved legibility
 *   - loading                          — internal state, sets aria-busy + spinner affordance
 *
 * Optional helper / error text is rendered below the field via the
 * `helperText` / `errorText` props so labels and error messaging follow
 * one consistent layout across the app.
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Invalid state — also accepts aria-invalid for native form integrations. */
  invalid?: boolean;
  /** Field is awaiting async data. Adds aria-busy and a trailing spinner. */
  loading?: boolean;
  /** Below-field helper text (rendered when not invalid). */
  helperText?: React.ReactNode;
  /** Below-field error text. When set, the field also receives invalid styling. */
  errorText?: React.ReactNode;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, invalid, loading, helperText, errorText, id, readOnly, ...props }, ref) => {
    const reactId = React.useId();
    const inputId = id ?? reactId;
    const isInvalid = invalid || Boolean(errorText) || props['aria-invalid'] === true;
    const messageId = errorText || helperText ? `${inputId}-message` : undefined;

    return (
      <div className="w-full">
        <div className="relative">
          <input
            id={inputId}
            ref={ref}
            type={type}
            readOnly={readOnly}
            aria-invalid={isInvalid || undefined}
            aria-busy={loading || undefined}
            aria-describedby={messageId}
            className={cn(
              // Base — design-system.md §11.5 mandates 40px min height
              'flex h-10 w-full rounded-lg border bg-control-bg px-3 py-2 text-sm text-fg transition-colors duration-150',
              'placeholder:text-fg-subtle',
              'border-control-border hover:border-control-border-hover',
              // Focus-visible: border + 2px ring offset for clear visibility against any surface
              'focus-visible:outline-none focus-visible:border-control-border-focus focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas',
              // Invalid: danger border + ring, danger-tinted background subtly
              isInvalid &&
                'border-danger text-danger-text focus-visible:border-danger focus-visible:ring-danger',
              // Read-only: distinct from disabled, still legible, no hover affordance
              readOnly &&
                'cursor-default bg-surface-muted hover:border-control-border focus-visible:ring-0',
              // Disabled: token-driven surface, reduced opacity contained
              'disabled:cursor-not-allowed disabled:bg-control-bg-disabled disabled:text-fg-disabled disabled:border-control-border-disabled disabled:placeholder:text-fg-disabled',
              // Loading: leave room for the trailing spinner
              loading && 'pe-9',
              // Native file input styling — keep cohesive
              'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg',
              className
            )}
            {...props}
          />
          {loading && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2"
            >
              <span className="spinner" />
            </span>
          )}
        </div>
        {(errorText || helperText) && (
          <p
            id={messageId}
            className={cn('mt-1 text-xs', isInvalid ? 'text-danger-text' : 'text-fg-muted')}
          >
            {errorText || helperText}
          </p>
        )}
      </div>
    );
  }
);
Input.displayName = 'Input';

export { Input };
