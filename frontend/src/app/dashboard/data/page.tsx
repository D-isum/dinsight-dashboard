'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Database, Download, Loader2, Upload } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfigDialog } from '@/components/ui/config-dialog';
import { ProcessingDialog } from '@/components/ui/processing-dialog';
import { DatasetSourceSelect } from '@/components/datasets/dataset-source-select';
import { useBaselineMonitoringData } from '@/hooks/useBaselineMonitoringData';
import { useDatasetDiscovery } from '@/hooks/useDatasetDiscovery';
import { useDatasetSourceFilter } from '@/hooks/useDatasetSourceFilter';
import { useUploadWorkflow } from '@/hooks/useUploadWorkflow';
import { api } from '@/lib/api-client';
import { formatDatasetOptionLabel, getDatasetSourceGroupKey } from '@/lib/dataset-source-groups';

import { PlotCanvas as Plot } from '@/components/charts/plot-canvas';

type ProcessingConfig = {
  id?: number;
  optimizer: string;
  alpha: number;
  gamma0: number;
  end_meta: string;
  start_dim: string;
  end_dim: string;
};

type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  headers: string[];
  previewRows: number;
  fileSizeMb: number;
};

const DEFAULT_CONFIG: ProcessingConfig = {
  optimizer: 'adam',
  alpha: 0.1,
  gamma0: 1e-7,
  end_meta: 'participant',
  start_dim: 'f_0',
  end_dim: 'f_1023',
};

const MAX_FILE_BYTES = 250 * 1024 * 1024;

// Sorts datasets newest-first by the upload's created_at timestamp.
// Falls back to dinsight_id (DESC) when timestamps tie or are
// missing — works for legacy rows the new join doesn't populate.
function sortByCreatedAtDesc(
  a: { source: { createdAt?: string }; dinsight_id: number },
  b: { source: { createdAt?: string }; dinsight_id: number }
): number {
  const at = a.source.createdAt ? Date.parse(a.source.createdAt) : NaN;
  const bt = b.source.createdAt ? Date.parse(b.source.createdAt) : NaN;
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) {
    return bt - at;
  }
  if (Number.isFinite(at) && !Number.isFinite(bt)) return -1;
  if (!Number.isFinite(at) && Number.isFinite(bt)) return 1;
  return b.dinsight_id - a.dinsight_id;
}

