'use client';

import { ReactNode } from 'react';
import { X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { cn } from '@/utils/cn';

export interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | ReactNode;
  children: ReactNode;
  contentClassName?: string;
}

export function ConfigDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  contentClassName,
}: ConfigDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className={cn(
          'sm:max-w-[600px] max-h-[90vh] overflow-y-auto bg-canvas border border-strong shadow-md',
          contentClassName
        )}
      >
        <button
          type="button"
          aria-label="Close dialog"
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <X className="h-5 w-5" />
        </button>
        <AlertDialogHeader className="pr-12">
          <AlertDialogTitle className="text-2xl font-semibold text-fg flex items-center gap-3">
            {title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="text-fg-muted mt-1">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <div className="mt-6">{children}</div>
        <AlertDialogFooter className="mt-8">
          <AlertDialogCancel onClick={() => onOpenChange(false)}>Close</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
