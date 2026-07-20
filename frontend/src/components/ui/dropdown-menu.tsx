'use client';

import * as React from 'react';
import { cn } from '@/utils/cn';

interface DropdownMenuContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const DropdownMenuContext = React.createContext<DropdownMenuContextType | null>(null);

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block text-start">{children}</div>
    </DropdownMenuContext.Provider>
  );
}

export function DropdownMenuTrigger({
  children,
  className,
  asChild = false,
}: {
  children: React.ReactNode;
  className?: string;
  asChild?: boolean;
}) {
  const context = React.useContext(DropdownMenuContext);
  if (!context) throw new Error('DropdownMenuTrigger must be used within DropdownMenu');

  const { open, setOpen } = context;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(!open);
  };

  if (asChild && React.isValidElement(children)) {
    const childProps = (children as React.ReactElement).props as any;
    return React.cloneElement(children as React.ReactElement<any>, {
      onClick: handleClick,
      className: cn(childProps.className, className),
    });
  }

  return (
    <button className={cn('flex items-center', className)} onClick={handleClick} type="button">
      {children}
    </button>
  );
}

export function DropdownMenuContent({
  children,
  align = 'right',
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  const context = React.useContext(DropdownMenuContext);
  if (!context) throw new Error('DropdownMenuContent must be used within DropdownMenu');

  const { open, setOpen } = context;
  const contentRef = React.useRef<HTMLDivElement>(null);

  // Handle outside clicks
  React.useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (contentRef.current && !contentRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div
      ref={contentRef}
      className={cn(
        'absolute z-50 mt-2 w-56 rounded-lg border border-border bg-surface-raised shadow-md animate-fade-in',
        align === 'right' ? 'end-0' : 'start-0',
        className
      )}
    >
      <div className="py-1" role="menu" aria-orientation="vertical">
        {children}
      </div>
    </div>
  );
}

export function DropdownMenuItem({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const context = React.useContext(DropdownMenuContext);
  const { setOpen } = context || {};

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Execute the onClick handler first
    if (onClick) {
      onClick();
    }

    // Close the dropdown immediately after action
    if (setOpen) {
      setOpen(false);
    }
  };

  return (
    <button
      className={cn(
        'flex w-full items-center px-4 py-2 text-sm text-fg hover:bg-surface-hover hover:text-fg transition-colors',
        className
      )}
      role="menuitem"
      onClick={handleClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn('my-1 h-px bg-surface-muted', className)} />;
}
