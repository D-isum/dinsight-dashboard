'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Calendar,
  Database,
  Download,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldQuestion,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CompatibilityCheckDialog } from '@/components/datasets/compatibility-check-dialog';
import { DatasetSourceSelect } from '@/components/datasets/dataset-source-select';
import { EditMetadataDialog } from '@/components/datasets/edit-metadata-dialog';
import { RegisterMetadataDialog } from '@/components/datasets/register-metadata-dialog';
import { ValidationRulesPanel } from '@/components/datasets/validation-rules-panel';
import { usePermission } from '@/components/auth/require-permission';
import { ChartEmptyState, ChartFrame, ChartStat } from '@/components/charts/chart-frame';
import { EChartsCanvas } from '@/components/charts/echarts-canvas';
import { Actions } from '@/lib/permissions';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { createDinsightPreviewPlot } from '@/lib/dinsight-preview-plot';
import { useDatasetDiscovery } from '@/hooks/useDatasetDiscovery';
import { useDatasetSourceFilter } from '@/hooks/useDatasetSourceFilter';
import { useBaselineMonitoringData } from '@/hooks/useBaselineMonitoringData';
import type { DinsightDatasetSource } from '@/lib/dataset-normalizers';
import { usePlotTheme } from '@/lib/plot-theme';
import { cn } from '@/utils/cn';

// Catalog browses the dataset metadata + lineage + validation that
// upload + processing pipelines record server-side.

interface DatasetMetadataItem {
  id: number;
  dataset_id: number;
  dataset_type: string;
  name: string;
  description?: string;
  tags?: string[];
  total_records?: number;
  data_quality_score?: number;
  processing_stage?: string;
  validation_status?: string;
  sampling_frequency?: string;
  version?: string;
  parent_dataset_id?: number;
  source_hash?: string;
  used_in_analyses?: number;
  created_at: string;
}

type CatalogDatasetItem = DatasetMetadataItem & {
  has_metadata: boolean;
};

export interface DatasetCatalogProps {
  variant?: 'page' | 'modal';
}