export default function DataIngestionPage() {
  const { state, uploadBaseline, uploadMonitoring, resetWorkflow } = useUploadWorkflow();
  const { datasets, refetch } = useDatasetDiscovery({
    queryKey: ['available-dinsight-ids'],
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
  const {
    groups: datasetSourceGroups,
    selectedSourceKey,
    setSelectedSourceKey,
    filteredDatasets: sourceFilteredDatasets,
    filteredDatasetIds,
    latestFilteredDatasetId,
  } = useDatasetSourceFilter(datasets);

  const [baselineFile, setBaselineFile] = useState<File | null>(null);
  const [monitoringFile, setMonitoringFile] = useState<File | null>(null);
  const [baselineValidation, setBaselineValidation] = useState<ValidationResult | null>(null);
  const [monitoringValidation, setMonitoringValidation] = useState<ValidationResult | null>(null);
  const [validatingBaseline, setValidatingBaseline] = useState(false);
  const [validatingMonitoring, setValidatingMonitoring] = useState(false);

  const [manualBaselineId, setManualBaselineId] = useState('');
  const [useManualBaselineId, setUseManualBaselineId] = useState(false);
  const [selectedBaselineDatasetId, setSelectedBaselineDatasetId] = useState<number | null>(null);
  const [datasetSearch, setDatasetSearch] = useState('');
  const [manualBaselineError, setManualBaselineError] = useState<string | null>(null);
  const [exportingDatasetId, setExportingDatasetId] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
  const [editedConfig, setEditedConfig] = useState<ProcessingConfig | null>(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const [showProcessingDialog, setShowProcessingDialog] = useState(false);
  const [isResultsModalOpen, setIsResultsModalOpen] = useState(false);
  const [previewMode, setPreviewMode] = useState<'latest' | 'saved'>('latest');
  const [savedPreviewId, setSavedPreviewId] = useState<number | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [lastAutoOpenedPreviewId, setLastAutoOpenedPreviewId] = useState<number | null>(null);
  const lastSourceSyncedWorkflowIdRef = useRef<number | null>(null);

  const {
    data: config,
    isLoading: isConfigLoading,
    refetch: refetchConfig,
  } = useQuery({
    queryKey: ['processing-config'],
    queryFn: async () => {
      const response = await api.analysis.getConfig();
      const payload = response?.data?.data;
      if (!payload) {
        return DEFAULT_CONFIG;
      }

      return {
        optimizer: payload.optimizer ?? DEFAULT_CONFIG.optimizer,
        alpha:
          typeof payload.alpha === 'number'
            ? payload.alpha
            : Number.parseFloat(String(payload.alpha ?? DEFAULT_CONFIG.alpha)),
        gamma0:
          typeof payload.gamma0 === 'number'
            ? payload.gamma0
            : Number.parseFloat(String(payload.gamma0 ?? DEFAULT_CONFIG.gamma0)),
        end_meta: payload.end_meta ?? DEFAULT_CONFIG.end_meta,
        start_dim: payload.start_dim ?? DEFAULT_CONFIG.start_dim,
        end_dim: payload.end_dim ?? DEFAULT_CONFIG.end_dim,
      } as ProcessingConfig;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const isPendingWorkflowDataset =
      selectedBaselineDatasetId === state.dinsightId &&
      !datasets.some((dataset) => dataset.dinsight_id === state.dinsightId);
    if (
      selectedBaselineDatasetId == null ||
      (!filteredDatasetIds.includes(selectedBaselineDatasetId) && !isPendingWorkflowDataset)
    ) {
      setSelectedBaselineDatasetId(latestFilteredDatasetId);
    }
  }, [
    datasets,
    filteredDatasetIds,
    latestFilteredDatasetId,
    selectedBaselineDatasetId,
    state.dinsightId,
  ]);

  useEffect(() => {
    if (savedPreviewId == null || !filteredDatasetIds.includes(savedPreviewId)) {
      setSavedPreviewId(latestFilteredDatasetId);
    }
  }, [filteredDatasetIds, latestFilteredDatasetId, savedPreviewId]);

  useEffect(() => {
    if (state.dinsightId && lastSourceSyncedWorkflowIdRef.current !== state.dinsightId) {
      const uploadedDataset = datasets.find((dataset) => dataset.dinsight_id === state.dinsightId);
      if (uploadedDataset) {
        setSelectedSourceKey(getDatasetSourceGroupKey(uploadedDataset));
        lastSourceSyncedWorkflowIdRef.current = state.dinsightId;
      }
      setManualBaselineId(String(state.dinsightId));
      setSelectedBaselineDatasetId(state.dinsightId);
      setManualBaselineError(null);
      setUseManualBaselineId(false);
    }
  }, [datasets, setSelectedSourceKey, state.dinsightId]);

  // Sort mode for the picker. Newest first matches "what did I just
  // upload?"; oldest first is occasionally useful when scrolling
  // back through history.
  const [datasetSort, setDatasetSort] = useState<'newest' | 'oldest' | 'id-asc'>('newest');

  const filteredDatasets = useMemo(() => {
    let working = sourceFilteredDatasets;
    if (datasetSearch.trim()) {
      const query = datasetSearch.toLowerCase();
      working = working.filter((dataset) => {
        return (
          String(dataset.dinsight_id).includes(query) ||
          dataset.name.toLowerCase().includes(query) ||
          dataset.source.originalFileName?.toLowerCase().includes(query) ||
          dataset.source.deviceName?.toLowerCase().includes(query) ||
          dataset.source.deviceSlug?.toLowerCase().includes(query)
        );
      });
    }
    const sorted = [...working];
    if (datasetSort === 'newest') {
      sorted.sort((a, b) => sortByCreatedAtDesc(a, b));
    } else if (datasetSort === 'oldest') {
      sorted.sort((a, b) => -sortByCreatedAtDesc(a, b));
    } else {
      sorted.sort((a, b) => a.dinsight_id - b.dinsight_id);
    }
    return sorted;
  }, [datasetSearch, datasetSort, sourceFilteredDatasets]);

  const selectedDatasetMeta = useMemo(() => {
    return datasets.find((dataset) => dataset.dinsight_id === selectedBaselineDatasetId) ?? null;
  }, [datasets, selectedBaselineDatasetId]);

  const suggestedBaselineId = useMemo(() => {
    if (state.dinsightId) {
      const workflowDatasetIsKnown = datasets.some(
        (dataset) => dataset.dinsight_id === state.dinsightId
      );
      if (!workflowDatasetIsKnown || filteredDatasetIds.includes(state.dinsightId)) {
        return state.dinsightId;
      }
    }

    if (useManualBaselineId) {
      const parsed = Number(manualBaselineId.trim());
      return Number.isFinite(parsed) && parsed > 0 && filteredDatasetIds.includes(parsed)
        ? parsed
        : null;
    }

    if (selectedBaselineDatasetId) {
      return selectedBaselineDatasetId;
    }

    return latestFilteredDatasetId;
  }, [
    filteredDatasetIds,
    datasets,
    latestFilteredDatasetId,
    manualBaselineId,
    selectedBaselineDatasetId,
    state.dinsightId,
    useManualBaselineId,
  ]);

  const runValidation = async (file: File): Promise<ValidationResult> => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!file.name.toLowerCase().endsWith('.csv')) {
      errors.push('File must have a .csv extension.');
    }

    if (file.size <= 0) {
      errors.push('File is empty.');
    }

    if (file.size > MAX_FILE_BYTES) {
      errors.push(`File exceeds ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB limit.`);
    }

    let headers: string[] = [];
    let previewRows = 0;

    try {
      const normalizeText = (raw: string) =>
        raw
          .replace(/\u0000/g, '')
          .replace(/^\uFEFF/, '')
          .replace(/\r\n|\r/g, '\n');

      const decodeChunk = async (size: number) => {
        const buffer = await file.slice(0, Math.min(size, file.size)).arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // Handle BOM for UTF-16 exports that frequently fail naive .text() parsing.
        if (bytes.length >= 2) {
          const bomLE = bytes[0] === 0xff && bytes[1] === 0xfe;
          const bomBE = bytes[0] === 0xfe && bytes[1] === 0xff;
          if (bomLE || bomBE) {
            const decoded = new TextDecoder(bomLE ? 'utf-16le' : 'utf-16be').decode(bytes);
            return normalizeText(decoded);
          }
        }

        return normalizeText(new TextDecoder('utf-8').decode(bytes));
      };

      const toLines = (text: string) =>
        text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

      let preview = await decodeChunk(64 * 1024);
      let lines = toLines(preview);

      // Fallback: some exports use long lines or uncommon formatting near file start.
      if (lines.length < 2) {
        preview = await decodeChunk(512 * 1024);
        lines = toLines(preview);
      }

      if (lines.length < 2 && file.size <= 5 * 1024 * 1024) {
        preview = await decodeChunk(file.size);
        lines = toLines(preview);
      }

      if (lines.length < 2) {
        errors.push('CSV must contain a header row and at least one data row.');
      } else {
        const headerLine = lines[0];

        // Pick the most likely delimiter from common CSV variants.
        const delimiters = [',', ';', '\t', '|'];
        const delimiter = delimiters.reduce((best, candidate) => {
          const count = headerLine.split(candidate).length;
          return count > headerLine.split(best).length ? candidate : best;
        }, ',');

        if (headerLine.split(delimiter).length < 2) {
          errors.push('CSV header appears invalid (no recognizable column separators).');
        }

        headers = headerLine
          .split(delimiter)
          .map((item) => item.trim())
          .filter(Boolean);

        if (headers.length < 2) {
          errors.push('CSV should contain at least two columns.');
        }

        const activeConfig = config ?? DEFAULT_CONFIG;
        const requiredConfigColumns = [
          activeConfig.end_meta,
          activeConfig.start_dim,
          activeConfig.end_dim,
        ].filter((value) => typeof value === 'string' && value.trim().length > 0);

        if (requiredConfigColumns.length > 0) {
          const headerSet = new Set(headers);
          const lowerHeaderSet = new Set(headers.map((header) => header.toLowerCase()));

          const missingConfigColumns = requiredConfigColumns.filter(
            (requiredColumn) => !headerSet.has(requiredColumn)
          );

          if (missingConfigColumns.length > 0) {
            const missingIgnoringCase = missingConfigColumns.filter(
              (requiredColumn) => !lowerHeaderSet.has(requiredColumn.toLowerCase())
            );

            if (missingIgnoringCase.length > 0) {
              errors.push(
                `Missing required config column(s): ${missingIgnoringCase.join(', ')}. ` +
                  'Update the configuration set or upload a file with matching columns.'
              );
            }

            const caseMismatchOnly = missingConfigColumns.filter((requiredColumn) =>
              lowerHeaderSet.has(requiredColumn.toLowerCase())
            );
            if (caseMismatchOnly.length > 0) {
              warnings.push(
                `Column name case differs from config for: ${caseMismatchOnly.join(', ')}.`
              );
            }
          }
        }

        if (headers.length > 1200) {
          warnings.push('Very high column count detected. Processing may take longer.');
        }

        previewRows = Math.max(0, lines.length - 1);
      }
    } catch {
      errors.push('Unable to read file preview for validation.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      headers,
      previewRows,
      fileSizeMb: Number((file.size / (1024 * 1024)).toFixed(2)),
    };
  };

  const onBaselineFileChange = async (file: File | null) => {
    setBaselineFile(file);
    setBaselineValidation(null);

    if (!file) {
      return;
    }

    setValidatingBaseline(true);
    const result = await runValidation(file);
    setBaselineValidation(result);
    setValidatingBaseline(false);
  };

  const onMonitoringFileChange = async (file: File | null) => {
    setMonitoringFile(file);
    setMonitoringValidation(null);

    if (!file) {
      return;
    }

    setValidatingMonitoring(true);
    const result = await runValidation(file);
    setMonitoringValidation(result);
    setValidatingMonitoring(false);
  };

  const onBaselineUpload = async () => {
    if (!baselineFile || !baselineValidation?.valid) {
      return;
    }
    await uploadBaseline([baselineFile]);
  };

  const onMonitoringUpload = async () => {
    if (!monitoringFile || !monitoringValidation?.valid) {
      return;
    }

    if (!suggestedBaselineId) {
      setManualBaselineError('Provide a valid baseline ID before uploading monitoring data.');
      return;
    }

    setManualBaselineError(null);
    await uploadMonitoring(suggestedBaselineId, monitoringFile);
  };

  const onExportSelectedDataset = async () => {
    if (!suggestedBaselineId) {
      setExportError('Select a valid DInsight ID before exporting.');
      return;
    }

    setExportError(null);
    setExportingDatasetId(suggestedBaselineId);

    try {
      const response = await api.analysis.exportDinsight(suggestedBaselineId);
      const blob =
        response.data instanceof Blob
          ? response.data
          : new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const disposition = String(response.headers['content-disposition'] ?? '');
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename =
        filenameMatch?.[1] ?? `dinsight-${suggestedBaselineId}-baseline-and-monitoring.csv`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      let message = 'Unable to export the selected processed dataset.';
      const payload = error?.response?.data;
      if (payload instanceof Blob) {
        try {
          const parsed = JSON.parse(await payload.text());
          message = parsed?.error ?? parsed?.message ?? message;
        } catch {
          // Keep the generic message for non-JSON error responses.
        }
      } else {
        message = payload?.error ?? payload?.message ?? message;
      }
      setExportError(message);
    } finally {
      setExportingDatasetId(null);
    }
  };

  const baselineReady = state.step === 'monitoring' || state.step === 'complete';
  const monitoringComplete = state.step === 'complete' && state.status === 'completed';
  const isActiveProcessing = state.status === 'uploading' || state.status === 'processing';
  const workflowDatasetIsKnown = datasets.some(
    (dataset) => dataset.dinsight_id === state.dinsightId
  );
  const latestProcessedPreviewId =
    state.dinsightId && (!workflowDatasetIsKnown || filteredDatasetIds.includes(state.dinsightId))
      ? state.dinsightId
      : latestFilteredDatasetId;
  const previewDatasetId = previewMode === 'latest' ? latestProcessedPreviewId : savedPreviewId;

  const {
    baselineData: previewBaselineData,
    monitoringData: previewMonitoringData,
    isLoadingBaseline: isPreviewLoadingBaseline,
    isLoadingMonitoring: isPreviewLoadingMonitoring,
    baselineError: previewBaselineError,
    monitoringError: previewMonitoringError,
  } = useBaselineMonitoringData({
    dinsightId: isResultsModalOpen ? previewDatasetId : null,
    includeMetadata: false,
    monitoringMode: 'rows',
    refreshKey: previewRefreshKey,
  });

  useEffect(() => {
    if (state.status === 'idle') {
      setShowProcessingDialog(false);
      return;
    }

    setShowProcessingDialog(true);
  }, [state.status]);

  useEffect(() => {
    if (!monitoringComplete || !latestProcessedPreviewId) {
      return;
    }

    if (lastAutoOpenedPreviewId === latestProcessedPreviewId) {
      return;
    }

    setPreviewMode('latest');
    setIsResultsModalOpen(true);
    setPreviewRefreshKey((prev) => prev + 1);
    setLastAutoOpenedPreviewId(latestProcessedPreviewId);
  }, [lastAutoOpenedPreviewId, latestProcessedPreviewId, monitoringComplete]);

  const onEditConfig = () => {
    setEditedConfig({ ...(config ?? DEFAULT_CONFIG) });
    setIsConfigDialogOpen(true);
    setConfigError(null);
  };

  const onRestoreDefaultConfig = () => {
    setEditedConfig({ ...DEFAULT_CONFIG });
    setConfigError(null);
  };

  const onSaveConfig = async () => {
    if (!editedConfig) {
      return;
    }

    if (!Number.isFinite(editedConfig.alpha) || !Number.isFinite(editedConfig.gamma0)) {
      setConfigError('Alpha and gamma0 must be valid numbers.');
      return;
    }

    setIsSavingConfig(true);
    setConfigError(null);
    try {
      await api.analysis.updateConfig(editedConfig);
      await refetchConfig();
      setIsConfigDialogOpen(false);
    } catch (error: any) {
      setConfigError(error?.response?.data?.message || 'Failed to save configuration set.');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const processingDialogType =
    state.status === 'error'
      ? 'error'
      : state.status === 'completed'
        ? 'completed'
        : state.status === 'uploading'
          ? 'uploading'
          : 'processing';

  const processingDialogStage: 'baseline' | 'monitoring' | 'complete' =
    state.step === 'complete'
      ? 'complete'
      : state.status === 'completed' && state.step === 'monitoring'
        ? 'baseline'
        : state.step;

  const processingDialogTitle =
    state.status === 'uploading'
      ? state.step === 'baseline'
        ? 'Uploading baseline data'
        : 'Uploading monitoring data'
      : state.status === 'processing'
        ? state.step === 'baseline'
          ? 'Processing baseline data'
          : 'Processing monitoring data'
        : state.status === 'completed'
          ? state.step === 'complete'
            ? 'Monitoring processing complete'
            : 'Baseline processing complete'
          : state.step === 'monitoring'
            ? 'Monitoring processing failed'
            : 'Baseline processing failed';

  const processingDialogDescription =
    state.status === 'completed'
      ? state.step === 'complete'
        ? 'Monitoring data is ready. You can continue to live monitoring.'
        : 'Baseline data is ready. Continue with monitoring upload.'
      : state.status === 'error'
        ? 'Review the error details below and retry when ready.'
        : 'Please wait while we process your files. This can take a few minutes for large datasets.';
  const previewPlot = useMemo(() => {
    if (!previewBaselineData || previewBaselineData.dinsight_x.length === 0) {
      return null;
    }

    const traces: any[] = [
      {
        x: previewBaselineData.dinsight_x,
        y: previewBaselineData.dinsight_y,
        type: 'scattergl',
        mode: 'markers',
        name: 'Baseline',
        marker: { color: '#2563EB', size: 6, opacity: 0.45 },
        hovertemplate: 'Baseline<br>X: %{x:.4f}<br>Y: %{y:.4f}<extra></extra>',
      },
    ];

    if (previewMonitoringData && previewMonitoringData.dinsight_x.length > 0) {
      traces.push({
        x: previewMonitoringData.dinsight_x,
        y: previewMonitoringData.dinsight_y,
        type: 'scattergl',
        mode: 'markers',
        name: 'Monitoring',
        marker: { color: '#DC2626', size: 6, opacity: 0.65 },
        hovertemplate: 'Monitoring<br>X: %{x:.4f}<br>Y: %{y:.4f}<extra></extra>',
      });
    }

    return {
      data: traces,
      layout: {
        template: 'plotly_white',
        autosize: true,
        margin: { t: 18, r: 20, b: 50, l: 55 },
        xaxis: { title: 'DInsight X' },
        yaxis: { title: 'DInsight Y' },
        legend: {
          orientation: 'h',
          yanchor: 'bottom',
          y: 1.02,
          xanchor: 'right',
          x: 1,
        },
      } as any,
      config: { responsive: true, displayModeBar: false },
    };
  }, [previewBaselineData, previewMonitoringData]);

  return (
    <div className="space-y-6">
      <ProcessingDialog
        open={showProcessingDialog}
        onOpenChange={(open) => {
          if (isActiveProcessing) {
            setShowProcessingDialog(true);
            return;
          }
          setShowProcessingDialog(open);
        }}
        type={processingDialogType}
        stage={processingDialogStage}
        title={processingDialogTitle}
        description={processingDialogDescription}
        errorMessage={state.errorMessage}
        statusMessage={state.statusMessage}
        progress={
          typeof state.progress === 'number' ? Math.max(0, Math.min(100, state.progress)) : 0
        }
        onClose={() => setShowProcessingDialog(false)}
      />

      <ConfigDialog
        open={isConfigDialogOpen}
        onOpenChange={(open) => {
          setIsConfigDialogOpen(open);
          if (!open) {
            setConfigError(null);
          }
        }}
        title="Update Configuration Set"
        description="Adjust processing parameters, then save to apply on new uploads."
      >
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Optimizer</label>
              <select
                value={editedConfig?.optimizer ?? DEFAULT_CONFIG.optimizer}
                onChange={(event) =>
                  setEditedConfig((prev) =>
                    prev
                      ? {
                          ...prev,
                          optimizer: event.target.value,
                        }
                      : prev
                  )
                }
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="adam">adam</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Alpha</label>
              <Input
                type="number"
                step="0.0001"
                value={editedConfig?.alpha ?? DEFAULT_CONFIG.alpha}
                onChange={(event) =>
                  setEditedConfig((prev) =>
                    prev
                      ? {
                          ...prev,
                          alpha: Number.parseFloat(event.target.value),
                        }
                      : prev
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Gamma0</label>
              <Input
                type="number"
                step="0.0000001"
                value={editedConfig?.gamma0 ?? DEFAULT_CONFIG.gamma0}
                onChange={(event) =>
                  setEditedConfig((prev) =>
                    prev
                      ? {
                          ...prev,
                          gamma0: Number.parseFloat(event.target.value),
                        }
                      : prev
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">End metadata column</label>
              <Input
                value={editedConfig?.end_meta ?? DEFAULT_CONFIG.end_meta}
                onChange={(event) =>
                  setEditedConfig((prev) =>
                    prev
                      ? {
                          ...prev,
                          end_meta: event.target.value,
                        }
                      : prev
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Start feature column</label>
              <Input
                value={editedConfig?.start_dim ?? DEFAULT_CONFIG.start_dim}
                onChange={(event) =>
                  setEditedConfig((prev) =>
                    prev
                      ? {
                          ...prev,
                          start_dim: event.target.value,
                        }
                      : prev
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">End feature column</label>
              <Input
                value={editedConfig?.end_dim ?? DEFAULT_CONFIG.end_dim}
                onChange={(event) =>
                  setEditedConfig((prev) =>
                    prev
                      ? {
                          ...prev,
                          end_dim: event.target.value,
                        }
                      : prev
                  )
                }
              />
            </div>
          </div>

          {configError && <p className="text-sm text-danger-text">{configError}</p>}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void onSaveConfig()} disabled={isSavingConfig}>
              {isSavingConfig ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save configuration set'
              )}
            </Button>
            <Button variant="outline" onClick={onRestoreDefaultConfig} disabled={isSavingConfig}>
              Restore defaults
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsConfigDialogOpen(false);
                setConfigError(null);
              }}
              disabled={isSavingConfig}
            >
              Cancel
            </Button>
          </div>
        </div>
      </ConfigDialog>

      <ConfigDialog
        open={isResultsModalOpen}
        onOpenChange={(open) => {
          setIsResultsModalOpen(open);
          if (open) {
            setPreviewRefreshKey((prev) => prev + 1);
          }
        }}
        title="Results Visualization"
        description="Visualize latest processed output or load a saved dataset from the database."
        contentClassName="w-[92vw] sm:max-w-[900px]"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={previewMode === 'latest'}
                onChange={() => setPreviewMode('latest')}
              />
              Latest processed
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={previewMode === 'saved'}
                onChange={() => setPreviewMode('saved')}
              />
              Saved result
            </label>
            {previewMode === 'saved' && (
              <select
                value={savedPreviewId != null ? String(savedPreviewId) : ''}
                onChange={(event) =>
                  setSavedPreviewId(event.target.value ? Number(event.target.value) : null)
                }
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">Select saved dataset</option>
                {sourceFilteredDatasets.map((dataset) => (
                  <option key={dataset.dinsight_id} value={dataset.dinsight_id}>
                    {formatDatasetOptionLabel(dataset)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>Dataset ID: {previewDatasetId ?? 'None selected'}</span>
            <span>Baseline points: {previewBaselineData?.dinsight_x.length ?? 0}</span>
            <span>Monitoring points: {previewMonitoringData?.dinsight_x.length ?? 0}</span>
          </div>

          {previewDatasetId == null ? (
            <p className="text-sm text-muted-foreground">Select a dataset to visualize.</p>
          ) : isPreviewLoadingBaseline || isPreviewLoadingMonitoring ? (
            <p className="text-sm text-muted-foreground">Loading visualization...</p>
          ) : previewBaselineError ? (
            <p className="text-sm text-danger-text">{previewBaselineError}</p>
          ) : previewPlot ? (
            <>
              <div className="mx-auto aspect-square w-full max-w-[820px] max-h-[75vh]">
                <Plot
                  data={previewPlot.data as any}
                  layout={previewPlot.layout as any}
                  config={previewPlot.config as any}
                  useResizeHandler
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
              {previewMonitoringError && (
                <p className="text-xs text-muted-foreground">{previewMonitoringError}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/dashboard/live">
                    Open in Live
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/dashboard/insights">Open in Insights</Link>
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No baseline visualization available for this dataset yet.
            </p>
          )}
        </div>
      </ConfigDialog>

      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-fg">Data Ingestion</h1>
            <p className="text-sm text-fg-muted">
              Upload baseline and monitoring datasets, then browse the catalog for lineage and
              validation history.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/dashboard/data/catalog">
              <Database className="mr-2 h-4 w-4" />
              View catalog
            </Link>
          </Button>
        </div>

        <div className="space-y-6">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="text-lg">Configuration Set</CardTitle>
              <CardDescription>Processing parameters for new uploads.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {isConfigLoading ? (
                <p className="text-sm text-muted-foreground">Loading configuration set...</p>
              ) : (
                <div className="space-y-3 rounded-md border border-input p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-full bg-success-bg px-2 py-0.5 text-success-text">
                      Active
                    </span>
                    <span className="text-muted-foreground">
                      Optimizer: <strong>{config?.optimizer ?? DEFAULT_CONFIG.optimizer}</strong>
                    </span>
                    <span className="text-muted-foreground">
                      Alpha: <strong>{config?.alpha ?? DEFAULT_CONFIG.alpha}</strong>
                    </span>
                    <span className="text-muted-foreground">
                      Gamma0: <strong>{config?.gamma0 ?? DEFAULT_CONFIG.gamma0}</strong>
                    </span>
                  </div>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <div className="rounded-md border border-input bg-muted/20 p-2">
                      End metadata: <strong>{config?.end_meta ?? DEFAULT_CONFIG.end_meta}</strong>
                    </div>
                    <div className="rounded-md border border-input bg-muted/20 p-2">
                      Start feature:{' '}
                      <strong>{config?.start_dim ?? DEFAULT_CONFIG.start_dim}</strong>
                    </div>
                    <div className="rounded-md border border-input bg-muted/20 p-2">
                      End feature: <strong>{config?.end_dim ?? DEFAULT_CONFIG.end_dim}</strong>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={onEditConfig}>
                    Update configuration
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  {baselineReady ? (
                    <CheckCircle2 className="h-5 w-5 text-success-text" />
                  ) : (
                    <Upload className="h-5 w-5" />
                  )}
                  1. Upload Baseline
                </CardTitle>
                <CardDescription>
                  Upload the baseline CSV that represents healthy machine behavior.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex h-full flex-col space-y-4">
                <Input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={state.status === 'uploading' || state.status === 'processing'}
                  onChange={(event) => void onBaselineFileChange(event.target.files?.[0] ?? null)}
                />

                <div className="rounded-md border border-input bg-muted/20 p-3 text-xs text-muted-foreground">
                  Selected file:{' '}
                  <span className="font-medium text-foreground">
                    {baselineFile?.name ?? 'None'}
                  </span>
                </div>

                {(validatingBaseline || baselineValidation) && (
                  <div className="rounded-md border border-input p-3 text-xs">
                    {validatingBaseline ? (
                      <p className="text-muted-foreground">Validating baseline file...</p>
                    ) : (
                      <div className="space-y-2">
                        <p>
                          <strong>Size:</strong> {baselineValidation?.fileSizeMb} MB |{' '}
                          <strong>Preview rows:</strong> {baselineValidation?.previewRows}
                        </p>
                        {baselineValidation?.headers.length ? (
                          <p className="truncate">
                            <strong>Headers:</strong>{' '}
                            {baselineValidation.headers.slice(0, 6).join(', ')}
                          </p>
                        ) : null}
                        {baselineValidation?.warnings.map((warning) => (
                          <p key={warning} className="text-warning-text">
                            {warning}
                          </p>
                        ))}
                        {baselineValidation?.errors.map((error) => (
                          <p key={error} className="text-danger-text">
                            {error}
                          </p>
                        ))}
                        {baselineValidation?.valid && (
                          <p className="text-success-text">Baseline file validation passed.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-auto border-t border-border pt-3">
                  <Button
                    onClick={() => void onBaselineUpload()}
                    disabled={
                      !baselineFile ||
                      !baselineValidation?.valid ||
                      state.status === 'uploading' ||
                      state.status === 'processing' ||
                      baselineReady
                    }
                    className="w-full"
                  >
                    {state.status === 'uploading' || state.status === 'processing' ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing baseline...
                      </>
                    ) : (
                      'Upload baseline CSV'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  {monitoringComplete ? (
                    <CheckCircle2 className="h-5 w-5 text-success-text" />
                  ) : (
                    <Upload className="h-5 w-5" />
                  )}
                  2. Upload Monitoring
                </CardTitle>
                <CardDescription>
                  Select baseline target, then upload monitoring CSV for comparison.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex h-full flex-col space-y-4">
                <div className="space-y-3 rounded-md border border-input p-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Baseline target</label>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setUseManualBaselineId((prev) => !prev)}
                    >
                      {useManualBaselineId ? 'Use dataset selector' : 'Manual ID'}
                    </Button>
                  </div>

                  {useManualBaselineId ? (
                    <Input
                      value={manualBaselineId}
                      onChange={(event) => setManualBaselineId(event.target.value)}
                      placeholder="Enter baseline ID"
                    />
                  ) : (
                    <>
                      <Input
                        value={datasetSearch}
                        onChange={(event) => setDatasetSearch(event.target.value)}
                        placeholder="Search by ID, device, or filename"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <DatasetSourceSelect
                          groups={datasetSourceGroups}
                          selectedSourceKey={selectedSourceKey}
                          onChange={setSelectedSourceKey}
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                        />
                        <select
                          value={datasetSort}
                          onChange={(event) =>
                            setDatasetSort(event.target.value as typeof datasetSort)
                          }
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                          title="Sort order"
                        >
                          <option value="newest">Newest first</option>
                          <option value="oldest">Oldest first</option>
                          <option value="id-asc">ID ascending</option>
                        </select>
                      </div>
                      <select
                        value={
                          selectedBaselineDatasetId != null ? String(selectedBaselineDatasetId) : ''
                        }
                        onChange={(event) =>
                          setSelectedBaselineDatasetId(
                            event.target.value ? Number(event.target.value) : null
                          )
                        }
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        size={Math.min(8, Math.max(3, filteredDatasets.length))}
                      >
                        <option value="">Select dataset</option>
                        {filteredDatasets.map((dataset) => (
                          <option key={dataset.dinsight_id} value={dataset.dinsight_id}>
                            {formatDatasetOptionLabel(dataset)}
                          </option>
                        ))}
                      </select>
                      {selectedDatasetMeta && <DatasetSourceCard dataset={selectedDatasetMeta} />}
                    </>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Effective baseline ID: {suggestedBaselineId ?? 'Not selected'}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onExportSelectedDataset()}
                      disabled={!suggestedBaselineId || exportingDatasetId != null}
                    >
                      {exportingDatasetId != null ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Export baseline + monitoring CSV
                    </Button>
                  </div>
                  {manualBaselineError && (
                    <p className="text-sm text-danger-text">{manualBaselineError}</p>
                  )}
                  {exportError && <p className="text-sm text-danger-text">{exportError}</p>}
                </div>

                <Input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={
                    !baselineReady || state.status === 'uploading' || state.status === 'processing'
                  }
                  onChange={(event) => void onMonitoringFileChange(event.target.files?.[0] ?? null)}
                />

                <div className="rounded-md border border-input bg-muted/20 p-3 text-xs text-muted-foreground">
                  Selected file:{' '}
                  <span className="font-medium text-foreground">
                    {monitoringFile?.name ?? 'None'}
                  </span>
                </div>

                {(validatingMonitoring || monitoringValidation) && (
                  <div className="rounded-md border border-input p-3 text-xs">
                    {validatingMonitoring ? (
                      <p className="text-muted-foreground">Validating monitoring file...</p>
                    ) : (
                      <div className="space-y-2">
                        <p>
                          <strong>Size:</strong> {monitoringValidation?.fileSizeMb} MB |{' '}
                          <strong>Preview rows:</strong> {monitoringValidation?.previewRows}
                        </p>
                        {monitoringValidation?.headers.length ? (
                          <p className="truncate">
                            <strong>Headers:</strong>{' '}
                            {monitoringValidation.headers.slice(0, 6).join(', ')}
                          </p>
                        ) : null}
                        {monitoringValidation?.warnings.map((warning) => (
                          <p key={warning} className="text-warning-text">
                            {warning}
                          </p>
                        ))}
                        {monitoringValidation?.errors.map((error) => (
                          <p key={error} className="text-danger-text">
                            {error}
                          </p>
                        ))}
                        {monitoringValidation?.valid && (
                          <p className="text-success-text">Monitoring file validation passed.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-auto border-t border-border pt-3">
                  <Button
                    onClick={() => void onMonitoringUpload()}
                    disabled={
                      !baselineReady ||
                      !monitoringFile ||
                      !monitoringValidation?.valid ||
                      state.status === 'uploading' ||
                      state.status === 'processing'
                    }
                    className="w-full"
                  >
                    {state.step === 'monitoring' &&
                    (state.status === 'uploading' || state.status === 'processing') ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing monitoring...
                      </>
                    ) : (
                      'Upload monitoring CSV'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-lg">Results Visualization</CardTitle>
            <CardDescription>
              Open a modal to preview latest processed or previously saved datasets.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button
              onClick={() => {
                setPreviewMode('latest');
                setIsResultsModalOpen(true);
                setPreviewRefreshKey((prev) => prev + 1);
              }}
              variant="outline"
            >
              View latest visualization
            </Button>
            <Button
              onClick={() => {
                setPreviewMode('saved');
                setIsResultsModalOpen(true);
                setPreviewRefreshKey((prev) => prev + 1);
              }}
              variant="outline"
            >
              View saved results
            </Button>
          </CardContent>
        </Card>

        {monitoringComplete && (
          <Card className="border-success-border bg-success-bg/40 ">
            <CardHeader>
              <CardTitle className="text-lg text-success-text">Ready for Live Operation</CardTitle>
              <CardDescription>
                Baseline and monitoring uploads are complete and validated.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                Generated baseline ID:{' '}
                <strong>#{state.dinsightId ?? suggestedBaselineId ?? 'N/A'}</strong>
              </p>
              <p className="text-muted-foreground">
                Recommended next step: open live monitor and verify machine trajectory is within
                expected behavior.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/dashboard/live">
                    Open live monitor
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => void refetch()}>
                  Refresh datasets
                </Button>
                <Button variant="outline" onClick={resetWorkflow}>
                  Reset flow
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// DatasetSourceCard renders the full source-attribution block for
// the currently-selected dataset using the multi-line typography
// pattern (primary identity bold, supporting metadata muted). The
// IoT-Hub/Manual badge makes the source unambiguous at a glance.
function DatasetSourceCard({
  dataset,
}: {
  dataset: {
    dinsight_id: number;
    source: {
      source: 'auto' | 'manual' | 'unknown';
      deviceName?: string;
      deviceSlug?: string;
      iotHubDeviceId?: string;
      iotHubName?: string;
      originalFileName?: string;
      createdAt?: string;
    };
  };
}) {
  const s = dataset.source;
  const isAuto = s.source === 'auto';
  const isManual = s.source === 'manual';

  // Primary line: device name (auto) OR "Manual upload" OR a fallback
  // for legacy rows where source attribution is unknown.
  const primary = isAuto
    ? (s.deviceName ?? s.deviceSlug ?? 'IoT Hub device')
    : isManual
      ? 'Manual upload'
      : `Dataset #${dataset.dinsight_id}`;

  // Secondary line: original filename + ingested time + internal ID.
  const secondaryParts: string[] = [];
  if (s.originalFileName) secondaryParts.push(s.originalFileName);
  if (s.createdAt) secondaryParts.push(formatRelativeTime(s.createdAt));
  secondaryParts.push(`#${dataset.dinsight_id}`);

  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{primary}</div>
          <div className="text-xs text-muted-foreground truncate">{secondaryParts.join(' · ')}</div>
          {isAuto && s.iotHubName && (
            <div className="text-[10px] text-muted-foreground/80 truncate">
              IoT Hub: {s.iotHubName}
              {s.iotHubDeviceId ? ` · device ID ${s.iotHubDeviceId}` : ''}
            </div>
          )}
        </div>
        <span
          className={
            isAuto
              ? 'shrink-0 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide'
              : isManual
                ? 'shrink-0 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide'
                : 'shrink-0 rounded-full bg-slate-500/15 text-slate-700 dark:text-slate-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide'
          }
        >
          {isAuto ? 'Auto' : isManual ? 'Manual' : 'Unknown'}
        </span>
      </div>
    </div>
  );
}

// formatRelativeTime returns a compact human-friendly relative time
// for the source-card secondary line. Falls back to the raw ISO
// string when the input doesn't parse — the picker never throws.
function formatRelativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(ms).toLocaleDateString();
}
