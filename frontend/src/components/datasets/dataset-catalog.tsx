'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Calendar,
  ChevronDown,
  Database,
  Download,
  GitBranch,
  Loader2,
  Monitor,
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
import { useBaselineMonitoringData } from '@/hooks/useBaselineMonitoringData';
import type { DinsightDatasetSource } from '@/lib/dataset-normalizers';
import { usePlotTheme } from '@/lib/plot-theme';
import {
  publishDashboardActivity,
  useDashboardWorkspace,
} from '@/context/dashboard-workspace-context';
import { cn } from '@/utils/cn';
import { useI18n } from '@/i18n/client';
import { localizeDataError } from '@/i18n/data-errors';

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
  const { t, formatDate, formatNumber } = useI18n();
  const plotTheme = usePlotTheme();
  const {
    datasets: dinsightSummaries,
    groups: datasetSourceGroups,
    selectedSourceKey,
    selectSource: selectWorkspaceSource,
    selectedDatasetId: workspaceDatasetId,
    selectDataset: selectWorkspaceDataset,
    filteredDatasetIds,
    isLoadingDatasets,
  } = useDashboardWorkspace();
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

  // Source attribution (device / file / created_at) is provided by the
  // workspace context so the catalog, header picker, live monitor, and
  // insights page all share one source selection state.
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
      setDeleteFeedback(t('data.deleteCompleted', { id: datasetId }));
      setSelectedDatasetId((current) => (current === datasetId ? null : current));
      publishDashboardActivity({
        type: 'catalog',
        title: t('data.deleteActivityTitle', { id: datasetId }),
        description: t('data.deleteActivityDescription'),
        datasetId,
        href: '/dashboard/data?catalog=open',
        status: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      queryClient.invalidateQueries({ queryKey: ['available-dinsight-ids'] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error?.message ||
        t('data.unableToDeleteDataset');
      setDeleteFeedback(message);
    },
  });

  const requestDelete = (datasetId: number) => {
    if (!Number.isInteger(datasetId) || datasetId <= 0) {
      setDeleteFeedback(t('data.enterValidDatasetId'));
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
      setExportFeedback(t('data.selectValidDatasetExport'));
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
      setExportFeedback(t('data.exportStarted', { id: datasetId }));
      publishDashboardActivity({
        type: 'catalog',
        title: t('data.exportActivityTitle', { id: datasetId }),
        description: t('data.exportActivityDescription', { filename }),
        datasetId,
        href: '/dashboard/data?catalog=open',
        status: 'success',
      });
    } catch (error: any) {
      let message = t('data.unableToExportDataset');
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
          description: t('data.processedWithoutMetadata'),
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
  }, [allDatasetsQuery.data, dinsightSummaries, listQuery.data, t, typeFilter]);

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
      const preferredDatasetId =
        workspaceDatasetId != null &&
        filtered.some((item) => item.dataset_id === workspaceDatasetId)
          ? workspaceDatasetId
          : filtered[0].dataset_id;
      setPreviewDatasetId(preferredDatasetId);
    }
  }, [filtered, isModal, previewDatasetId, workspaceDatasetId]);

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
        labels: {
          baseline: t('common.baseline'),
          monitoring: t('common.monitoring'),
          point: t('live.point'),
          metadata: t('dashboard.metadata'),
          moreFields: (count) => `+${formatNumber(count)} ${t('dashboard.metadata')}`,
          xAxis: t('live.dinsightXCoordinate'),
          yAxis: t('live.dinsightYCoordinate'),
          formatNumber,
        },
      }),
    [formatNumber, plotTheme, previewBaselineData, previewDatasetId, previewMonitoringData, t]
  );
  const previewItem = filtered.find((item) => item.dataset_id === previewDatasetId) ?? null;
  const catalogColumnCount = canDelete ? 9 : 8;

  return (
    <div className={cn('min-w-0', isModal ? 'space-y-4' : 'space-y-6')}>
      <Card className="min-w-0 border-border/60">
        {!isModal && (
          <CardHeader>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Database className="h-6 w-6" />
                  {t('data.catalogTitle')}
                </CardTitle>
                <CardDescription>{t('data.catalogPageDescription')}</CardDescription>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {canCreate && (
                  <Button
                    onClick={() => {
                      setRegisterInitialDatasetId(null);
                      setRegisterOpen(true);
                    }}
                  >
                    <Plus className="me-2 h-4 w-4" />
                    {t('data.registerMetadata')}
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <Link href="/dashboard/data">
                    <ArrowLeft className="rtl-mirror me-2 h-4 w-4" />
                    {t('data.backToDataIngestion')}
                  </Link>
                </Button>
              </div>
            </div>
          </CardHeader>
        )}
        <CardContent className={cn('min-w-0', isModal && 'p-4')}>
          <div className="grid gap-3 xl:grid-cols-[minmax(220px,1fr)_auto_auto_auto_auto] xl:items-center">
            <Input
              placeholder={t('data.searchCatalogPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
            >
              <option value="">{t('data.allTypes')}</option>
              <option value="baseline">{t('common.baseline')}</option>
              <option value="comparison">{t('common.comparison')}</option>
              <option value="monitoring">{t('common.monitoring')}</option>
            </select>
            <DatasetSourceSelect
              groups={datasetSourceGroups}
              selectedSourceKey={selectedSourceKey}
              onChange={selectWorkspaceSource}
              className="rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
            />
            {catalogItems.length > 0 && (
              <span className="whitespace-nowrap text-sm text-fg-muted">
                {t('data.datasetsCount', {
                  filtered: formatNumber(filtered.length),
                  total: formatNumber(catalogItems.length),
                })}
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
                <Plus className="me-2 h-4 w-4" />
                {t('data.registerMetadata')}
              </Button>
            )}
          </div>
          <details className="group mt-4 border-t border-border pt-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md px-2 py-2 text-sm font-medium text-fg transition-colors hover:bg-surface-muted">
              <span>{t('data.datasetId')}</span>
              <span className="flex items-center gap-2 text-xs font-normal text-fg-muted">
                {t('data.exportDataset')}
                {canDelete ? ` · ${t('data.deleteDataset')}` : ''}
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border border-border bg-surface-muted/35 p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-muted">
                  {t('data.exportDataset')}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Input
                    inputMode="numeric"
                    placeholder={t('data.datasetId')}
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
                      <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="me-2 h-4 w-4" />
                    )}
                    {t('data.exportById')}
                  </Button>
                  {exportFeedback && (
                    <span className="min-w-0 text-sm text-fg-muted">{exportFeedback}</span>
                  )}
                </div>
              </div>
              {canDelete && (
                <div className="rounded-md border border-danger-border bg-danger-bg/45 p-3">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-danger-text">
                    {t('data.deleteDataset')}
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Input
                      inputMode="numeric"
                      placeholder={t('data.datasetId')}
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
                        <Loader2 className="me-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="me-2 h-4 w-4" />
                      )}
                      {t('data.deleteById')}
                    </Button>
                    {deleteFeedback && (
                      <span className="min-w-0 text-sm text-fg-muted">{deleteFeedback}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </details>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card className="min-w-0 border-border/60">
          <CardContent className="p-0">
            <Table className="min-w-[1080px] table-fixed">
              <colgroup>
                <col className="w-[280px]" />
                <col className="w-[180px]" />
                <col className="w-[120px]" />
                <col className="w-[96px]" />
                <col className="w-[120px]" />
                <col className="w-[96px]" />
                <col className="w-[112px]" />
                <col className="w-[84px]" />
                {canDelete && <col className="w-[84px]" />}
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('data.catalogName')}</TableHead>
                  <TableHead>{t('data.catalogSource')}</TableHead>
                  <TableHead>{t('data.catalogType')}</TableHead>
                  <TableHead>{t('data.catalogQuality')}</TableHead>
                  <TableHead>{t('data.catalogValidation')}</TableHead>
                  <TableHead>{t('data.catalogRecords')}</TableHead>
                  <TableHead>{t('data.catalogRegistered')}</TableHead>
                  <TableHead className="w-20 text-end">{t('common.export')}</TableHead>
                  {canDelete && (
                    <TableHead className="w-20 text-end">{t('common.delete')}</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isLoading || isLoadingDatasets ? (
                  <TableLoading
                    message={t('data.loadingDatasetCatalog')}
                    rowSpan={catalogColumnCount}
                  />
                ) : filtered.length === 0 ? (
                  <TableEmpty
                    rowSpan={catalogColumnCount}
                    message={
                      search || typeFilter
                        ? t('data.noDatasetsMatchFilters')
                        : t('data.noDatasetsRegistered')
                    }
                  />
                ) : (
                  filtered.map((item) => (
                    <TableRow
                      key={item.id}
                      selected={previewDatasetId === item.dataset_id}
                      aria-selected={previewDatasetId === item.dataset_id}
                      className={cn(
                        'cursor-pointer hover:bg-surface-muted',
                        previewDatasetId === item.dataset_id && 'hover:bg-surface-selected'
                      )}
                      onClick={() => {
                        setPreviewDatasetId(item.dataset_id);
                        setSelectedDatasetId(item.dataset_id);
                        selectWorkspaceDataset(item.dataset_id);
                      }}
                    >
                      <TableCell className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="outline" className="shrink-0">
                            #{item.dataset_id}
                          </Badge>
                          <div className="truncate font-medium text-fg" title={item.name}>
                            {item.name}
                          </div>
                        </div>
                        {item.description && (
                          <div className="truncate text-xs text-fg-muted" title={item.description}>
                            {item.description}
                          </div>
                        )}
                        {!item.has_metadata && (
                          <div className="mt-1 line-clamp-2 text-xs text-warning-text">
                            {t('data.registerMetadataHint')}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <CatalogSourceCell source={sourceByDinsightId.get(item.dataset_id)} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.has_metadata ? 'secondary' : 'warning'}>
                          {item.has_metadata ? item.dataset_type : t('data.noMetadata')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <QualityBadge score={item.data_quality_score} />
                      </TableCell>
                      <TableCell className="text-sm">
                        <ValidationBadge status={item.validation_status} />
                      </TableCell>
                      <TableCell className="text-sm text-fg-muted">
                        {item.total_records != null ? formatNumber(item.total_records) : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-fg-muted">
                        {item.created_at
                          ? formatDate(item.created_at, {
                              dateStyle: undefined,
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                            })
                          : '—'}
                      </TableCell>
                      <TableCell className="text-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('data.exportDataset')}
                          disabled={exportingDatasetId === item.dataset_id}
                          className="gap-1.5"
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
                          <span className="text-xs">{t('common.export')}</span>
                        </Button>
                      </TableCell>
                      {canDelete && (
                        <TableCell className="text-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 text-danger-text hover:bg-danger-bg hover:text-danger-text"
                            aria-label={t('data.deleteDataset')}
                            disabled={deleteMutation.isPending}
                            onClick={(event) => {
                              event.stopPropagation();
                              requestDelete(item.dataset_id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="text-xs">{t('common.delete')}</span>
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
            title={t('data.datasetPreview')}
            description={t('data.datasetPreviewDescription')}
            className="self-start"
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
              <select
                value={previewDatasetId != null ? String(previewDatasetId) : ''}
                onChange={(event) =>
                  setPreviewDatasetId(event.target.value ? Number(event.target.value) : null)
                }
                className="max-w-[220px] rounded-md border border-input bg-background px-2 py-1.5 text-xs"
              >
                <option value="">{t('common.selectDataset')}</option>
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
                      {previewItem.has_metadata ? previewItem.dataset_type : t('data.noMetadata')}
                    </span>
                    <span>•</span>
                    <span>
                      {sourceByDinsightId.get(previewItem.dataset_id)?.source === 'auto'
                        ? t('data.auto')
                        : t('data.manualUpload')}
                    </span>
                  </div>
                </div>
              )}

              {!previewDatasetId ? (
                <ChartEmptyState
                  title={t('data.noProcessedResult')}
                  description={t('data.chooseCatalogRow')}
                />
              ) : isLoadingPreviewBaseline || isLoadingPreviewMonitoring ? (
                <ChartEmptyState
                  title={t('data.loadingPreview')}
                  description={t('data.fetchingPreviewCoordinates')}
                />
              ) : previewBaselineError ? (
                <ChartEmptyState
                  title={t('data.previewUnavailable')}
                  description={localizeDataError(previewBaselineError, t) ?? previewBaselineError}
                />
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
                  title={t('data.noCoordinates')}
                  description={t('data.noCoordinatesDescription')}
                />
              )}
              {previewMonitoringError && (
                <p className="px-1 text-xs text-fg-muted">
                  {localizeDataError(previewMonitoringError, t)}
                </p>
              )}
              {previewDatasetId && (
                <div className="flex flex-wrap gap-2 px-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void requestExport(previewDatasetId)}
                  >
                    <Download className="me-2 h-4 w-4" />
                    {t('common.export')}
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      href="/dashboard/monitor?view=map"
                      onClick={() => selectWorkspaceDataset(previewDatasetId)}
                    >
                      <Monitor className="me-2 h-4 w-4" />
                      {t('data.openInLive')}
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link
                      href="/dashboard/monitor?view=deterioration"
                      onClick={() => selectWorkspaceDataset(previewDatasetId)}
                    >
                      <BarChart3 className="me-2 h-4 w-4" />
                      {t('data.openInInsights')}
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSelectedDatasetId(previewDatasetId);
                      selectWorkspaceDataset(previewDatasetId);
                    }}
                  >
                    <BarChart3 className="me-2 h-4 w-4" />
                    {t('data.details')}
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
          onOpenLive={() => selectWorkspaceDataset(selectedDatasetId)}
          onOpenInsights={() => selectWorkspaceDataset(selectedDatasetId)}
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
  const { t } = useI18n();
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-danger-text">
            <AlertTriangle className="h-5 w-5" />
            {t('data.deleteDatasetQuestion', { id: datasetId ?? 'N/A' })}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('data.deleteDatasetExplanation')}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="rounded-md border border-danger-border bg-danger-bg p-3 text-sm text-danger-text">
          <div className="font-semibold">{t('data.deletionImpact')}</div>
          <ul className="mt-2 list-disc space-y-1 ps-5">
            <li>{t('data.deletionImpactBaseline')}</li>
            <li>{t('data.deletionImpactMonitoring')}</li>
            <li>{t('data.deletionImpactVisualization')}</li>
            <li>{t('data.deletionImpactMetadata')}</li>
            <li>{t('data.deletionImpactUploads')}</li>
          </ul>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{t('common.cancel')}</AlertDialogCancel>
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
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {t('data.deleting')}
              </>
            ) : (
              t('data.deleteDataset')
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ValidationBadge({ status }: { status?: string }) {
  const { t } = useI18n();
  if (!status) return <span className="text-fg-muted">—</span>;
  if (status === 'passed') return <Badge variant="default">{t('data.passed')}</Badge>;
  if (status === 'failed') return <Badge variant="destructive">{t('data.failed')}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

// ---------- Detail drawer ----------

interface DetailDrawerProps {
  datasetId: number;
  onClose: () => void;
  onExport: () => void;
  onDelete?: () => void;
  onRegisterMetadata?: () => void;
  onOpenLive: () => void;
  onOpenInsights: () => void;
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
  onOpenLive,
  onOpenInsights,
  isExporting,
  isDeleting,
}: DetailDrawerProps) {
  const { t, formatDate, formatNumber } = useI18n();
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
        className="h-full w-full max-w-2xl overflow-y-auto bg-canvas border-s border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-canvas px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-fg">{t('data.datasetDetails')}</h2>
            <p className="text-xs text-fg-muted">
              {t('dashboard.selectedDataset', { id: datasetId })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/monitor?view=map" onClick={onOpenLive}>
                <Monitor className="me-2 h-4 w-4" />
                {t('data.live')}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/monitor?view=deterioration" onClick={onOpenInsights}>
                <BarChart3 className="me-2 h-4 w-4" />
                {t('common.insights')}
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={onExport} disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="me-2 h-4 w-4" />
              )}
              {t('common.export')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCompatibilityOpen(true)}>
              <ShieldQuestion className="me-2 h-4 w-4" />
              {t('data.checkCompatibility')}
            </Button>
            {onDelete && (
              <Button variant="destructive" size="sm" onClick={onDelete} disabled={isDeleting}>
                {isDeleting ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="me-2 h-4 w-4" />
                )}
                {t('common.delete')}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('common.close')}>
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
                {t('data.metadataTitle')}
              </CardTitle>
              {metadataQuery.data && canUpdateMetadata && (
                <Button variant="ghost" size="sm" onClick={() => setEditingMetadata(true)}>
                  <Pencil className="me-2 h-4 w-4" />
                  {t('common.edit')}
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {metadataQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-fg-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('data.loadingMetadata')}
                </div>
              ) : !metadataQuery.data ? (
                <div className="space-y-3">
                  <p className="text-sm text-fg-muted">{t('data.noMetadataRegistered')}</p>
                  {onRegisterMetadata && (
                    <Button variant="outline" size="sm" onClick={onRegisterMetadata}>
                      <Plus className="me-2 h-4 w-4" />
                      {t('data.registerMetadata')}
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
                {t('data.lineage')}
              </CardTitle>
              <CardDescription>{t('data.lineageDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {lineageQuery.isLoading ? (
                <Table>
                  <TableBody>
                    <TableLoading message={t('data.loadingLineage')} />
                  </TableBody>
                </Table>
              ) : lineageQuery.data?.length === 0 ? (
                <Table>
                  <TableBody>
                    <TableEmpty message={t('data.noLineageRecords')} />
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('data.process')}</TableHead>
                      <TableHead>{t('data.type')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('data.catalogRecords')}</TableHead>
                      <TableHead>{t('data.when')}</TableHead>
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
                          {row.records_processed != null
                            ? formatNumber(row.records_processed)
                            : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-fg-muted">
                          {formatDate(row.created_at, {
                            dateStyle: undefined,
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
                {t('data.validationHistory')}
              </CardTitle>
              <CardDescription>{t('data.validationHistoryDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {validationQuery.isLoading ? (
                <Table>
                  <TableBody>
                    <TableLoading message={t('data.loadingValidationHistory')} />
                  </TableBody>
                </Table>
              ) : validationQuery.data?.length === 0 ? (
                <Table>
                  <TableBody>
                    <TableEmpty message={t('data.noValidationRuns')} />
                  </TableBody>
                </Table>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('data.rule')}</TableHead>
                      <TableHead>{t('common.status')}</TableHead>
                      <TableHead>{t('data.passFail')}</TableHead>
                      <TableHead>{t('data.when')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {validationQuery.data?.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="font-medium text-fg">
                            {row.validation_rule?.name ??
                              `${t('data.rule')} #${row.validation_rule_id}`}
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
                          {formatNumber(row.records_passed)} / {formatNumber(row.records_failed)}
                        </TableCell>
                        <TableCell className="text-sm text-fg-muted">
                          {formatDate(row.created_at, {
                            dateStyle: undefined,
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
                {t('settings.validationRules')}
              </CardTitle>
              <CardDescription>{t('data.validationRulesDescription')}</CardDescription>
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
  const { t, formatDate, formatNumber } = useI18n();
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-fg">{meta.name}</h3>
        {meta.description && <p className="mt-1 text-sm text-fg-muted">{meta.description}</p>}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <FieldRow label={t('data.type')} value={meta.dataset_type} />
        <FieldRow label={t('data.version')} value={meta.version ?? '—'} />
        <FieldRow label={t('data.processingStage')} value={meta.processing_stage ?? '—'} />
        <FieldRow label={t('data.samplingFrequency')} value={meta.sampling_frequency ?? '—'} />
        <FieldRow
          label={t('data.totalRecords')}
          value={meta.total_records != null ? formatNumber(meta.total_records) : '—'}
        />
        <FieldRow
          label={t('data.qualityScore')}
          value={
            meta.data_quality_score !== undefined ? `${meta.data_quality_score.toFixed(1)}%` : '—'
          }
        />
        <FieldRow label={t('data.catalogValidation')} value={meta.validation_status ?? '—'} />
        <FieldRow
          label={t('data.usedInAnalyses')}
          value={formatNumber(meta.used_in_analyses ?? 0)}
        />
      </div>

      {meta.tags && meta.tags.length > 0 && (
        <div>
          <Label>{t('data.tags')}</Label>
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
        {t('data.registeredAt', {
          date: formatDate(meta.created_at, { dateStyle: 'medium', timeStyle: 'short' }),
        })}
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
  const { t } = useI18n();
  if (!source || source.source === 'unknown') {
    return <span className="text-xs text-fg-muted">—</span>;
  }
  const isAuto = source.source === 'auto';
  const primary = isAuto
    ? (source.deviceName ?? source.deviceSlug ?? t('data.iotHubDevice'))
    : t('data.manualUpload');
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
        {isAuto ? t('data.auto') : t('common.manual')}
      </span>
    </div>
  );
}
