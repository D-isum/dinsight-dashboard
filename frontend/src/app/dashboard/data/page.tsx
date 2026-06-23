'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Eye,
  Loader2,
  RefreshCw,
  Scissors,
  Settings2,
  Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfigDialog } from '@/components/ui/config-dialog';
import { ProcessingDialog } from '@/components/ui/processing-dialog';
import { DeploymentStatusCard } from '@/components/deployment/deployment-status-card';
import { DatasetCatalog } from '@/components/datasets/dataset-catalog';
import { DatasetSourceSelect } from '@/components/datasets/dataset-source-select';
import { usePermission } from '@/components/auth/require-permission';
import { useBaselineMonitoringData } from '@/hooks/useBaselineMonitoringData';
import { useDatasetDiscovery } from '@/hooks/useDatasetDiscovery';
import { useDatasetSourceFilter } from '@/hooks/useDatasetSourceFilter';
import { useUploadWorkflow } from '@/hooks/useUploadWorkflow';
import { api } from '@/lib/api-client';
import {
  CombinedCsvSplitPreview,
  CombinedRangeType,
  previewCombinedCsvSplitFile,
  splitCombinedCsvFile,
} from '@/lib/combined-csv-split';
import { formatDatasetOptionLabel, getDatasetSourceGroupKey } from '@/lib/dataset-source-groups';
import { Actions } from '@/lib/permissions';

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

function createDinsightPreviewPlot(
  baselineData: { dinsight_x: number[]; dinsight_y: number[] } | null | undefined,
  monitoringData: { dinsight_x: number[]; dinsight_y: number[] } | null | undefined,
  compact = false
) {
  if (!baselineData || baselineData.dinsight_x.length === 0) {
    return null;
  }

  const traces: any[] = [
    {
      x: baselineData.dinsight_x,
      y: baselineData.dinsight_y,
      type: 'scattergl',
      mode: 'markers',
      name: 'Baseline',
      marker: { color: '#2563EB', size: compact ? 4 : 6, opacity: 0.45 },
      hovertemplate: 'Baseline<br>X: %{x:.4f}<br>Y: %{y:.4f}<extra></extra>',
    },
  ];

  if (monitoringData && monitoringData.dinsight_x.length > 0) {
    traces.push({
      x: monitoringData.dinsight_x,
      y: monitoringData.dinsight_y,
      type: 'scattergl',
      mode: 'markers',
      name: 'Monitoring',
      marker: { color: '#DC2626', size: compact ? 4 : 6, opacity: 0.65 },
      hovertemplate: 'Monitoring<br>X: %{x:.4f}<br>Y: %{y:.4f}<extra></extra>',
    });
  }

  return {
    data: traces,
    layout: {
      template: 'plotly_white',
      autosize: true,
      margin: compact ? { t: 8, r: 8, b: 28, l: 36 } : { t: 18, r: 20, b: 50, l: 55 },
      xaxis: { title: compact ? '' : 'DInsight X' },
      yaxis: { title: compact ? '' : 'DInsight Y' },
      legend: compact
        ? { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'right', x: 1 }
        : {
            orientation: 'h',
            yanchor: 'bottom',
            y: 1.02,
            xanchor: 'right',
            x: 1,
          },
    } as any,
    config: { responsive: true, displayModeBar: false },
  };
}

