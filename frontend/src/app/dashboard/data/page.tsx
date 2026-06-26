'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
import { ChartFrame, ChartStat } from '@/components/charts/chart-frame';
import { EChartsCanvas } from '@/components/charts/echarts-canvas';
import { DatasetCatalog } from '@/components/datasets/dataset-catalog';
import { DatasetSourceSelect } from '@/components/datasets/dataset-source-select';
import { usePermission } from '@/components/auth/require-permission';
import { useBaselineMonitoringData } from '@/hooks/useBaselineMonitoringData';
import { useDatasetDiscovery } from '@/hooks/useDatasetDiscovery';
import { useDatasetSourceFilter } from '@/hooks/useDatasetSourceFilter';
import { useUploadWorkflow } from '@/hooks/useUploadWorkflow';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/api-client';
import {
  CombinedCsvSplitPreview,
  CombinedRangeType,
  previewCombinedCsvSplitFile,
  splitCombinedCsvFile,
} from '@/lib/combined-csv-split';
import { createDinsightPreviewPlot } from '@/lib/dinsight-preview-plot';
import { formatDatasetOptionLabel, getDatasetSourceGroupKey } from '@/lib/dataset-source-groups';
import { Actions } from '@/lib/permissions';
import { usePlotTheme } from '@/lib/plot-theme';
import {
  DASHBOARD_COMMAND_EVENT,
  publishDashboardActivity,
  useDashboardWorkspace,
} from '@/context/dashboard-workspace-context';

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
  const searchParams = useSearchParams();
  const plotTheme = usePlotTheme();
  const queryClient = useQueryClient();
  const { t, formatNumber } = useI18n();
  const { selectedDatasetId: workspaceDatasetId, selectDataset: selectWorkspaceDataset } =
    useDashboardWorkspace();
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
  const lastLoggedWorkflowStateRef = useRef('');
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
    if (searchParams.get('catalog') === 'open') {
      setIsCatalogOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action;
      if (action === 'open-catalog') {
        setIsCatalogOpen(true);
      }
      if (action === 'open-results') {
        setPreviewMode('latest');
        setIsResultsModalOpen(true);
        setPreviewRefreshKey((prev) => prev + 1);
      }
    };

    window.addEventListener(DASHBOARD_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(DASHBOARD_COMMAND_EVENT, onCommand);
  }, []);

  useEffect(() => {
    if (state.status === 'idle') {
      return;
    }

    const signature = `${state.step}:${state.status}:${state.dinsightId ?? state.fileUploadId ?? ''}`;
    if (signature === lastLoggedWorkflowStateRef.current) {
      return;
    }
    lastLoggedWorkflowStateRef.current = signature;

    const datasetId = state.dinsightId ?? state.fileUploadId;
    const stepLabel =
      state.step === 'baseline'
        ? 'baseline'
        : state.step === 'monitoring'
          ? 'monitoring'
          : 'dataset';
    const statusLabel =
      state.status === 'completed'
        ? 'completed'
        : state.status === 'error'
          ? 'failed'
          : state.status;

    publishDashboardActivity({
      type: 'upload',
      title: `${stepLabel[0].toUpperCase()}${stepLabel.slice(1)} ${statusLabel}`,
      description:
        state.errorMessage ?? state.statusMessage ?? `Data ingestion workflow is ${statusLabel}.`,
      datasetId,
      href: '/dashboard/data',
      status:
        state.status === 'completed' ? 'success' : state.status === 'error' ? 'danger' : 'info',
    });
  }, [
    state.dinsightId,
    state.errorMessage,
    state.fileUploadId,
    state.status,
    state.statusMessage,
    state.step,
  ]);

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
      const workspacePreviewId =
        workspaceDatasetId && filteredDatasetIds.includes(workspaceDatasetId)
          ? workspaceDatasetId
          : null;
      setSavedPreviewId(workspacePreviewId ?? latestFilteredDatasetId);
    }
  }, [filteredDatasetIds, latestFilteredDatasetId, savedPreviewId, workspaceDatasetId]);

  useEffect(() => {
    if (!workspaceDatasetId || !filteredDatasetIds.includes(workspaceDatasetId)) {
      return;
    }
    if (savedPreviewId !== workspaceDatasetId) {
      setSavedPreviewId(workspaceDatasetId);
    }
    if (workspaceDatasetId !== latestFilteredDatasetId && previewMode !== 'saved') {
      setPreviewMode('saved');
    }
  }, [
    filteredDatasetIds,
    latestFilteredDatasetId,
    previewMode,
    savedPreviewId,
    workspaceDatasetId,
  ]);

  useEffect(() => {
    if (state.dinsightId && lastSourceSyncedWorkflowIdRef.current !== state.dinsightId) {
      lastSourceSyncedWorkflowIdRef.current = state.dinsightId;
      const uploadedDataset = datasets.find((dataset) => dataset.dinsight_id === state.dinsightId);
      if (uploadedDataset) {
        setSelectedSourceKey(getDatasetSourceGroupKey(uploadedDataset));
      }
      setManualBaselineId(String(state.dinsightId));
      setSelectedBaselineDatasetId(state.dinsightId);
      setManualBaselineError(null);
      setUseManualBaselineId(false);
      selectWorkspaceDataset(state.dinsightId);
    }
  }, [datasets, selectWorkspaceDataset, setSelectedSourceKey, state.dinsightId]);

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
    includeMetadata: true,
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
    includeMetadata: true,
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
    () =>
      createDinsightPreviewPlot(previewBaselineData, previewMonitoringData, plotTheme, {
        datasetId: previewDatasetId,
        modeBar: true,
        title: previewDatasetId ? `Dataset #${previewDatasetId}` : undefined,
      }),
    [plotTheme, previewBaselineData, previewDatasetId, previewMonitoringData]
  );
  const inlinePreviewPlot = useMemo(
    () =>
      createDinsightPreviewPlot(inlineBaselineData, inlineMonitoringData, plotTheme, {
        compact: true,
        datasetId: inlinePreviewDatasetId,
        modeBar: false,
      }),
    [inlineBaselineData, inlineMonitoringData, inlinePreviewDatasetId, plotTheme]
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
        title={t('data.updateConfigurationSet')}
        description={t('data.updateConfigurationSetDescription')}
      >
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('data.optimizer')}</label>
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
              <label className="text-sm font-medium">{t('data.alpha')}</label>
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
              <label className="text-sm font-medium">{t('data.initialGamma')}</label>
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
              <label className="text-sm font-medium">{t('data.endMetadataColumn')}</label>
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
              <label className="text-sm font-medium">{t('data.startFeatureColumn')}</label>
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
              <label className="text-sm font-medium">{t('data.endFeatureColumn')}</label>
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
                  {t('data.saving')}
                </>
              ) : (
                t('data.saveConfigurationSet')
              )}
            </Button>
            <Button variant="outline" onClick={onRestoreDefaultConfig} disabled={isSavingConfig}>
              {t('data.restoreDefaults')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setIsConfigDialogOpen(false);
                setConfigError(null);
              }}
              disabled={isSavingConfig}
            >
              {t('common.cancel')}
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
        title={t('data.resultsVisualization')}
        description={t('data.previewDescription')}
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
              {t('data.latestProcessed')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={previewMode === 'saved'}
                onChange={() => setPreviewMode('saved')}
              />
              {t('data.savedResult')}
            </label>
            {previewMode === 'saved' && (
              <select
                value={savedPreviewId != null ? String(savedPreviewId) : ''}
                onChange={(event) => {
                  const nextId = event.target.value ? Number(event.target.value) : null;
                  setSavedPreviewId(nextId);
                  if (nextId != null) {
                    selectWorkspaceDataset(nextId);
                  }
                }}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('data.selectSavedDataset')}</option>
                {sourceFilteredDatasets.map((dataset) => (
                  <option key={dataset.dinsight_id} value={dataset.dinsight_id}>
                    {formatDatasetOptionLabel(dataset)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>
              {t('data.datasetId')}: {previewDatasetId ?? t('data.noneSelected')}
            </span>
            <span>
              {t('data.baselinePoints')}:{' '}
              {formatNumber(previewBaselineData?.dinsight_x.length ?? 0)}
            </span>
            <span>
              {t('data.monitoringPoints')}:{' '}
              {formatNumber(previewMonitoringData?.dinsight_x.length ?? 0)}
            </span>
          </div>

          {previewDatasetId == null ? (
            <p className="text-sm text-muted-foreground">{t('data.selectDatasetToVisualize')}</p>
          ) : isPreviewLoadingBaseline || isPreviewLoadingMonitoring ? (
            <p className="text-sm text-muted-foreground">{t('data.loadingVisualization')}</p>
          ) : previewBaselineError ? (
            <p className="text-sm text-danger-text">{previewBaselineError}</p>
          ) : previewPlot ? (
            <ChartFrame
              title={t('live.coordinateMap')}
              description={t('data.coordinateMapDescription')}
              stats={
                <>
                  <ChartStat
                    label={t('common.dataset')}
                    value={previewDatasetId ? `#${previewDatasetId}` : '—'}
                  />
                  <ChartStat
                    label={t('common.baseline')}
                    value={formatNumber(previewBaselineData?.dinsight_x.length ?? 0)}
                    tone="info"
                  />
                  <ChartStat
                    label={t('common.monitoring')}
                    value={formatNumber(previewMonitoringData?.dinsight_x.length ?? 0)}
                    tone={previewMonitoringData?.dinsight_x.length ? 'danger' : 'neutral'}
                  />
                </>
              }
              actions={
                <>
                  <Button asChild size="sm">
                    <Link href="/dashboard/live">
                      {t('data.openInLive')}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/dashboard/insights">{t('data.openInInsights')}</Link>
                  </Button>
                </>
              }
            >
              <div className="mx-auto aspect-square w-full max-w-[820px] max-h-[75vh]">
                <EChartsCanvas
                  key={previewPlot.revision}
                  option={previewPlot.option}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
              {previewMonitoringError && (
                <p className="text-xs text-muted-foreground">{previewMonitoringError}</p>
              )}
            </ChartFrame>
          ) : (
            <p className="text-sm text-muted-foreground">{t('data.noBaselineVisualization')}</p>
          )}
        </div>
      </ConfigDialog>

      <ConfigDialog
        open={isCatalogOpen}
        onOpenChange={setIsCatalogOpen}
        title={t('data.datasetCatalog')}
        description={t('data.catalogDescription')}
        contentClassName="w-[96vw] sm:max-w-[1320px]"
      >
        <DatasetCatalog variant="modal" />
      </ConfigDialog>

      <div className="space-y-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-fg">{t('data.title')}</h1>
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
                  ? t('data.idle')
                  : state.status === 'completed'
                    ? t('data.complete')
                    : state.status}
              </Badge>
            </div>
            <p className="max-w-3xl text-sm text-fg-muted">{t('data.description')}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('common.refresh')}
            </Button>
            <Button variant="outline" onClick={() => setIsCatalogOpen(true)}>
              <Database className="mr-2 h-4 w-4" />
              {t('common.catalog')}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile
            icon={<Settings2 className="h-4 w-4" />}
            label={t('data.configuration')}
            value={config?.optimizer ?? DEFAULT_CONFIG.optimizer}
            detail={`${config?.start_dim ?? DEFAULT_CONFIG.start_dim} to ${
              config?.end_dim ?? DEFAULT_CONFIG.end_dim
            }`}
          />
          <MetricTile
            icon={<Upload className="h-4 w-4" />}
            label={t('data.uploadMode')}
            value={state.step}
            detail={state.statusMessage || state.status}
          />
          <MetricTile
            icon={<Database className="h-4 w-4" />}
            label={t('data.selectedBaseline')}
            value={suggestedBaselineId ? `#${suggestedBaselineId}` : t('data.notSelected')}
            detail={t('data.matchingDatasets', { count: formatNumber(filteredDatasets.length) })}
          />
          <MetricTile
            icon={<BarChart3 className="h-4 w-4" />}
            label={t('data.previewResult')}
            value={previewDatasetId ? `#${previewDatasetId}` : t('common.none')}
            detail={t('data.savedResults', {
              count: formatNumber(sourceFilteredDatasets.length),
            })}
          />
        </div>

        <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <WorkflowStepper
            isConfigured={!isConfigLoading}
            baselineReady={baselineReady}
            monitoringComplete={monitoringComplete}
            catalogReady={Boolean(metadataRegistrationStatus)}
            hasVisualization={Boolean(inlinePreviewPlot)}
            isActiveProcessing={isActiveProcessing}
            hasError={state.status === 'error'}
          />
          <div className="self-start">
            <DeploymentStatusCard compact />
          </div>
        </div>

        {metadataRegistrationStatus && (
          <div className="rounded-md border border-info-border bg-info-bg px-3 py-2 text-sm text-info-text">
            {metadataRegistrationStatus}
          </div>
        )}

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-5">
            <Card className="border-border/60">
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Settings2 className="h-5 w-5" />
                    {t('data.configurationSet')}
                  </CardTitle>
                  <CardDescription>{t('data.configurationSetDescription')}</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={onEditConfig}>
                  {t('data.updateConfiguration')}
                </Button>
              </CardHeader>
              <CardContent>
                {isConfigLoading ? (
                  <p className="text-sm text-muted-foreground">{t('data.loadingConfiguration')}</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <ConfigValue
                      label={t('data.optimizer')}
                      value={config?.optimizer ?? DEFAULT_CONFIG.optimizer}
                    />
                    <ConfigValue
                      label={t('data.alpha')}
                      value={config?.alpha ?? DEFAULT_CONFIG.alpha}
                    />
                    <ConfigValue
                      label={t('data.initialGamma')}
                      value={config?.gamma0 ?? DEFAULT_CONFIG.gamma0}
                    />
                    <ConfigValue
                      label={t('data.endMetadata')}
                      value={config?.end_meta ?? DEFAULT_CONFIG.end_meta}
                    />
                    <ConfigValue
                      label={t('data.startFeature')}
                      value={config?.start_dim ?? DEFAULT_CONFIG.start_dim}
                    />
                    <ConfigValue
                      label={t('data.endFeature')}
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
                  {t('data.uploadData')}
                </CardTitle>
                <CardDescription>{t('data.uploadDataDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="combined" className="space-y-4">
                  <TabsList className="grid h-auto w-full grid-cols-2 rounded-lg">
                    <TabsTrigger value="combined" className="gap-2 py-2">
                      <Scissors className="h-4 w-4" />
                      {t('data.combinedCsv')}
                    </TabsTrigger>
                    <TabsTrigger value="two-file" className="gap-2 py-2">
                      <Upload className="h-4 w-4" />
                      {t('data.baselineMonitoring')}
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="combined" className="mt-0">
                    <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(280px,0.8fr)_minmax(420px,1.2fr)]">
                      <section className="space-y-4 rounded-lg border border-border bg-surface/50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h2 className="text-base font-semibold">
                              {t('data.combinedSourceFile')}
                            </h2>
                            <p className="text-xs text-muted-foreground">
                              {t('data.combinedSourceFileDescription')}
                            </p>
                          </div>
                          <Badge variant={combinedValidation?.valid ? 'success' : 'outline'}>
                            {combinedValidation?.valid ? t('data.ready') : t('data.csv')}
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
                          validatingLabel={t('data.validatingCombined')}
                          successLabel={t('data.combinedValidationPassed')}
                          headerLimit={8}
                        />
                      </section>

                      <section className="space-y-4 rounded-lg border border-border bg-surface/50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h2 className="text-base font-semibold">{t('data.splitRules')}</h2>
                          <Badge variant="info">{combinedRangeType}</Badge>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                          <div className="grid gap-2">
                            <label className="text-sm font-medium" htmlFor="combined-split-column">
                              {t('data.splitColumn')}
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
                              <option value="">{t('data.selectColumn')}</option>
                              {combinedValidation?.headers.map((header) => (
                                <option key={header} value={header}>
                                  {header}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid gap-2">
                            <label className="text-sm font-medium" htmlFor="combined-range-type">
                              {t('data.rangeType')}
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
                              <option value="datetime">{t('data.datetimeRange')}</option>
                              <option value="number">{t('data.numberRange')}</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <RangeInput
                            id="combined-baseline-start"
                            label={t('data.baselineStart')}
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
                            label={t('data.baselineStop')}
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
                            label={t('data.monitoringStart')}
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
                            label={t('data.monitoringStop')}
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

                        <div className="grid gap-2 sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)]">
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
                            {t('data.previewSplit')}
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
                                {t('data.processingCombined')}
                              </>
                            ) : (
                              t('data.splitAndUpload')
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
                              {t('data.baseline')}
                            </h2>
                            <p className="text-xs text-muted-foreground">
                              {t('data.uploadBaselineFirst')}
                            </p>
                          </div>
                          <Badge variant={baselineReady ? 'success' : 'outline'}>
                            {baselineReady ? t('data.complete') : t('data.step1')}
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
                          validatingLabel={t('data.validatingBaseline')}
                          successLabel={t('data.baselineValidationPassed')}
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
                                {t('data.processingBaseline')}
                              </>
                            ) : (
                              t('data.uploadBaselineCsv')
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
                              {t('data.monitoring')}
                            </h2>
                            <p className="text-xs text-muted-foreground">
                              {t('data.compareMonitoring')}
                            </p>
                          </div>
                          <Badge variant={monitoringComplete ? 'success' : 'outline'}>
                            {monitoringComplete ? t('data.complete') : t('data.step2')}
                          </Badge>
                        </div>

                        <div className="space-y-3 rounded-md border border-input bg-background/60 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <label className="text-sm font-medium">
                              {t('data.baselineDataset')}
                            </label>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setUseManualBaselineId((prev) => !prev)}
                            >
                              {useManualBaselineId
                                ? t('data.useDatasetSelector')
                                : t('data.manualId')}
                            </Button>
                          </div>

                          {useManualBaselineId ? (
                            <Input
                              value={manualBaselineId}
                              onChange={(event) => setManualBaselineId(event.target.value)}
                              placeholder={t('data.enterBaselineId')}
                            />
                          ) : (
                            <>
                              <Input
                                value={datasetSearch}
                                onChange={(event) => setDatasetSearch(event.target.value)}
                                placeholder={t('data.searchDatasetPlaceholder')}
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
                                  title={t('data.sortOrder')}
                                >
                                  <option value="newest">{t('data.newestFirst')}</option>
                                  <option value="oldest">{t('data.oldestFirst')}</option>
                                  <option value="id-asc">{t('data.idAscending')}</option>
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
                                <option value="">{t('common.selectDataset')}</option>
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
                              {t('data.effectiveBaselineId')}:{' '}
                              {suggestedBaselineId ?? t('data.notSelected')}
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
                          validatingLabel={t('data.validatingMonitoring')}
                          successLabel={t('data.monitoringValidationPassed')}
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
                                {t('data.processingMonitoring')}
                              </>
                            ) : (
                              t('data.uploadMonitoringCsv')
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
                    {t('data.resultsVisualization')}
                  </CardTitle>
                  <CardDescription>{t('data.previewDescription')}</CardDescription>
                </div>
                <Badge variant={previewDatasetId ? 'info' : 'outline'}>
                  {previewDatasetId ? `#${previewDatasetId}` : t('command.noDatasetSelected')}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <ConfigValue
                      label={t('data.baselinePoints')}
                      value={inlineBaselineData?.dinsight_x.length ?? 0}
                    />
                    <ConfigValue
                      label={t('data.monitoringPoints')}
                      value={inlineMonitoringData?.dinsight_x.length ?? 0}
                    />
                    <ConfigValue label={t('data.sampleCap')} value="20k" />
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
                      {t('data.latest')}
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
                      {t('data.saved')}
                    </Button>
                  </div>
                </div>

                <ChartFrame
                  title={t('data.coordinatePreview')}
                  description={t('data.coordinatePreviewDescription')}
                  stats={
                    <>
                      <ChartStat
                        label={t('common.dataset')}
                        value={inlinePreviewDatasetId ? `#${inlinePreviewDatasetId}` : '—'}
                      />
                      <ChartStat
                        label={t('common.baseline')}
                        value={formatNumber(inlineBaselineData?.dinsight_x.length ?? 0)}
                        tone="info"
                      />
                      <ChartStat
                        label={t('common.monitoring')}
                        value={formatNumber(inlineMonitoringData?.dinsight_x.length ?? 0)}
                        tone={inlineMonitoringData?.dinsight_x.length ? 'danger' : 'neutral'}
                      />
                    </>
                  }
                  bodyClassName="p-2"
                >
                  {!inlinePreviewDatasetId ? (
                    <EmptyState
                      title={t('data.noProcessedResult')}
                      description={t('data.noProcessedResultDescription')}
                    />
                  ) : isInlineLoadingBaseline || isInlineLoadingMonitoring ? (
                    <EmptyState
                      title={t('data.loadingPreview')}
                      description={t('data.loadingPreviewDescription')}
                    />
                  ) : inlineBaselineError ? (
                    <EmptyState
                      title={t('data.previewUnavailable')}
                      description={inlineBaselineError}
                    />
                  ) : inlinePreviewPlot ? (
                    <div className="h-[250px]">
                      <EChartsCanvas
                        key={inlinePreviewPlot.revision}
                        option={inlinePreviewPlot.option}
                        style={{ width: '100%', height: '100%' }}
                      />
                    </div>
                  ) : (
                    <EmptyState
                      title={t('data.noCoordinates')}
                      description={t('data.noCoordinatesDescription')}
                    />
                  )}
                  {inlineMonitoringError && (
                    <p className="mt-2 px-2 text-xs text-muted-foreground">
                      {inlineMonitoringError}
                    </p>
                  )}
                </ChartFrame>
              </CardContent>
            </Card>

            {monitoringComplete && (
              <Card className="border-success-border bg-success-bg/40">
                <CardHeader>
                  <CardTitle className="text-lg text-success-text">
                    {t('data.readyForLive')}
                  </CardTitle>
                  <CardDescription>{t('data.readyForLiveDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p>
                    {t('data.generatedBaselineId')}:{' '}
                    <strong>
                      #{state.dinsightId ?? suggestedBaselineId ?? t('common.notAvailable')}
                    </strong>
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Button asChild>
                      <Link href="/dashboard/live">
                        {t('data.openLiveMonitor')}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="outline" onClick={() => void refetch()}>
                      {t('data.refreshDatasets')}
                    </Button>
                    <Button variant="outline" onClick={resetWorkflow}>
                      {t('data.resetFlow')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <aside className="min-w-0 space-y-5 xl:sticky xl:top-5 xl:self-start">
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base">{t('data.datasetContext')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <SideFact
                  label={t('data.effectiveBaseline')}
                  value={suggestedBaselineId ?? t('data.notSelected')}
                />
                <SideFact
                  label={t('data.generatedDatasetId')}
                  value={state.dinsightId ?? t('common.none')}
                />
                <SideFact
                  label={t('data.savedResult')}
                  value={formatNumber(sourceFilteredDatasets.length)}
                />
                <SideFact
                  label={t('data.matchingTargets')}
                  value={formatNumber(filteredDatasets.length)}
                />
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
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="h-4 w-4" />
                  {t('data.datasetCatalog')}
                </CardTitle>
                <CardDescription>{t('data.catalogDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <SideFact
                    label={t('data.savedResult')}
                    value={formatNumber(sourceFilteredDatasets.length)}
                  />
                  <SideFact
                    label={t('data.matchingSource')}
                    value={formatNumber(filteredDatasets.length)}
                  />
                </div>
                <Button className="w-full justify-start" onClick={() => setIsCatalogOpen(true)}>
                  <Database className="mr-2 h-4 w-4" />
                  {t('dashboard.openCatalog')}
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
  const { t } = useI18n();
  const steps = [
    { label: t('common.configure'), complete: isConfigured, active: !baselineReady },
    { label: t('common.upload'), complete: baselineReady, active: isActiveProcessing },
    {
      label: t('common.monitoring'),
      complete: monitoringComplete,
      active: baselineReady && !monitoringComplete,
    },
    {
      label: t('common.catalog'),
      complete: catalogReady,
      active: monitoringComplete && !catalogReady,
    },
    {
      label: t('data.resultsVisualization'),
      complete: hasVisualization,
      active: catalogReady && !hasVisualization,
    },
    { label: t('nav.liveMonitor'), complete: monitoringComplete, active: monitoringComplete },
  ];

  return (
    <Card className="border-border/60">
      <CardContent className="p-3">
        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(128px,1fr))]">
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
                <div className="text-sm font-medium leading-tight text-fg">{step.label}</div>
                <div className="text-[11px] text-muted-foreground">
                  {step.complete
                    ? t('data.done')
                    : step.active
                      ? t('data.current')
                      : t('data.pending')}
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
  const { t, formatNumber } = useI18n();

  return (
    <div className="space-y-3 rounded-md border border-border bg-background/60 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-fg">{t('data.splitPreview')}</span>
        <span className="text-muted-foreground">
          {t('data.totalRows', { count: formatNumber(preview.totalRows) })}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ConfigValue label={t('data.baselineRows')} value={formatNumber(preview.baselineRows)} />
        <ConfigValue
          label={t('data.monitoringRows')}
          value={formatNumber(preview.monitoringRows)}
        />
        <ConfigValue label={t('data.unmatchedRows')} value={formatNumber(preview.unmatchedRows)} />
        <ConfigValue label={t('data.overlapRows')} value={formatNumber(preview.overlapRows)} />
      </div>
      <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
        <div>
          {t('data.columnRange')}:{' '}
          <span className="font-medium text-fg">
            {preview.minValue || t('common.notAvailable')} to{' '}
            {preview.maxValue || t('common.notAvailable')}
          </span>
        </div>
        <div>
          {t('data.fileOrder')}:{' '}
          <span className="font-medium text-fg">
            {preview.firstValue || t('common.notAvailable')} to{' '}
            {preview.lastValue || t('common.notAvailable')}
          </span>
        </div>
      </div>
      {preview.overlapRows > 0 && (
        <p className="flex items-start gap-2 text-warning-text">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t('data.overlapWarning', { count: formatNumber(preview.overlapRows) })}
        </p>
      )}
      {preview.unmatchedRows > 0 && (
        <p className="text-muted-foreground">
          {t('data.unmatchedWarning', { count: formatNumber(preview.unmatchedRows) })}
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
  const { t } = useI18n();
  const action = !hasConfig
    ? {
        title: t('data.confirmConfiguration'),
        description: t('data.confirmConfigurationDescription'),
        command: null,
      }
    : !baselineReady
      ? {
          title: t('data.uploadBaselineDataset'),
          description: t('data.uploadBaselineDatasetDescription'),
          command: null,
        }
      : !monitoringComplete
        ? {
            title: t('data.uploadMonitoringData'),
            description: t('data.uploadMonitoringDataDescription'),
            command: null,
          }
        : !hasMetadataStatus
          ? {
              title: t('data.reviewMetadata'),
              description: t('data.reviewMetadataDescription'),
              command: 'catalog' as const,
            }
          : !hasVisualization
            ? {
                title: t('data.openResultVisualization'),
                description: t('data.openResultVisualizationDescription'),
                command: 'results' as const,
              }
            : {
                title: t('data.continueLiveMonitoring'),
                description: t('data.continueLiveMonitoringDescription'),
                command: 'live' as const,
              };

  return (
    <Card className="border-info-border bg-info-bg/40">
      <CardHeader>
        <CardTitle className="text-base text-info-text">{t('data.nextStep')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="font-semibold text-fg">{action.title}</div>
        <p className="text-muted-foreground">{action.description}</p>
        {action.command === 'catalog' && (
          <Button variant="outline" className="w-full justify-start" onClick={onOpenCatalog}>
            <Database className="mr-2 h-4 w-4" />
            {t('dashboard.openCatalog')}
          </Button>
        )}
        {action.command === 'results' && (
          <Button variant="outline" className="w-full justify-start" onClick={onOpenResults}>
            <BarChart3 className="mr-2 h-4 w-4" />
            {t('data.openVisualization')}
          </Button>
        )}
        {action.command === 'live' && (
          <Button asChild variant="outline" className="w-full justify-start">
            <Link href="/dashboard/live">
              <ArrowRight className="mr-2 h-4 w-4" />
              {t('data.openLiveMonitor')}
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
  const { t, formatNumber } = useI18n();

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
  const { t, formatNumber } = useI18n();

  return (
    <div className="space-y-3 rounded-md border border-input bg-background/60 p-3 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground">{t('data.selectedFile')}</span>
        <span className="min-w-0 max-w-[70%] truncate text-right font-medium text-foreground">
          {file?.name ?? t('data.selectedFileNone')}
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
                  {validation?.valid ? t('data.valid') : t('data.needsAttention')}
                </Badge>
                <span className="text-muted-foreground">
                  {t('data.fileSizePreview', {
                    size: validation?.fileSizeMb ?? 0,
                    rows: t('data.previewRows', {
                      count: formatNumber(validation?.previewRows ?? 0),
                    }),
                  })}
                </span>
              </div>

              {validation?.headers.length ? (
                <p className="truncate text-muted-foreground">
                  <strong className="text-fg">{t('data.headers')}:</strong>{' '}
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
  const { t, formatDate } = useI18n();
  const s = dataset.source;
  const isAuto = s.source === 'auto';
  const isManual = s.source === 'manual';

  // Primary line: device name (auto) OR "Manual upload" OR a fallback
  // for legacy rows where source attribution is unknown.
  const primary = isAuto
    ? (s.deviceName ?? s.deviceSlug ?? t('data.iotHubDevice'))
    : isManual
      ? t('data.manualUpload')
      : `Dataset #${dataset.dinsight_id}`;

  // Secondary line: original filename + ingested time + internal ID.
  const secondaryParts: string[] = [];
  if (s.originalFileName) secondaryParts.push(s.originalFileName);
  if (s.createdAt) secondaryParts.push(formatRelativeTime(s.createdAt, t, formatDate));
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
              {s.iotHubDeviceId ? ` · ${t('data.deviceId')} ${s.iotHubDeviceId}` : ''}
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
          {isAuto ? t('data.auto') : isManual ? t('common.manual') : t('data.unknown')}
        </span>
      </div>
    </div>
  );
}

// formatRelativeTime returns a compact human-friendly relative time
// for the source-card secondary line. Falls back to the raw ISO
// string when the input doesn't parse — the picker never throws.
function formatRelativeTime(
  iso: string,
  t: (key: string, values?: Record<string, string | number | boolean | null | undefined>) => string,
  formatDate: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) => string
): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('health.justNow');
  if (minutes < 60) return t('health.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('health.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('health.daysAgo', { count: days });
  return formatDate(ms);
}