export function DatasetCatalog({ variant = 'page' }: DatasetCatalogProps) {
  const { currentOrg } = useAuth();
  const plotTheme = usePlotTheme();
  const isModal = variant === 'modal';
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [previewDatasetId, setPreviewDatasetId] = useState<number | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerInitialDatasetId, setRegisterInitialDatasetId] = useState<number | null>(null);
  const [deleteDatasetId, setDeleteDatasetId] = useState('');
  const [pendingDeleteDatasetId, setPendingDeleteDatasetId] = useState<number | null>(null);
  const [deleteFeedback, setDeleteFeedback] = useState<string | null>(null);
  const [exportDatasetId, setExportDatasetId] = useState('');
  const [exportingDatasetId, setExportingDatasetId] = useState<number | null>(null);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const canCreate = usePermission(Actions.DatasetCreate);
  const canDelete = usePermission(Actions.DatasetDelete);
  const queryClient = useQueryClient();

  // Pull source attribution (device / file / created_at) from the
  // /dinsight list endpoint and key it by dinsight_id so we can show
  // a Source column on the metadata table. Each metadata row's
  // dataset_id corresponds to dinsight_data.id — that's the join key.
  const { datasets: dinsightSummaries, isLoading: isLoadingDinsightSummaries } =
    useDatasetDiscovery({
      queryKey: ['catalog', 'dinsight-source-map'],
      refetchInterval: 60_000,
      staleTime: 30_000,
    });
  const {
    groups: datasetSourceGroups,
    selectedSourceKey,
    setSelectedSourceKey,
    filteredDatasetIds,
  } = useDatasetSourceFilter(dinsightSummaries);
  const sourceByDinsightId = useMemo(() => {
    const map = new Map<number, DinsightDatasetSource>();
    for (const summary of dinsightSummaries) {
      map.set(summary.dinsight_id, summary.source);
    }
    return map;
  }, [dinsightSummaries]);

  useEffect(() => {
    setSelectedDatasetId(null);
  }, [selectedSourceKey]);

  const listQuery = useQuery<DatasetMetadataItem[]>({
    queryKey: ['datasets', 'metadata', currentOrg?.id, typeFilter],
    queryFn: async () => {
      const res = await api.datasets.list({
        limit: 100,
        dataset_type: typeFilter || undefined,
      });
      return (res?.data?.data?.datasets ?? []) as DatasetMetadataItem[];
    },
    enabled: Boolean(currentOrg?.id),
  });

  // Pull every dataset (regardless of typeFilter) for the
  // "already-has-metadata" exclusion in the register dialog. Same
  // query key the dialog could use, but resolving it here keeps the
  // dialog's prop interface simple.
  const allDatasetsQuery = useQuery<DatasetMetadataItem[]>({
    queryKey: ['datasets', 'metadata', currentOrg?.id, 'all'],
    queryFn: async () => {
      const res = await api.datasets.list({ limit: 500 });
      return (res?.data?.data?.datasets ?? []) as DatasetMetadataItem[];
    },
    enabled: Boolean(currentOrg?.id),
  });

  const deleteMutation = useMutation({
    mutationFn: (datasetId: number) => api.datasets.delete(datasetId),
    onSuccess: (_data, datasetId) => {
      setDeleteDatasetId('');
      setPendingDeleteDatasetId(null);
      setDeleteFeedback(`Dataset #${datasetId} deleted.`);
      setSelectedDatasetId((current) => (current === datasetId ? null : current));
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      queryClient.invalidateQueries({ queryKey: ['available-dinsight-ids'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        'Unable to delete dataset.';
      setDeleteFeedback(message);
    },
  });

  const requestDelete = (datasetId: number) => {
    if (!Number.isInteger(datasetId) || datasetId <= 0) {
      setDeleteFeedback('Enter a valid dataset ID.');
      return;
    }
    setDeleteFeedback(null);
    setPendingDeleteDatasetId(datasetId);
  };

  const confirmDelete = () => {
    if (pendingDeleteDatasetId == null) {
      return;
    }
    deleteMutation.mutate(pendingDeleteDatasetId);
  };

  const requestManualDelete = () => {
    const datasetId = Number(deleteDatasetId.trim());
    requestDelete(datasetId);
  };

  const requestManualExport = () => {
    const datasetId = Number(exportDatasetId.trim());
    void requestExport(datasetId);
  };

  const requestExport = async (datasetId: number) => {
    if (!Number.isInteger(datasetId) || datasetId <= 0) {
      setExportFeedback('Select a valid dataset ID before exporting.');
      return;
    }

    setExportingDatasetId(datasetId);
    setExportFeedback(null);

    try {
      const response = await api.analysis.exportDinsight(datasetId);
      const blob =
        response.data instanceof Blob
          ? response.data
          : new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const disposition = String(response.headers['content-disposition'] ?? '');
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const filename = filenameMatch?.[1] ?? `dinsight-${datasetId}-baseline-and-monitoring.csv`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportFeedback(`Dataset #${datasetId} export started.`);
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
      setExportFeedback(message);
    } finally {
      setExportingDatasetId(null);
    }
  };

  const catalogItems = useMemo<CatalogDatasetItem[]>(() => {
    const metadataRows: CatalogDatasetItem[] = (listQuery.data ?? []).map((item) => ({
      ...item,
      has_metadata: true,
    }));

    if (typeFilter) {
      return metadataRows;
    }

    const metadataDatasetIds = new Set(
      (allDatasetsQuery.data ?? listQuery.data ?? []).map((item) => item.dataset_id)
    );
    const unregisteredRows = dinsightSummaries
      .filter((summary) => !metadataDatasetIds.has(summary.dinsight_id))
      .map<CatalogDatasetItem>((summary) => {
        const source = summary.source;
        const name =
          source.originalFileName ??
          source.deviceName ??
          source.deviceSlug ??
          summary.name ??
          `Dataset #${summary.dinsight_id}`;
        return {
          id: -summary.dinsight_id,
          dataset_id: summary.dinsight_id,
          dataset_type: 'unregistered',
          name,
          description: 'Processed dataset without catalog metadata.',
          tags: [],
          total_records: undefined,
          data_quality_score: undefined,
          processing_stage: undefined,
          validation_status: undefined,
          sampling_frequency: undefined,
          version: undefined,
          parent_dataset_id: undefined,
          source_hash: undefined,
          used_in_analyses: undefined,
          created_at: source.createdAt ?? '',
          has_metadata: false,
        };
      });

    return [...metadataRows, ...unregisteredRows];
  }, [allDatasetsQuery.data, dinsightSummaries, listQuery.data, typeFilter]);

  const filtered = useMemo(() => {
    let items = catalogItems.filter((item) => filteredDatasetIds.includes(item.dataset_id));
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter((item) => {
        const src = sourceByDinsightId.get(item.dataset_id);
        return (
          item.name.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          item.tags?.some((t) => t.toLowerCase().includes(q)) ||
          String(item.dataset_id).includes(q) ||
          src?.deviceName?.toLowerCase().includes(q) ||
          src?.deviceSlug?.toLowerCase().includes(q) ||
          src?.originalFileName?.toLowerCase().includes(q)
        );
      });
    }
    return items;
  }, [catalogItems, filteredDatasetIds, search, sourceByDinsightId]);

  useEffect(() => {
    if (!isModal) {
      return;
    }
    if (filtered.length === 0) {
      setPreviewDatasetId(null);
      return;
    }
    if (
      previewDatasetId == null ||
      !filtered.some((item) => item.dataset_id === previewDatasetId)
    ) {
      setPreviewDatasetId(filtered[0].dataset_id);
    }
  }, [filtered, isModal, previewDatasetId]);

  const {
    baselineData: previewBaselineData,
    monitoringData: previewMonitoringData,
    isLoadingBaseline: isLoadingPreviewBaseline,
    isLoadingMonitoring: isLoadingPreviewMonitoring,
    baselineError: previewBaselineError,
    monitoringError: previewMonitoringError,
  } = useBaselineMonitoringData({
    dinsightId: isModal ? previewDatasetId : null,
    includeMetadata: true,
    monitoringMode: 'coordinates',
    maxPoints: 20_000,
  });

  const previewPlot = useMemo(
    () =>
      createDinsightPreviewPlot(previewBaselineData, previewMonitoringData, plotTheme, {
        compact: true,
        datasetId: previewDatasetId,
        modeBar: false,
      }),
    [plotTheme, previewBaselineData, previewDatasetId, previewMonitoringData]
  );
  const previewItem = filtered.find((item) => item.dataset_id === previewDatasetId) ?? null;
  const catalogColumnCount = canDelete ? 9 : 8;

  return (
    <div className={isModal ? 'space-y-4' : 'space-y-6'}>
      <Card className="border-border/60">
        {!isModal && (
          <CardHeader>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Database className="h-6 w-6" />
                  Dataset catalog
                </CardTitle>
                <CardDescription>
                  Browse datasets registered for this organization with their lineage and validation
                  status. Mutations happen in the ingestion + processing pipelines.
                </CardDescription>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {canCreate && (
                  <Button
                    onClick={() => {
                      setRegisterInitialDatasetId(null);
                      setRegisterOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Register metadata
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <Link href="/dashboard/data">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Data Ingestion
                  </Link>
                </Button>
              </div>
            </div>
          </CardHeader>
        )}
        <CardContent className={cn(isModal && 'p-4')}>
          <div className="grid gap-3 xl:grid-cols-[minmax(220px,1fr)_auto_auto_auto_auto] xl:items-center">
            <Input
              placeholder="Search by name, description, or tag"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
            >
              <option value="">All types</option>
              <option value="baseline">Baseline</option>
              <option value="comparison">Comparison</option>
              <option value="monitoring">Monitoring</option>
            </select>
            <DatasetSourceSelect
              groups={datasetSourceGroups}
              selectedSourceKey={selectedSourceKey}
              onChange={setSelectedSourceKey}
              className="rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
            />
            {catalogItems.length > 0 && (
              <span className="whitespace-nowrap text-sm text-fg-muted">
                {filtered.length} of {catalogItems.length} datasets
              </span>
            )}
            {isModal && canCreate && (
              <Button
                className="xl:justify-self-end"
                onClick={() => {
                  setRegisterInitialDatasetId(null);
                  setRegisterOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Register metadata
              </Button>
            )}
          </div>
          <div className="mt-4 grid gap-3 border-t border-border pt-4 lg:grid-cols-2">
            <div className="rounded-md border border-border bg-surface-muted/35 p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
                Export dataset
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Input
                  inputMode="numeric"
                  placeholder="Dataset ID"
                  value={exportDatasetId}
                  onChange={(event) => setExportDatasetId(event.target.value)}
                  className="w-36"
                />
                <Button
                  variant="outline"
                  onClick={requestManualExport}
                  disabled={exportingDatasetId != null}
                >
                  {exportingDatasetId != null ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Export by ID
                </Button>
                {exportFeedback && (
                  <span className="min-w-0 text-sm text-fg-muted">{exportFeedback}</span>
                )}
              </div>
            </div>
            {canDelete && (
              <div className="rounded-md border border-danger-border bg-danger-bg/45 p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-danger-text">
                  Delete dataset
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Input
                    inputMode="numeric"
                    placeholder="Dataset ID"
                    value={deleteDatasetId}
                    onChange={(event) => setDeleteDatasetId(event.target.value)}
                    className="w-36"
                  />
                  <Button
                    variant="destructive"
                    onClick={requestManualDelete}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Delete by ID
                  </Button>
                  {deleteFeedback && (
                    <span className="min-w-0 text-sm text-fg-muted">{deleteFeedback}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="min-w-0 border-border/60">
          <CardContent className="p-0">
            <Table className="min-w-[980px] table-fixed">
              <colgroup>
                <col className="w-[220px]" />
                <col className="w-[150px]" />
                <col className="w-[120px]" />
                <col className="w-[96px]" />
                <col className="w-[120px]" />
                <col className="w-[96px]" />
                <col className="w-[112px]" />
                <col className="w-[64px]" />
                {canDelete && <col className="w-[64px]" />}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead>Validation</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead className="w-16 text-right">Export</TableHead>
                  {canDelete && <TableHead className="w-16 text-right">Delete</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isLoading || isLoadingDinsightSummaries ? (
                  <TableLoading message="Loading dataset catalog" rowSpan={catalogColumnCount} />
                ) : filtered.length === 0 ? (
                  <TableEmpty
                    rowSpan={catalogColumnCount}
                    message={
                      search || typeFilter
                        ? 'No datasets match the current filters.'
                        : 'No datasets registered yet. Upload one from the Data Ingestion page.'
                    }
                  />
                ) : (
                  filtered.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-surface-muted"
                      onClick={() => {
                        setPreviewDatasetId(item.dataset_id);
                        setSelectedDatasetId(item.dataset_id);
                      }}
                    >
                      <TableCell className="min-w-0">
                        <div className="truncate font-medium text-fg" title={item.name}>
                          {item.name}
                        </div>
                        {item.description && (
                          <div className="truncate text-xs text-fg-muted" title={item.description}>
                            {item.description}
                          </div>
                        )}
                        {!item.has_metadata && (
                          <div className="mt-1 line-clamp-2 text-xs text-warning-text">
                            Register metadata to unlock curation, validation, and compatibility
                            workflows.
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <CatalogSourceCell source={sourceByDinsightId.get(item.dataset_id)} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.has_metadata ? 'secondary' : 'warning'}>
                          {item.has_metadata ? item.dataset_type : 'No metadata'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <QualityBadge score={item.data_quality_score} />
                      </TableCell>
                      <TableCell className="text-sm">
                        <ValidationBadge status={item.validation_status} />
                      </TableCell>
                      <TableCell className="text-sm text-fg-muted">
                        {item.total_records?.toLocaleString() ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm text-fg-muted">
                        {item.created_at
                          ? new Date(item.created_at).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Export dataset ${item.dataset_id}`}
                          disabled={exportingDatasetId === item.dataset_id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void requestExport(item.dataset_id);
                          }}
                        >
                          {exportingDatasetId === item.dataset_id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                      {canDelete && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger-text hover:bg-danger-bg hover:text-danger-text"
                            aria-label={`Delete dataset ${item.dataset_id}`}
                            disabled={deleteMutation.isPending}
                            onClick={(event) => {
                              event.stopPropagation();
                              requestDelete(item.dataset_id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {isModal && (
          <ChartFrame
            title="Dataset preview"
            description="Sampled baseline and monitoring coordinates for the catalog selection."
            className="self-start"
            stats={
              <>
                <ChartStat
                  label="Dataset"
                  value={previewDatasetId ? `#${previewDatasetId}` : '—'}
                />
                <ChartStat
                  label="Baseline"
                  value={(previewBaselineData?.dinsight_x.length ?? 0).toLocaleString()}
                  tone="info"
                />
                <ChartStat
                  label="Monitoring"
                  value={(previewMonitoringData?.dinsight_x.length ?? 0).toLocaleString()}
                  tone={previewMonitoringData?.dinsight_x.length ? 'danger' : 'neutral'}
                />
              </>
            }
            actions={
              <select
                value={previewDatasetId != null ? String(previewDatasetId) : ''}
                onChange={(event) =>
                  setPreviewDatasetId(event.target.value ? Number(event.target.value) : null)
                }
                className="max-w-[220px] rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="">Select dataset</option>
                {filtered.map((item) => (
                  <option key={item.dataset_id} value={item.dataset_id}>
                    #{item.dataset_id} - {item.name}
                  </option>
                ))}
              </select>
            }
            bodyClassName="p-2"
          >
            <div className="space-y-3">
              {previewItem && (
                <div className="rounded-md border border-border bg-surface-muted/50 px-3 py-2 text-xs">
                  <div className="truncate font-semibold text-fg" title={previewItem.name}>
                    {previewItem.name}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-fg-muted">
                    <span>
                      {previewItem.has_metadata ? previewItem.dataset_type : 'No metadata'}
                    </span>
                    <span>•</span>
                    <span>
                      {sourceByDinsightId.get(previewItem.dataset_id)?.source ?? 'Manual upload'}
                    </span>
                  </div>
                </div>
              )}

              {!previewDatasetId ? (
                <ChartEmptyState
                  title="No dataset selected"
                  description="Choose a catalog row or use the selector above to preview coordinates."
                />
              ) : isLoadingPreviewBaseline || isLoadingPreviewMonitoring ? (
                <ChartEmptyState
                  title="Loading preview"
                  description="Fetching sampled baseline and monitoring coordinates."
                />
              ) : previewBaselineError ? (
                <ChartEmptyState title="Preview unavailable" description={previewBaselineError} />
              ) : previewPlot ? (
                <div className="h-[280px]">
                  <EChartsCanvas
                    key={previewPlot.revision}
                    option={previewPlot.option}
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              ) : (
                <ChartEmptyState
                  title="No coordinates available"
                  description="This dataset has no processed baseline coordinates yet."
                />
              )}
              {previewMonitoringError && (
                <p className="px-1 text-xs text-fg-muted">{previewMonitoringError}</p>
              )}
              {previewDatasetId && (
                <div className="flex flex-wrap gap-2 px-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void requestExport(previewDatasetId)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedDatasetId(previewDatasetId)}
                  >
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Details
                  </Button>
                </div>
              )}
            </div>
          </ChartFrame>
        )}
      </div>

      {selectedDatasetId !== null && (
        <DetailDrawer
          datasetId={selectedDatasetId}
          onClose={() => setSelectedDatasetId(null)}
          onExport={() => void requestExport(selectedDatasetId)}
          onDelete={canDelete ? () => requestDelete(selectedDatasetId) : undefined}
          onRegisterMetadata={
            canCreate
              ? () => {
                  setRegisterInitialDatasetId(selectedDatasetId);
                  setRegisterOpen(true);
                }
              : undefined
          }
          isExporting={exportingDatasetId === selectedDatasetId}
          isDeleting={deleteMutation.isPending && pendingDeleteDatasetId === selectedDatasetId}
        />
      )}

      <RegisterMetadataDialog
        open={registerOpen}
        onOpenChange={(open) => {
          setRegisterOpen(open);
          if (!open) {
            setRegisterInitialDatasetId(null);
          }
        }}
        initialDatasetId={registerInitialDatasetId}
        excludedDatasetIds={(allDatasetsQuery.data ?? listQuery.data ?? []).map(
          (d) => d.dataset_id
        )}
      />

      <DeleteImpactDialog
        datasetId={pendingDeleteDatasetId}
        open={pendingDeleteDatasetId != null}
        isDeleting={deleteMutation.isPending}
        onCancel={() => setPendingDeleteDatasetId(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function QualityBadge({ score }: { score?: number }) {
  if (score === undefined || score === null) return <span className="text-fg-muted">—</span>;
  if (score >= 90) return <Badge variant="default">{score.toFixed(0)}%</Badge>;
  if (score >= 70) return <Badge variant="secondary">{score.toFixed(0)}%</Badge>;
  return <Badge variant="destructive">{score.toFixed(0)}%</Badge>;
}

function DeleteImpactDialog({
  datasetId,
  open,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  datasetId: number | null;
  open: boolean;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-danger-text">
            <AlertTriangle className="h-5 w-5" />
            Delete dataset #{datasetId ?? 'N/A'}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the processed dataset graph for this organization.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-md border border-danger-border bg-danger-bg p-3 text-sm text-danger-text">
          <div className="font-semibold">Deletion impact</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Baseline DInsight coordinates and metadata</li>
            <li>Monitoring rows and generated monitoring coordinates</li>
            <li>Generated visualization/export records tied to the dataset</li>
            <li>Dataset metadata, lineage, validation results, and analysis comparisons</li>
            <li>Upload file references associated with this dataset</li>
          </ul>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isDeleting}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className="bg-danger text-accent-contrast hover:bg-danger"
          >
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting
              </>
            ) : (
              'Delete dataset'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ValidationBadge({ status }: { status?: string }) {
  if (!status) return <span className="text-fg-muted">—</span>;
  if (status === 'passed') return <Badge variant="default">Passed</Badge>;
  if (status === 'failed') return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

// ---------- Detail drawer ----------

interface DetailDrawerProps {
  datasetId: number;
  onClose: () => void;
  onExport: () => void;
  onDelete?: () => void;
  onRegisterMetadata?: () => void;
  isExporting: boolean;
  isDeleting: boolean;
}

interface DetailMetadata extends DatasetMetadataItem {
  numeric_summary?: Record<string, unknown>;
}

interface LineageRecord {
  id: number;
  source_dataset_id: number;
  target_dataset_id: number;
  transformation_type: string;
  process_name: string;
  process_version?: string;
  status: string;
  records_processed?: number;
  execution_time?: number;
  created_at: string;
}

interface ValidationResult {
  id: number;
  validation_rule_id: number;
  status: string;
  records_checked: number;
  records_passed: number;
  records_failed: number;
  validation_rule?: { name?: string; rule_type?: string };
  created_at: string;
}

function DetailDrawer({
  datasetId,
  onClose,
  onExport,
  onDelete,
  onRegisterMetadata,
  isExporting,
  isDeleting,
}: DetailDrawerProps) {
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [compatibilityOpen, setCompatibilityOpen] = useState(false);
  const canUpdateMetadata = usePermission(Actions.DatasetUpdate);

  const metadataQuery = useQuery<DetailMetadata | null>({
    queryKey: ['dataset', datasetId, 'metadata'],
    queryFn: async () => {
      const res = await api.datasets.getMetadata(datasetId);
      return (res?.data?.data ?? null) as DetailMetadata | null;
    },
  });

  const lineageQuery = useQuery<LineageRecord[]>({
    queryKey: ['dataset', datasetId, 'lineage'],
    queryFn: async () => {
      const res = await api.datasets.getLineage(datasetId);
      const data = res?.data?.data;
      // The endpoint returns a tree shape; flatten the records for display.
      if (Array.isArray(data?.records)) return data.records as LineageRecord[];
      if (Array.isArray(data)) return data as LineageRecord[];
      return [];
    },
  });

  const validationQuery = useQuery<ValidationResult[]>({
    queryKey: ['dataset', datasetId, 'validation'],
    queryFn: async () => {
      const res = await api.datasets.getValidationResults(datasetId);
      return (res?.data?.data?.results ?? res?.data?.data ?? []) as ValidationResult[];
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-scrim" onClick={onClose}>
      <div
        className="h-full w-full max-w-2xl overflow-y-auto bg-canvas border-l border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-canvas px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-fg">Dataset details</h2>
            <p className="text-xs text-fg-muted">Dataset #{datasetId}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onExport} disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCompatibilityOpen(true)}>
              <ShieldQuestion className="mr-2 h-4 w-4" />
              Check compatibility
            </Button>
            {onDelete && (
              <Button variant="destructive" size="sm" onClick={onDelete} disabled={isDeleting}>
                {isDeleting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Delete
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {/* Metadata card */}
          <Card className="border-border/60">
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Tag className="h-4 w-4" />
                Metadata
              </CardTitle>
              {metadataQuery.data && canUpdateMetadata && (
                <Button variant="ghost" size="sm" onClick={() => setEditingMetadata(true)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {metadataQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading metadata
                </div>
              ) : !metadataQuery.data ? (
                <div className="space-y-3">
                  <p className="text-sm text-fg-muted">
                    No metadata registered for this dataset yet.
                  </p>
                  {onRegisterMetadata && (
                    <Button variant="outline" size="sm" onClick={onRegisterMetadata}>
                      <Plus className="mr-2 h-4 w-4" />
                      Register metadata
                    </Button>
                  )}
                </div>
              ) : (
                <MetadataPanel meta={metadataQuery.data} />
              )}
            </CardContent>
          </Card>

          {/* Lineage card */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <GitBranch className="h-4 w-4" />
                Lineage
              </CardTitle>
              <CardDescription>
                Transformations that produced or consumed this dataset.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {lineageQuery.isLoading ? (
                <Table>
                  <TableBody>
                    <TableLoading message="Loading lineage" />
                  </TableBody>
                </Table>
              ) : lineageQuery.data?.length === 0 ? (
                <Table>
                  <TableBody>
                    <TableEmpty message="No lineage records yet." />
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Process</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Records</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineageQuery.data?.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="font-medium text-fg">{row.process_name}</div>
                          {row.process_version && (
                            <div className="text-xs text-fg-muted">v{row.process_version}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{row.transformation_type}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.status === 'completed'
                                ? 'default'
                                : row.status === 'failed'
                                  ? 'destructive'
                                  : 'secondary'
                            }
                          >
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-fg-muted">
                          {row.records_processed?.toLocaleString() ?? '—'}
                        </TableCell>
                        <TableCell className="text-sm text-fg-muted">
                          {new Date(row.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Validation card */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4" />
                Validation history
              </CardTitle>
              <CardDescription>Rule-based validation runs against this dataset.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {validationQuery.isLoading ? (
                <Table>
                  <TableBody>
                    <TableLoading message="Loading validation history" />
                  </TableBody>
                </Table>
              ) : validationQuery.data?.length === 0 ? (
                <Table>
                  <TableBody>
                    <TableEmpty message="No validation runs yet." />
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Pass / Fail</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validationQuery.data?.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="font-medium text-fg">
                            {row.validation_rule?.name ?? `Rule #${row.validation_rule_id}`}
                          </div>
                          {row.validation_rule?.rule_type && (
                            <div className="text-xs text-fg-muted">
                              {row.validation_rule.rule_type}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.status === 'passed'
                                ? 'default'
                                : row.status === 'failed'
                                  ? 'destructive'
                                  : 'secondary'
                            }
                          >
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-fg-muted">
                          {row.records_passed.toLocaleString()} /{' '}
                          {row.records_failed.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-sm text-fg-muted">
                          {new Date(row.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Validation rules — list + create + run against this dataset. */}
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4" />
                Validation rules
              </CardTitle>
              <CardDescription>
                Org-wide rules. Run any subset against this dataset; results land in the history
                above.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ValidationRulesPanel datasetId={datasetId} />
            </CardContent>
          </Card>
        </div>
      </div>

      {editingMetadata && metadataQuery.data && (
        <EditMetadataDialog
          open
          onOpenChange={setEditingMetadata}
          meta={{
            dataset_id: metadataQuery.data.dataset_id,
            name: metadataQuery.data.name,
            description: metadataQuery.data.description,
            processing_stage: metadataQuery.data.processing_stage,
            sampling_frequency: metadataQuery.data.sampling_frequency,
            version: metadataQuery.data.version,
            tags: metadataQuery.data.tags,
          }}
        />
      )}

      <CompatibilityCheckDialog
        open={compatibilityOpen}
        onOpenChange={setCompatibilityOpen}
        initialDatasetId={datasetId}
      />
    </div>
  );
}

function MetadataPanel({ meta }: { meta: DetailMetadata }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-fg">{meta.name}</h3>
        {meta.description && <p className="mt-1 text-sm text-fg-muted">{meta.description}</p>}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <FieldRow label="Type" value={meta.dataset_type} />
        <FieldRow label="Version" value={meta.version ?? '—'} />
        <FieldRow label="Processing stage" value={meta.processing_stage ?? '—'} />
        <FieldRow label="Sampling frequency" value={meta.sampling_frequency ?? '—'} />
        <FieldRow label="Total records" value={meta.total_records?.toLocaleString() ?? '—'} />
        <FieldRow
          label="Quality score"
          value={
            meta.data_quality_score !== undefined ? `${meta.data_quality_score.toFixed(1)}%` : '—'
          }
        />
        <FieldRow label="Validation" value={meta.validation_status ?? '—'} />
        <FieldRow label="Used in analyses" value={meta.used_in_analyses?.toString() ?? '0'} />
      </div>

      {meta.tags && meta.tags.length > 0 && (
        <div>
          <Label>Tags</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {meta.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <Calendar className="h-3.5 w-3.5" />
        Registered {new Date(meta.created_at).toLocaleString()}
      </div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-0.5 text-fg">{value}</div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="text-xs uppercase tracking-wide text-fg-muted">{children}</div>;
}

// CatalogSourceCell renders the source attribution column on the
// catalog table. Multi-line typography: device/manual on top
// (primary), original filename muted below (secondary), small
// Auto/Manual badge to the right. "—" for legacy rows where the
// /dinsight list doesn't have source info.
function CatalogSourceCell({ source }: { source?: DinsightDatasetSource }) {
  if (!source || source.source === 'unknown') {
    return <span className="text-xs text-fg-muted">—</span>;
  }
  const isAuto = source.source === 'auto';
  const primary = isAuto
    ? (source.deviceName ?? source.deviceSlug ?? 'IoT Hub device')
    : 'Manual upload';
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-fg truncate">{primary}</div>
        {source.originalFileName && (
          <div className="text-xs text-fg-muted truncate">{source.originalFileName}</div>
        )}
      </div>
      <span
        className={
          isAuto
            ? 'shrink-0 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide'
            : 'shrink-0 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide'
        }
      >
        {isAuto ? 'Auto' : 'Manual'}
      </span>
    </div>
  );
}