export default function DataIngestionPage() {
  const queryClient = useQueryClient();
  const canCreateDatasetMetadata = usePermission(Actions.DatasetCreate);
  const { state, uploadBaseline, uploadMonitoring, uploadCombinedSplit, resetWorkflow } =
    useUploadWorkflow();
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
  const [combinedFile, setCombinedFile] = useState<File | null>(null);
  const [baselineValidation, setBaselineValidation] = useState<ValidationResult | null>(null);
  const [monitoringValidation, setMonitoringValidation] = useState<ValidationResult | null>(null);
  const [combinedValidation, setCombinedValidation] = useState<ValidationResult | null>(null);
  const [validatingBaseline, setValidatingBaseline] = useState(false);
  const [validatingMonitoring, setValidatingMonitoring] = useState(false);
  const [validatingCombined, setValidatingCombined] = useState(false);
  const [combinedSplitColumn, setCombinedSplitColumn] = useState('');
  const [combinedRangeType, setCombinedRangeType] = useState<CombinedRangeType>('datetime');
  const [combinedBaselineStart, setCombinedBaselineStart] = useState('');
  const [combinedBaselineEnd, setCombinedBaselineEnd] = useState('');
  const [combinedMonitoringStart, setCombinedMonitoringStart] = useState('');
  const [combinedMonitoringEnd, setCombinedMonitoringEnd] = useState('');
  const [combinedSplitError, setCombinedSplitError] = useState<string | null>(null);
  const [combinedSplitSummary, setCombinedSplitSummary] = useState<string | null>(null);
  const [combinedSplitPreview, setCombinedSplitPreview] = useState<CombinedCsvSplitPreview | null>(
    null
  );
  const [isPreviewingSplit, setIsPreviewingSplit] = useState(false);

  const [manualBaselineId, setManualBaselineId] = useState('');
  const [useManualBaselineId, setUseManualBaselineId] = useState(false);
  const [selectedBaselineDatasetId, setSelectedBaselineDatasetId] = useState<number | null>(null);
  const [datasetSearch, setDatasetSearch] = useState('');
  const [manualBaselineError, setManualBaselineError] = useState<string | null>(null);

  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
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
  const autoRegisteredMetadataIdsRef = useRef<Set<number>>(new Set());
  const [metadataRegistrationStatus, setMetadataRegistrationStatus] = useState<string | null>(null);

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

  useEffect(() => {
    const datasetId = state.dinsightId;
    if (!datasetId || autoRegisteredMetadataIdsRef.current.has(datasetId)) {
      return;
    }

    autoRegisteredMetadataIdsRef.current.add(datasetId);

    let cancelled = false;
    const sourceFile = combinedFile ?? baselineFile;
    const sourceName = sourceFile?.name?.replace(/\.[^.]+$/, '') || `Dataset ${datasetId}`;

    const registerMetadata = async () => {
      try {
        await api.datasets.getMetadata(datasetId);
        if (!cancelled) {
          setMetadataRegistrationStatus(
            `Catalog metadata already exists for dataset #${datasetId}.`
          );
        }
        return;
      } catch (error: any) {
        const status = error?.response?.status;
        const code = error?.response?.data?.error?.code;
        if (status !== 404 && code !== 'METADATA_NOT_FOUND') {
          if (!cancelled) {
            setMetadataRegistrationStatus(
              `Metadata check skipped for dataset #${datasetId}; catalog export/delete still works.`
            );
          }
          return;
        }
      }

      if (!canCreateDatasetMetadata) {
        if (!cancelled) {
          setMetadataRegistrationStatus(
            `Dataset #${datasetId} is processed but metadata registration requires operator/admin access.`
          );
        }
        return;
      }

      try {
        await api.datasets.createMetadata({
          dataset_id: datasetId,
          dataset_type: 'baseline',
          name: sourceName,
          description: `Auto-registered from Data Ingestion upload${sourceFile ? ` (${sourceFile.name})` : ''}.`,
          processing_stage: 'processed',
          version: '1.0',
          tags: ['auto-registered', 'data-ingestion'],
        });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['datasets'] }),
          queryClient.invalidateQueries({ queryKey: ['catalog'] }),
        ]);
        if (!cancelled) {
          setMetadataRegistrationStatus(`Catalog metadata registered for dataset #${datasetId}.`);
        }
      } catch (error: any) {
        const status = error?.response?.status;
        const code = error?.response?.data?.error?.code;
        if (status === 409 || code === 'METADATA_EXISTS') {
          if (!cancelled) {
            setMetadataRegistrationStatus(
              `Catalog metadata already exists for dataset #${datasetId}.`
            );
          }
          return;
        }
        if (!cancelled) {
          setMetadataRegistrationStatus(
            error?.response?.data?.message ||
              `Dataset #${datasetId} processed; metadata can be registered from Catalog.`
          );
        }
      }
    };

    void registerMetadata();

    return () => {
      cancelled = true;
    };
  }, [baselineFile, canCreateDatasetMetadata, combinedFile, queryClient, state.dinsightId]);

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

  const onCombinedFileChange = async (file: File | null) => {
    setCombinedFile(file);
    setCombinedValidation(null);
    setCombinedSplitError(null);
    setCombinedSplitSummary(null);
    setCombinedSplitPreview(null);

    if (!file) {
      return;
    }

    setValidatingCombined(true);
    const result = await runValidation(file);
    setCombinedValidation(result);
    setValidatingCombined(false);

    if (result.headers.length > 0) {
      const currentStillExists = result.headers.some((header) => header === combinedSplitColumn);
      if (!combinedSplitColumn || !currentStillExists) {
        const inferred =
          result.headers.find((header) => /timestamp|time|date|datetime/i.test(header)) ??
          result.headers.find((header) => /day|period|sequence|index|order/i.test(header)) ??
          result.headers[0];
        setCombinedSplitColumn(inferred);
        if (/day|period|sequence|index|order/i.test(inferred) && !/date|time/i.test(inferred)) {
          setCombinedRangeType('number');
        }
      }
    }
  };

  const onPreviewCombinedSplit = async () => {
    if (!combinedFile || !combinedValidation?.valid) {
      return;
    }

    if (
      !combinedSplitColumn ||
      !combinedBaselineStart ||
      !combinedBaselineEnd ||
      !combinedMonitoringStart ||
      !combinedMonitoringEnd
    ) {
      setCombinedSplitError('Select a split column and complete all baseline/monitoring bounds.');
      return;
    }

    setCombinedSplitError(null);
    setCombinedSplitPreview(null);
    setIsPreviewingSplit(true);
    try {
      const preview = await previewCombinedCsvSplitFile(combinedFile, {
        splitColumn: combinedSplitColumn,
        rangeType: combinedRangeType,
        baselineStart: combinedBaselineStart,
        baselineEnd: combinedBaselineEnd,
        monitoringStart: combinedMonitoringStart,
        monitoringEnd: combinedMonitoringEnd,
      });
      setCombinedSplitPreview(preview);
    } catch (error: any) {
      setCombinedSplitError(error?.message || 'Unable to preview combined file split.');
    } finally {
      setIsPreviewingSplit(false);
    }
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

  const onCombinedUpload = async () => {
    if (!combinedFile || !combinedValidation?.valid) {
      return;
    }

    if (
      !combinedSplitColumn ||
      !combinedBaselineStart ||
      !combinedBaselineEnd ||
      !combinedMonitoringStart ||
      !combinedMonitoringEnd
    ) {
      setCombinedSplitError('Select a split column and complete all baseline/monitoring bounds.');
      return;
    }

    setCombinedSplitError(null);
    setCombinedSplitSummary(null);
    setCombinedSplitPreview(null);

    try {
      const split = await splitCombinedCsvFile(combinedFile, {
        splitColumn: combinedSplitColumn,
        rangeType: combinedRangeType,
        baselineStart: combinedBaselineStart,
        baselineEnd: combinedBaselineEnd,
        monitoringStart: combinedMonitoringStart,
        monitoringEnd: combinedMonitoringEnd,
      });
      setCombinedSplitSummary(
        `Split ${split.totalRows.toLocaleString()} rows into ${split.baselineRows.toLocaleString()} baseline and ${split.monitoringRows.toLocaleString()} monitoring rows.`
      );
      await uploadCombinedSplit(split.baselineFile, split.monitoringFile);
    } catch (error: any) {
      setCombinedSplitError(error?.message || 'Unable to split combined file.');
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
  const inlinePreviewDatasetId = latestProcessedPreviewId ?? savedPreviewId;

  const {
    baselineData: inlineBaselineData,
    monitoringData: inlineMonitoringData,
    isLoadingBaseline: isInlineLoadingBaseline,
    isLoadingMonitoring: isInlineLoadingMonitoring,
    baselineError: inlineBaselineError,
    monitoringError: inlineMonitoringError,
  } = useBaselineMonitoringData({
    dinsightId: inlinePreviewDatasetId ?? null,
    includeMetadata: false,
    monitoringMode: 'coordinates',
    maxPoints: 20_000,
    refreshKey: previewRefreshKey,
  });

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
    monitoringMode: 'coordinates',
    maxPoints: 75_000,
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
  const previewPlot = useMemo(
    () => createDinsightPreviewPlot(previewBaselineData, previewMonitoringData),
    [previewBaselineData, previewMonitoringData]
  );
  const inlinePreviewPlot = useMemo(
    () => createDinsightPreviewPlot(inlineBaselineData, inlineMonitoringData, true),
    [inlineBaselineData, inlineMonitoringData]
  );

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

      <ConfigDialog
        open={isCatalogOpen}
        onOpenChange={setIsCatalogOpen}
        title="Dataset Catalog"
        description="Browse processed datasets, export CSVs, register metadata, inspect lineage, run validation, and delete obsolete datasets."
        contentClassName="w-[94vw] sm:max-w-[1180px]"
      >
        <DatasetCatalog variant="modal" />
      </ConfigDialog>

      <div className="space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-fg">Data Ingestion</h1>
              <Badge
                variant={
                  state.status === 'error'
                    ? 'danger'
                    : isActiveProcessing
                      ? 'info'
                      : monitoringComplete
                        ? 'success'
                        : 'outline'
                }
              >
                {state.status === 'idle'
                  ? 'Idle'
                  : state.status === 'completed'
                    ? 'Complete'
                    : state.status}
              </Badge>
            </div>
            <p className="max-w-3xl text-sm text-fg-muted">
              Configure processing, upload combined or split CSV files, and review generated
              DInsight results from one workspace.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" onClick={() => setIsCatalogOpen(true)}>
              <Database className="mr-2 h-4 w-4" />
              Catalog
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            icon={<Settings2 className="h-4 w-4" />}
            label="Configuration"
            value={config?.optimizer ?? DEFAULT_CONFIG.optimizer}
            detail={`${config?.start_dim ?? DEFAULT_CONFIG.start_dim} to ${
              config?.end_dim ?? DEFAULT_CONFIG.end_dim
            }`}
          />
          <MetricTile
            icon={<Upload className="h-4 w-4" />}
            label="Workflow"
            value={state.step}
            detail={state.statusMessage || state.status}
          />
          <MetricTile
            icon={<Database className="h-4 w-4" />}
            label="Baseline target"
            value={suggestedBaselineId ? `#${suggestedBaselineId}` : 'Not selected'}
            detail={`${filteredDatasets.length.toLocaleString()} matching datasets`}
          />
          <MetricTile
            icon={<BarChart3 className="h-4 w-4" />}
            label="Preview dataset"
            value={previewDatasetId ? `#${previewDatasetId}` : 'None'}
            detail={`${sourceFilteredDatasets.length.toLocaleString()} saved results`}
          />
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <WorkflowStepper
            isConfigured={!isConfigLoading}
            baselineReady={baselineReady}
            monitoringComplete={monitoringComplete}
            catalogReady={Boolean(metadataRegistrationStatus)}
            hasVisualization={Boolean(inlinePreviewPlot)}
            isActiveProcessing={isActiveProcessing}
            hasError={state.status === 'error'}
          />
          <DeploymentStatusCard compact />
        </div>

        {metadataRegistrationStatus && (
          <div className="rounded-md border border-info-border bg-info-bg px-3 py-2 text-sm text-info-text">
            {metadataRegistrationStatus}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <Card className="border-border/60">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Settings2 className="h-5 w-5" />
                    Configuration Set
                  </CardTitle>
                  <CardDescription>Processing parameters applied to new uploads.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={onEditConfig}>
                  Update configuration
                </Button>
              </CardHeader>
              <CardContent>
                {isConfigLoading ? (
                  <p className="text-sm text-muted-foreground">Loading configuration set...</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <ConfigValue
                      label="Optimizer"
                      value={config?.optimizer ?? DEFAULT_CONFIG.optimizer}
                    />
                    <ConfigValue label="Alpha" value={config?.alpha ?? DEFAULT_CONFIG.alpha} />
                    <ConfigValue label="Gamma0" value={config?.gamma0 ?? DEFAULT_CONFIG.gamma0} />
                    <ConfigValue
                      label="End metadata"
                      value={config?.end_meta ?? DEFAULT_CONFIG.end_meta}
                    />
                    <ConfigValue
                      label="Start feature"
                      value={config?.start_dim ?? DEFAULT_CONFIG.start_dim}
                    />
                    <ConfigValue
                      label="End feature"
                      value={config?.end_dim ?? DEFAULT_CONFIG.end_dim}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileSpreadsheet className="h-5 w-5" />
                  Upload Data
                </CardTitle>
                <CardDescription>
                  Choose the upload mode that matches the source file.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="combined" className="space-y-4">
                  <TabsList className="grid h-auto w-full grid-cols-2 rounded-lg">
                    <TabsTrigger value="combined" className="gap-2 py-2">
                      <Scissors className="h-4 w-4" />
                      Combined CSV
                    </TabsTrigger>
                    <TabsTrigger value="two-file" className="gap-2 py-2">
                      <Upload className="h-4 w-4" />
                      Baseline + Monitoring
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="combined" className="mt-0">
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,420px)]">
                      <section className="space-y-4 rounded-lg border border-border bg-surface/50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h2 className="text-base font-semibold">Combined source file</h2>
                            <p className="text-xs text-muted-foreground">
                              One CSV becomes baseline and monitoring uploads.
                            </p>
                          </div>
                          <Badge variant={combinedValidation?.valid ? 'success' : 'outline'}>
                            {combinedValidation?.valid ? 'Ready' : 'CSV'}
                          </Badge>
                        </div>
                        <Input
                          type="file"
                          accept=".csv,text/csv"
                          disabled={isActiveProcessing}
                          onChange={(event) =>
                            void onCombinedFileChange(event.target.files?.[0] ?? null)
                          }
                        />
                        <FileValidationSummary
                          file={combinedFile}
                          validation={combinedValidation}
                          isValidating={validatingCombined}
                          validatingLabel="Validating combined file..."
                          successLabel="Combined file validation passed."
                          headerLimit={8}
                        />
                      </section>

                      <section className="space-y-4 rounded-lg border border-border bg-surface/50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h2 className="text-base font-semibold">Split rules</h2>
                          <Badge variant="info">{combinedRangeType}</Badge>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                          <div className="grid gap-2">
                            <label className="text-sm font-medium" htmlFor="combined-split-column">
                              Split column
                            </label>
                            <select
                              id="combined-split-column"
                              value={combinedSplitColumn}
                              onChange={(event) => {
                                setCombinedSplitColumn(event.target.value);
                                setCombinedSplitPreview(null);
                              }}
                              disabled={!combinedValidation?.headers.length || isActiveProcessing}
                              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                            >
                              <option value="">Select column</option>
                              {combinedValidation?.headers.map((header) => (
                                <option key={header} value={header}>
                                  {header}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid gap-2">
                            <label className="text-sm font-medium" htmlFor="combined-range-type">
                              Range type
                            </label>
                            <select
                              id="combined-range-type"
                              value={combinedRangeType}
                              onChange={(event) => {
                                setCombinedRangeType(event.target.value as CombinedRangeType);
                                setCombinedSplitPreview(null);
                              }}
                              disabled={isActiveProcessing}
                              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                            >
                              <option value="datetime">Timestamp / date / time</option>
                              <option value="number">Numeric / day index</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <RangeInput
                            id="combined-baseline-start"
                            label="Baseline start"
                            value={combinedBaselineStart}
                            rangeType={combinedRangeType}
                            disabled={isActiveProcessing}
                            onChange={(value) => {
                              setCombinedBaselineStart(value);
                              setCombinedSplitPreview(null);
                            }}
                          />
                          <RangeInput
                            id="combined-baseline-end"
                            label="Baseline stop"
                            value={combinedBaselineEnd}
                            rangeType={combinedRangeType}
                            disabled={isActiveProcessing}
                            onChange={(value) => {
                              setCombinedBaselineEnd(value);
                              setCombinedSplitPreview(null);
                            }}
                          />
                          <RangeInput
                            id="combined-monitoring-start"
                            label="Monitoring start"
                            value={combinedMonitoringStart}
                            rangeType={combinedRangeType}
                            disabled={isActiveProcessing}
                            onChange={(value) => {
                              setCombinedMonitoringStart(value);
                              setCombinedSplitPreview(null);
                            }}
                          />
                          <RangeInput
                            id="combined-monitoring-end"
                            label="Monitoring stop"
                            value={combinedMonitoringEnd}
                            rangeType={combinedRangeType}
                            disabled={isActiveProcessing}
                            onChange={(value) => {
                              setCombinedMonitoringEnd(value);
                              setCombinedSplitPreview(null);
                            }}
                          />
                        </div>

                        {combinedSplitPreview && (
                          <SplitPreviewPanel preview={combinedSplitPreview} />
                        )}
                        {combinedSplitError && (
                          <p className="text-sm text-danger-text">{combinedSplitError}</p>
                        )}
                        {combinedSplitSummary && (
                          <p className="text-sm text-success-text">{combinedSplitSummary}</p>
                        )}

                        <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                          <Button
                            variant="outline"
                            onClick={() => void onPreviewCombinedSplit()}
                            disabled={
                              !combinedFile ||
                              !combinedValidation?.valid ||
                              isPreviewingSplit ||
                              isActiveProcessing
                            }
                          >
                            {isPreviewingSplit ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Eye className="mr-2 h-4 w-4" />
                            )}
                            Preview split
                          </Button>
                          <Button
                            onClick={() => void onCombinedUpload()}
                            disabled={
                              !combinedFile || !combinedValidation?.valid || isActiveProcessing
                            }
                            className="w-full"
                          >
                            {isActiveProcessing ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Processing combined CSV...
                              </>
                            ) : (
                              'Split and upload'
                            )}
                          </Button>
                        </div>
                      </section>
                    </div>
                  </TabsContent>

                  <TabsContent value="two-file" className="mt-0">
                    <div className="grid gap-4 xl:grid-cols-2">
                      <section className="flex min-h-full flex-col space-y-4 rounded-lg border border-border bg-surface/50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h2 className="flex items-center gap-2 text-base font-semibold">
                              {baselineReady ? (
                                <CheckCircle2 className="h-4 w-4 text-success-text" />
                              ) : (
                                <Upload className="h-4 w-4" />
                              )}
                              Baseline
                            </h2>
                            <p className="text-xs text-muted-foreground">
                              Upload the baseline CSV first.
                            </p>
                          </div>
                          <Badge variant={baselineReady ? 'success' : 'outline'}>
                            {baselineReady ? 'Complete' : 'Step 1'}
                          </Badge>
                        </div>

                        <Input
                          type="file"
                          accept=".csv,text/csv"
                          disabled={state.status === 'uploading' || state.status === 'processing'}
                          onChange={(event) =>
                            void onBaselineFileChange(event.target.files?.[0] ?? null)
                          }
                        />
                        <FileValidationSummary
                          file={baselineFile}
                          validation={baselineValidation}
                          isValidating={validatingBaseline}
                          validatingLabel="Validating baseline file..."
                          successLabel="Baseline file validation passed."
                        />

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
                      </section>

                      <section className="flex min-h-full flex-col space-y-4 rounded-lg border border-border bg-surface/50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h2 className="flex items-center gap-2 text-base font-semibold">
                              {monitoringComplete ? (
                                <CheckCircle2 className="h-4 w-4 text-success-text" />
                              ) : (
                                <Upload className="h-4 w-4" />
                              )}
                              Monitoring
                            </h2>
                            <p className="text-xs text-muted-foreground">
                              Compare monitoring data with a baseline target.
                            </p>
                          </div>
                          <Badge variant={monitoringComplete ? 'success' : 'outline'}>
                            {monitoringComplete ? 'Complete' : 'Step 2'}
                          </Badge>
                        </div>

                        <div className="space-y-3 rounded-md border border-input bg-background/60 p-3">
                          <div className="flex items-center justify-between gap-3">
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
                                  selectedBaselineDatasetId != null
                                    ? String(selectedBaselineDatasetId)
                                    : ''
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
                              {selectedDatasetMeta && (
                                <DatasetSourceCard dataset={selectedDatasetMeta} />
                              )}
                            </>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground">
                              Effective baseline ID: {suggestedBaselineId ?? 'Not selected'}
                            </p>
                          </div>
                          {manualBaselineError && (
                            <p className="text-sm text-danger-text">{manualBaselineError}</p>
                          )}
                        </div>

                        <Input
                          type="file"
                          accept=".csv,text/csv"
                          disabled={
                            !baselineReady ||
                            state.status === 'uploading' ||
                            state.status === 'processing'
                          }
                          onChange={(event) =>
                            void onMonitoringFileChange(event.target.files?.[0] ?? null)
                          }
                        />
                        <FileValidationSummary
                          file={monitoringFile}
                          validation={monitoringValidation}
                          isValidating={validatingMonitoring}
                          validatingLabel="Validating monitoring file..."
                          successLabel="Monitoring file validation passed."
                        />

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
                      </section>
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <BarChart3 className="h-5 w-5" />
                    Results Visualization
                  </CardTitle>
                  <CardDescription>
                    Preview latest output or load a saved dataset from the database.
                  </CardDescription>
                </div>
                <Badge variant={previewDatasetId ? 'info' : 'outline'}>
                  {previewDatasetId ? `#${previewDatasetId}` : 'No dataset'}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <ConfigValue
                      label="Baseline points"
                      value={inlineBaselineData?.dinsight_x.length ?? 0}
                    />
                    <ConfigValue
                      label="Monitoring points"
                      value={inlineMonitoringData?.dinsight_x.length ?? 0}
                    />
                    <ConfigValue label="Sample cap" value="20k" />
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <Button
                      onClick={() => {
                        setPreviewMode('latest');
                        setIsResultsModalOpen(true);
                        setPreviewRefreshKey((prev) => prev + 1);
                      }}
                      variant="outline"
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Latest
                    </Button>
                    <Button
                      onClick={() => {
                        setPreviewMode('saved');
                        setIsResultsModalOpen(true);
                        setPreviewRefreshKey((prev) => prev + 1);
                      }}
                      variant="outline"
                    >
                      <Database className="mr-2 h-4 w-4" />
                      Saved
                    </Button>
                  </div>
                </div>

                <div className="min-h-[260px] rounded-lg border border-border bg-background p-2">
                  {!inlinePreviewDatasetId ? (
                    <EmptyState
                      title="No processed result yet"
                      description="Upload data or open the catalog to select an existing dataset."
                    />
                  ) : isInlineLoadingBaseline || isInlineLoadingMonitoring ? (
                    <EmptyState
                      title="Loading preview"
                      description="Fetching sampled coordinates..."
                    />
                  ) : inlineBaselineError ? (
                    <EmptyState title="Preview unavailable" description={inlineBaselineError} />
                  ) : inlinePreviewPlot ? (
                    <div className="h-[250px]">
                      <Plot
                        data={inlinePreviewPlot.data as any}
                        layout={inlinePreviewPlot.layout as any}
                        config={inlinePreviewPlot.config as any}
                        useResizeHandler
                        style={{ width: '100%', height: '100%' }}
                      />
                    </div>
                  ) : (
                    <EmptyState
                      title="No coordinates available"
                      description="The selected dataset has no baseline visualization yet."
                    />
                  )}
                  {inlineMonitoringError && (
                    <p className="mt-2 px-2 text-xs text-muted-foreground">
                      {inlineMonitoringError}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {monitoringComplete && (
              <Card className="border-success-border bg-success-bg/40">
                <CardHeader>
                  <CardTitle className="text-lg text-success-text">
                    Ready for Live Operation
                  </CardTitle>
                  <CardDescription>
                    Baseline and monitoring uploads are complete and validated.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p>
                    Generated baseline ID:{' '}
                    <strong>#{state.dinsightId ?? suggestedBaselineId ?? 'N/A'}</strong>
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

          <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base">Dataset Context</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <SideFact
                  label="Effective baseline"
                  value={suggestedBaselineId ?? 'Not selected'}
                />
                <SideFact label="Workflow ID" value={state.dinsightId ?? 'None'} />
                <SideFact label="Saved results" value={sourceFilteredDatasets.length} />
                <SideFact label="Matching targets" value={filteredDatasets.length} />
                {selectedDatasetMeta && <DatasetSourceCard dataset={selectedDatasetMeta} />}
              </CardContent>
            </Card>

            <DataNextActions
              hasConfig={!isConfigLoading}
              baselineReady={baselineReady}
              monitoringComplete={monitoringComplete}
              hasMetadataStatus={Boolean(metadataRegistrationStatus)}
              hasVisualization={Boolean(inlinePreviewPlot)}
              onOpenCatalog={() => setIsCatalogOpen(true)}
              onOpenResults={() => {
                setPreviewMode('latest');
                setIsResultsModalOpen(true);
                setPreviewRefreshKey((prev) => prev + 1);
              }}
            />

            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={() => setIsCatalogOpen(true)}
                >
                  <Database className="mr-2 h-4 w-4" />
                  Open catalog
                </Button>
                <Button variant="outline" asChild className="justify-start">
                  <Link href="/dashboard/live">
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Open live monitor
                  </Link>
                </Button>
                <Button variant="outline" asChild className="justify-start">
                  <Link href="/dashboard/insights">
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Open insights
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  className="justify-start"
                  onClick={resetWorkflow}
                  disabled={isActiveProcessing}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reset flow
                </Button>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}

function RangeInput({
  id,
  label,
  value,
  rangeType,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  rangeType: CombinedRangeType;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-xs font-medium text-muted-foreground" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type={rangeType === 'number' ? 'number' : 'text'}
        value={value}
        disabled={disabled}
        placeholder={rangeType === 'number' ? '1' : '2003/10/22  12:06:24'}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function WorkflowStepper({
  isConfigured,
  baselineReady,
  monitoringComplete,
  catalogReady,
  hasVisualization,
  isActiveProcessing,
  hasError,
}: {
  isConfigured: boolean;
  baselineReady: boolean;
  monitoringComplete: boolean;
  catalogReady: boolean;
  hasVisualization: boolean;
  isActiveProcessing: boolean;
  hasError: boolean;
}) {
  const steps = [
    { label: 'Configure', complete: isConfigured, active: !baselineReady },
    { label: 'Upload', complete: baselineReady, active: isActiveProcessing },
    {
      label: 'Monitor',
      complete: monitoringComplete,
      active: baselineReady && !monitoringComplete,
    },
    { label: 'Catalog', complete: catalogReady, active: monitoringComplete && !catalogReady },
    { label: 'Visualize', complete: hasVisualization, active: catalogReady && !hasVisualization },
    { label: 'Live', complete: monitoringComplete, active: monitoringComplete },
  ];

  return (
    <Card className="border-border/60">
      <CardContent className="p-3">
        <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {steps.map((step, index) => (
            <div
              key={step.label}
              className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-muted/50 px-2 py-2"
            >
              <span
                className={
                  step.complete
                    ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-bg text-success-text'
                    : hasError && step.active
                      ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger-bg text-danger-text'
                      : step.active
                        ? 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-info-bg text-info-text'
                        : 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground'
                }
              >
                {step.complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-fg">{step.label}</div>
                <div className="text-[11px] text-muted-foreground">
                  {step.complete ? 'Done' : step.active ? 'Current' : 'Pending'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SplitPreviewPanel({ preview }: { preview: CombinedCsvSplitPreview }) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-background/60 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-fg">Split preview</span>
        <span className="text-muted-foreground">
          {preview.totalRows.toLocaleString()} total rows
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ConfigValue label="Baseline rows" value={preview.baselineRows.toLocaleString()} />
        <ConfigValue label="Monitoring rows" value={preview.monitoringRows.toLocaleString()} />
        <ConfigValue label="Unmatched rows" value={preview.unmatchedRows.toLocaleString()} />
        <ConfigValue label="Overlap rows" value={preview.overlapRows.toLocaleString()} />
      </div>
      <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
        <div>
          Column range:{' '}
          <span className="font-medium text-fg">
            {preview.minValue || 'N/A'} to {preview.maxValue || 'N/A'}
          </span>
        </div>
        <div>
          File order:{' '}
          <span className="font-medium text-fg">
            {preview.firstValue || 'N/A'} to {preview.lastValue || 'N/A'}
          </span>
        </div>
      </div>
      {preview.overlapRows > 0 && (
        <p className="flex items-start gap-2 text-warning-text">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {preview.overlapRows.toLocaleString()} row(s) match both ranges. Upload will place
          overlapping rows in the baseline split first.
        </p>
      )}
      {preview.unmatchedRows > 0 && (
        <p className="text-muted-foreground">
          {preview.unmatchedRows.toLocaleString()} row(s) are outside both ranges and will be
          excluded.
        </p>
      )}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-md border border-dashed border-border px-4 text-center">
      <div className="text-sm font-semibold text-fg">{title}</div>
      <p className="mt-1 max-w-md text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function DataNextActions({
  hasConfig,
  baselineReady,
  monitoringComplete,
  hasMetadataStatus,
  hasVisualization,
  onOpenCatalog,
  onOpenResults,
}: {
  hasConfig: boolean;
  baselineReady: boolean;
  monitoringComplete: boolean;
  hasMetadataStatus: boolean;
  hasVisualization: boolean;
  onOpenCatalog: () => void;
  onOpenResults: () => void;
}) {
  const action = !hasConfig
    ? {
        title: 'Confirm processing configuration',
        description: 'Feature and metadata columns determine whether uploads validate cleanly.',
        command: null,
      }
    : !baselineReady
      ? {
          title: 'Upload a baseline dataset',
          description: 'Start with a healthy reference dataset or use the combined CSV splitter.',
          command: null,
        }
      : !monitoringComplete
        ? {
            title: 'Upload monitoring data',
            description: 'Attach monitoring data to the selected baseline target.',
            command: null,
          }
        : !hasMetadataStatus
          ? {
              title: 'Open catalog and review metadata',
              description: 'Catalog metadata unlocks validation, compatibility, and curation.',
              command: 'catalog' as const,
            }
          : !hasVisualization
            ? {
                title: 'Open result visualization',
                description: 'Inspect baseline and monitoring coordinates before live operation.',
                command: 'results' as const,
              }
            : {
                title: 'Continue to live monitoring',
                description: 'Processed data is ready for streaming and operational review.',
                command: 'live' as const,
              };

  return (
    <Card className="border-info-border bg-info-bg/40">
      <CardHeader>
        <CardTitle className="text-base text-info-text">Recommended Next Action</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="font-semibold text-fg">{action.title}</div>
        <p className="text-muted-foreground">{action.description}</p>
        {action.command === 'catalog' && (
          <Button variant="outline" className="w-full justify-start" onClick={onOpenCatalog}>
            <Database className="mr-2 h-4 w-4" />
            Open catalog
          </Button>
        )}
        {action.command === 'results' && (
          <Button variant="outline" className="w-full justify-start" onClick={onOpenResults}>
            <BarChart3 className="mr-2 h-4 w-4" />
            Open visualization
          </Button>
        )}
        {action.command === 'live' && (
          <Button asChild variant="outline" className="w-full justify-start">
            <Link href="/dashboard/live">
              <ArrowRight className="mr-2 h-4 w-4" />
              Open live monitor
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function MetricTile({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-fg">
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-3 truncate text-lg font-semibold text-fg">{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function ConfigValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface-muted/60 px-3 py-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-fg">{value}</div>
    </div>
  );
}

function SideFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-semibold text-fg">{value}</span>
    </div>
  );
}

function FileValidationSummary({
  file,
  validation,
  isValidating,
  validatingLabel,
  successLabel,
  headerLimit = 6,
}: {
  file: File | null;
  validation: ValidationResult | null;
  isValidating: boolean;
  validatingLabel: string;
  successLabel: string;
  headerLimit?: number;
}) {
  return (
    <div className="space-y-3 rounded-md border border-input bg-background/60 p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">Selected file</span>
        <span className="min-w-0 max-w-[70%] truncate text-right font-medium text-foreground">
          {file?.name ?? 'None'}
        </span>
      </div>

      {(isValidating || validation) && (
        <div className="space-y-2 border-t border-border pt-3">
          {isValidating ? (
            <p className="flex items-center text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              {validatingLabel}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={validation?.valid ? 'success' : 'danger'}>
                  {validation?.valid ? 'Valid' : 'Needs attention'}
                </Badge>
                <span className="text-muted-foreground">
                  {validation?.fileSizeMb} MB | {validation?.previewRows} preview rows
                </span>
              </div>

              {validation?.headers.length ? (
                <p className="truncate text-muted-foreground">
                  <strong className="text-fg">Headers:</strong>{' '}
                  {validation.headers.slice(0, headerLimit).join(', ')}
                </p>
              ) : null}

              {validation?.warnings.map((warning) => (
                <p key={warning} className="text-warning-text">
                  {warning}
                </p>
              ))}
              {validation?.errors.map((error) => (
                <p key={error} className="text-danger-text">
                  {error}
                </p>
              ))}
              {validation?.valid && <p className="text-success-text">{successLabel}</p>}
            </>
          )}
        </div>
      )}
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
