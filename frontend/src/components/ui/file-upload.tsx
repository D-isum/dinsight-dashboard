'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, File, X, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from './button';
import { ConfirmationDialog } from './confirmation-dialog';
import { cn } from '@/utils/cn';
import { formatBytes } from '@/utils/format';

export interface UploadedFile {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress?: number;
  error?: string;
}

interface FileUploadProps {
  accept?: string;
  maxSize?: number;
  maxFiles?: number;
  onFilesChange: (files: UploadedFile[]) => void;
  onUpload?: (files: File[]) => Promise<void>;
  className?: string;
  disabled?: boolean;
  uploadText?: string;
}

export function FileUpload({
  accept = '.csv',
  maxSize = 2.5 * 1024 * 1024 * 1024, // 2.5GB
  maxFiles = 10,
  onFilesChange,
  onUpload,
  className,
  disabled = false,
  uploadText = 'Upload Files',
}: FileUploadProps) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [fileToRemove, setFileToRemove] = useState<string | null>(null);

  // Notify parent component when files change
  useEffect(() => {
    onFilesChange(files);
  }, [files, onFilesChange]);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: any[]) => {
      const newFiles: UploadedFile[] = acceptedFiles.map((file) => ({
        file,
        id: Math.random().toString(36).substr(2, 9),
        status: 'pending' as const,
      }));

      setFiles((prev) => [...prev, ...newFiles].slice(0, maxFiles));

      // Handle rejected files
      if (rejectedFiles.length > 0) {
        console.warn('Some files were rejected:', rejectedFiles);
      }
    },
    [maxFiles]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.csv'],
    },
    maxSize,
    maxFiles,
    disabled: disabled || isUploading,
  });

  const removeFile = (id: string) => {
    setFileToRemove(id);
  };

  const confirmRemoveFile = () => {
    if (fileToRemove) {
      setFiles((prev) => prev.filter((f) => f.id !== fileToRemove));
      setFileToRemove(null);
    }
  };

  const handleUpload = async () => {
    if (!onUpload || files.length === 0) return;

    setIsUploading(true);
    const filesToUpload = files.filter((f) => f.status === 'pending').map((f) => f.file);

    try {
      // Update files to uploading status
      setFiles((prev) =>
        prev.map((f) => (f.status === 'pending' ? { ...f, status: 'uploading' } : f))
      );

      await onUpload(filesToUpload);

      // Update files to success status
      setFiles((prev) =>
        prev.map((f) => (f.status === 'uploading' ? { ...f, status: 'success' } : f))
      );
    } catch (error) {
      // Update files to error status
      setFiles((prev) =>
        prev.map((f) =>
          f.status === 'uploading' ? { ...f, status: 'error', error: (error as Error).message } : f
        )
      );
    } finally {
      setIsUploading(false);
    }
  };

  const clearAll = () => {
    setShowClearAllDialog(true);
  };

  const confirmClearAll = () => {
    setFiles([]);
  };

  const getStatusIcon = (status: UploadedFile['status']) => {
    switch (status) {
      case 'pending':
        return <File className="h-4 w-4 text-fg-subtle" />;
      case 'uploading':
        return <Upload className="h-4 w-4 text-info-text animate-pulse" />;
      case 'success':
        return <CheckCircle className="h-4 w-4 text-success-text" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-danger-text" />;
      default:
        return <File className="h-4 w-4 text-fg-subtle" />;
    }
  };

  const getStatusColor = (status: UploadedFile['status']) => {
    switch (status) {
      case 'success':
        return 'text-success-text bg-success-bg border-success-border';
      case 'error':
        return 'text-danger-text bg-danger-bg border-danger-border';
      case 'uploading':
        return 'text-info-text bg-info-bg border-info-border';
      default:
        return 'text-fg-muted bg-surface-muted border-border';
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={cn(
          'relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors duration-200',
          isDragActive ? 'border-strong bg-surface-selected' : 'border-strong hover:border-strong',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <input {...getInputProps()} />
        <Upload
          className={cn('mx-auto h-12 w-12 mb-4', isDragActive ? 'text-accent' : 'text-fg-subtle')}
        />
        {isDragActive ? (
          <div>
            <p className="text-lg font-medium text-accent">Drop the files here...</p>
            <p className="text-sm text-accent">Ready to upload your CSV files</p>
          </div>
        ) : (
          <div>
            <p className="text-lg font-medium text-fg">
              Drag & drop CSV files here, or click to browse
            </p>
            <p className="text-sm text-fg-muted mt-2">
              Maximum file size: {formatBytes(maxSize)} • Maximum {maxFiles} files
            </p>
            <p className="text-sm text-fg-muted">Supported formats: CSV</p>
          </div>
        )}
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-fg">Uploaded Files ({files.length})</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={clearAll}>
                Clear All
              </Button>
              {onUpload && files.some((f) => f.status === 'pending') && (
                <Button
                  onClick={handleUpload}
                  disabled={isUploading}
                  size="sm"
                  className="min-w-[100px]"
                >
                  {isUploading ? (
                    <>
                      <Upload className="h-4 w-4 me-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 me-2" />
                      {uploadText}
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {files.map((uploadedFile) => (
              <div
                key={uploadedFile.id}
                className={cn(
                  'flex items-center justify-between p-3 rounded-lg border',
                  getStatusColor(uploadedFile.status)
                )}
              >
                <div className="flex items-center gap-x-3 flex-1 min-w-0">
                  {getStatusIcon(uploadedFile.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{uploadedFile.file.name}</p>
                    <p className="text-xs text-fg-muted">
                      {formatBytes(uploadedFile.file.size)} • {uploadedFile.file.type || 'CSV'}
                    </p>
                    {uploadedFile.error && (
                      <p className="text-xs text-danger-text mt-1">{uploadedFile.error}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-x-2">
                  <span
                    className={cn(
                      'inline-flex px-2 py-1 text-xs font-medium rounded-full',
                      uploadedFile.status === 'success' && 'bg-success-bg text-success-text',
                      uploadedFile.status === 'error' && 'bg-danger-bg text-danger-text',
                      uploadedFile.status === 'uploading' && 'bg-info-bg text-info-text',
                      uploadedFile.status === 'pending' &&
                        'bg-surface-muted dark:bg-surface-muted text-fg'
                    )}
                  >
                    {uploadedFile.status === 'success' && 'Uploaded'}
                    {uploadedFile.status === 'error' && 'Failed'}
                    {uploadedFile.status === 'uploading' && 'Uploading...'}
                    {uploadedFile.status === 'pending' && 'Ready'}
                  </span>
                  {uploadedFile.status !== 'uploading' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => removeFile(uploadedFile.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation Dialogs */}
      <ConfirmationDialog
        open={showClearAllDialog}
        onOpenChange={setShowClearAllDialog}
        title="Clear All Files"
        description="Are you sure you want to remove all uploaded files? This action cannot be undone."
        confirmText="Clear All"
        cancelText="Keep Files"
        variant="destructive"
        onConfirm={confirmClearAll}
      />

      <ConfirmationDialog
        open={!!fileToRemove}
        onOpenChange={(open) => !open && setFileToRemove(null)}
        title="Remove File"
        description="Are you sure you want to remove this file from the upload list?"
        confirmText="Remove"
        cancelText="Keep File"
        variant="destructive"
        onConfirm={confirmRemoveFile}
      />
    </div>
  );
}
