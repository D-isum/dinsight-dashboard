'use client';

import { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Activity, CheckCircle, Upload, Database, AlertCircle, X } from 'lucide-react';

export interface ProcessingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'uploading' | 'processing' | 'completed' | 'error';
  stage: 'baseline' | 'monitoring' | 'complete';
  title: string;
  description: string | ReactNode;
  errorMessage?: string;
  statusMessage?: string;
  progress?: number;
  onClose?: () => void;
  onRetry?: () => void;
  showActions?: boolean;
}

export function ProcessingDialog({
  open,
  onOpenChange,
  type,
  stage,
  title,
  description,
  errorMessage,
  statusMessage,
  progress,
  onClose,
  onRetry,
  showActions = false,
}: ProcessingDialogProps) {
  const getIcon = () => {
    switch (type) {
      case 'uploading':
        return <Upload className="w-8 h-8 text-info-text animate-pulse" />;
      case 'processing':
        return <Activity className="w-8 h-8 text-info-text animate-spin" />;
      case 'completed':
        return <CheckCircle className="w-8 h-8 text-success-text" />;
      case 'error':
        return <AlertCircle className="w-8 h-8 text-danger-text" />;
      default:
        return <Database className="w-8 h-8 text-fg-muted" />;
    }
  };

  const getSolidColors = () => {
    switch (stage) {
      case 'baseline':
        return 'bg-accent';
      case 'monitoring':
        return 'bg-info-600';
      case 'complete':
        return 'bg-success';
      default:
        return 'bg-fg-muted';
    }
  };

  const getProgressValue = () => {
    if (type === 'uploading') return 25;
    if (type === 'processing') {
      // Use real progress from backend (0-100)
      if (progress !== undefined && progress >= 0) {
        return progress;
      }
      // Fallback to indeterminate state
      return 0;
    }
    if (type === 'completed') return 100;
    return undefined;
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-[500px] bg-canvas border border-strong shadow-md">
        <AlertDialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div
                className={`w-12 h-12 ${getSolidColors()} rounded-lg flex items-center justify-center shadow-sm text-accent-contrast`}
              >
                {getIcon()}
              </div>
              <div>
                <AlertDialogTitle className="text-xl font-bold text-fg">{title}</AlertDialogTitle>
                <AlertDialogDescription className="text-fg-muted mt-1">
                  {description}
                </AlertDialogDescription>
              </div>
            </div>
            {(type === 'completed' || type === 'error') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onClose?.();
                  onOpenChange(false);
                }}
                className="h-8 w-8 p-0 hover:bg-surface-hover"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </AlertDialogHeader>

        <div className="mt-6 space-y-4">
          {/* Progress Section */}
          {(type === 'uploading' || type === 'processing') && (
            <div className="space-y-3">
              <Progress value={getProgressValue()} className="h-2" />

              {type === 'processing' && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm text-fg-muted">
                    <span className="flex-1">{statusMessage || 'Processing data...'}</span>
                    {progress !== undefined && progress >= 0 && (
                      <span className="font-mono text-accent ms-2">{progress}%</span>
                    )}
                  </div>
                  {progress === 0 && (
                    <div className="text-xs text-fg-subtle">
                      Initializing processing pipeline...
                    </div>
                  )}
                </div>
              )}

              {type === 'uploading' && (
                <div className="text-sm text-fg-muted">Uploading files to server...</div>
              )}
            </div>
          )}

          {/* Error Section */}
          {type === 'error' && errorMessage && (
            <div className="p-4 bg-danger-bg border border-danger-border rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-danger-text mt-0.5 flex-shrink-0" />
                <div className="text-sm text-danger-text">
                  <strong>Error:</strong> {errorMessage}
                </div>
              </div>
            </div>
          )}

          {/* Success Section */}
          {type === 'completed' && stage === 'complete' && (
            <div className="p-4 bg-success-bg border border-success-border rounded-lg">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-success-text" />
                <div className="text-sm text-success-text ">
                  Your data has been successfully processed and is ready for analysis!
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {showActions && type === 'completed' && stage === 'complete' && (
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border">
              <Button
                asChild
                className="flex-1 bg-accent hover:bg-accent-hover text-accent-contrast shadow-sm"
              >
                <a href="/dashboard/monitor?view=map">Open Live Monitor</a>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <a href="/dashboard/monitor?view=deterioration">Open Health Insights</a>
              </Button>
            </div>
          )}

          {/* Retry Button for Errors */}
          {type === 'error' && onRetry && (
            <div className="flex gap-3 pt-4 border-t border-border">
              <Button onClick={onRetry} className="flex-1">
                Try Again
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onClose?.();
                  onOpenChange(false);
                }}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          )}

          {/* Simple Close Button for Completed States */}
          {type === 'completed' && stage !== 'complete' && (
            <div className="flex justify-end pt-4 border-t border-border">
              <Button
                onClick={() => {
                  onClose?.();
                  onOpenChange(false);
                }}
              >
                Continue
              </Button>
            </div>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
