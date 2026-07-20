'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertOctagon, CheckCircle2, Loader2, ShieldQuestion } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DatasetSourceSelect } from '@/components/datasets/dataset-source-select';
import { api } from '@/lib/api-client';
import { useDatasetDiscovery } from '@/hooks/useDatasetDiscovery';
import { useDatasetSourceFilter } from '@/hooks/useDatasetSourceFilter';
import { useI18n } from '@/i18n/client';

// Backend's compatibility analysis result. Mirrors the fields populated
// by handler.performCompatibilityAnalysis. Keep names in sync with
// internal/handler/dataset_compatibility.go.
interface CompatibilityCheck {
  check_name: string;
  status: string; // "pass" | "warning" | "fail"
  details?: string;
  score?: number; // 0-100
}

interface CompatibilityResult {
  overall_compatibility: 'compatible' | 'partially_compatible' | 'incompatible' | string;
  compatibility_score: number; // 0-100
  compatibility_checks?: CompatibilityCheck[];
}

interface DatasetMetadataItem {
  id: number;
  dataset_id: number;
  name: string;
  dataset_type: string;
}

export interface CompatibilityCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional initial dataset to lock the start-hand side. Lets the catalog drawer pre-fill. */
  initialDatasetId?: number;
}

/**
 * CompatibilityCheckDialog lets the user pick two registered datasets
 * and runs the backend's compatibility analysis. Useful before
 * combining two baselines in an analysis, or before promoting a
 * dataset to be monitored against another baseline. The check returns
 * an overall score + per-aspect breakdown so the user can see *why*
 * something is or isn't compatible.
 */
export function CompatibilityCheckDialog({
  open,
  onOpenChange,
  initialDatasetId,
}: CompatibilityCheckDialogProps) {
  const { t } = useI18n();
  const [datasetA, setDatasetA] = useState<number | null>(initialDatasetId ?? null);
  const [datasetB, setDatasetB] = useState<number | null>(null);

  // Reset on open/close so re-opens don't leak stale selection.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setDatasetA(initialDatasetId ?? null);
      setDatasetB(null);
      checkMutation.reset();
    }
    onOpenChange(next);
  };

  const datasetsQuery = useQuery<DatasetMetadataItem[]>({
    queryKey: ['datasets', 'metadata', 'compatibility-picker'],
    queryFn: async () => {
      const res = await api.datasets.list({ limit: 200 });
      return (res?.data?.data?.datasets ?? []) as DatasetMetadataItem[];
    },
    enabled: open,
  });
  const { datasets: dinsightSummaries } = useDatasetDiscovery({
    queryKey: ['dinsight', 'compatibility-sources'],
    enabled: open,
    refetchInterval: 30_000,
  });
  const {
    groups: datasetSourceGroups,
    selectedSourceKey,
    setSelectedSourceKey,
    filteredDatasetIds,
  } = useDatasetSourceFilter(dinsightSummaries);
  const filteredMetadataDatasets = useMemo(
    () =>
      (datasetsQuery.data ?? []).filter((dataset) =>
        filteredDatasetIds.includes(dataset.dataset_id)
      ),
    [datasetsQuery.data, filteredDatasetIds]
  );

  const checkMutation = useMutation<CompatibilityResult, Error, { a: number; b: number }>({
    mutationFn: async ({ a, b }) => {
      const res = await api.datasets.checkCompatibility(a, b);
      return (res?.data?.data ?? null) as CompatibilityResult;
    },
  });
  const resetCompatibilityCheck = checkMutation.reset;

  useEffect(() => {
    if (initialDatasetId === undefined) setDatasetA(null);
    setDatasetB(null);
    resetCompatibilityCheck();
  }, [initialDatasetId, resetCompatibilityCheck, selectedSourceKey]);

  const canRun = datasetA !== null && datasetB !== null && datasetA !== datasetB;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ShieldQuestion className="h-5 w-5" />
            {t('data.checkDatasetCompatibility')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('data.checkDatasetCompatibilityDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor="compatibility-source">{t('data.deviceSource')}</Label>
          <DatasetSourceSelect
            groups={datasetSourceGroups}
            selectedSourceKey={selectedSourceKey}
            onChange={setSelectedSourceKey}
            disabled={initialDatasetId !== undefined}
            className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-60"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="dataset-a">{t('data.datasetA')}</Label>
            <DatasetPicker
              id="dataset-a"
              value={datasetA}
              onChange={setDatasetA}
              datasets={filteredMetadataDatasets}
              isLoading={datasetsQuery.isLoading}
              disabled={initialDatasetId !== undefined}
              excludeId={datasetB ?? undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dataset-b">{t('data.datasetB')}</Label>
            <DatasetPicker
              id="dataset-b"
              value={datasetB}
              onChange={setDatasetB}
              datasets={filteredMetadataDatasets}
              isLoading={datasetsQuery.isLoading}
              excludeId={datasetA ?? undefined}
            />
          </div>
        </div>

        {checkMutation.isError && (
          <Alert variant="danger">
            <AlertOctagon className="h-4 w-4" />
            <AlertTitle>{t('data.compatibilityCheckFailed')}</AlertTitle>
            <AlertDescription>
              {(checkMutation.error as any)?.response?.data?.message ||
                t('data.compatibilityCheckFailedDescription')}
            </AlertDescription>
          </Alert>
        )}

        {checkMutation.data && <ResultPanel result={checkMutation.data} />}

        <AlertDialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button
            disabled={!canRun || checkMutation.isPending}
            onClick={() => canRun && checkMutation.mutate({ a: datasetA!, b: datasetB! })}
          >
            {checkMutation.isPending ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {t('data.checkingCompatibility')}
              </>
            ) : checkMutation.data ? (
              t('data.runAgain')
            ) : (
              t('data.checkCompatibility')
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface DatasetPickerProps {
  id: string;
  value: number | null;
  onChange: (id: number | null) => void;
  datasets: DatasetMetadataItem[];
  isLoading: boolean;
  disabled?: boolean;
  excludeId?: number;
}

function DatasetPicker({
  id,
  value,
  onChange,
  datasets,
  isLoading,
  disabled,
  excludeId,
}: DatasetPickerProps) {
  const { t } = useI18n();

  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      disabled={disabled || isLoading}
      className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-60"
    >
      <option value="">{isLoading ? t('data.loadingDatasets') : t('data.selectDataset')}</option>
      {datasets
        .filter((d) => d.dataset_id !== excludeId)
        .map((d) => (
          <option key={d.id} value={d.dataset_id}>
            #{d.dataset_id} · {d.name} ({formatDatasetType(d.dataset_type, t)})
          </option>
        ))}
    </select>
  );
}

function ResultPanel({ result }: { result: CompatibilityResult }) {
  const { t } = useI18n();
  const variant =
    result.overall_compatibility === 'compatible'
      ? 'success'
      : result.overall_compatibility === 'incompatible'
        ? 'danger'
        : 'warning';

  const label =
    result.overall_compatibility === 'compatible'
      ? t('data.compatible')
      : result.overall_compatibility === 'incompatible'
        ? t('data.incompatible')
        : t('data.partiallyCompatible');

  return (
    <div className="space-y-3 rounded-lg border border-strong bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {variant === 'success' && <CheckCircle2 className="h-5 w-5 text-success-text" />}
          {variant === 'warning' && <AlertOctagon className="h-5 w-5 text-warning" />}
          {variant === 'danger' && <AlertOctagon className="h-5 w-5 text-danger" />}
          <span className="text-base font-medium text-fg">{label}</span>
        </div>
        <Badge
          variant={
            variant === 'success' ? 'default' : variant === 'danger' ? 'destructive' : 'secondary'
          }
        >
          {result.compatibility_score.toFixed(0)} / 100
        </Badge>
      </div>

      {result.compatibility_checks && result.compatibility_checks.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-fg-muted">
            {t('data.perCheckBreakdown')}
          </p>
          <ul className="space-y-1.5 text-sm">
            {result.compatibility_checks.map((check, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <CheckStatusBadge status={check.status} />
                <div className="flex-1">
                  <span className="font-medium text-fg">{check.check_name}</span>
                  {check.score !== undefined && (
                    <span className="ms-2 text-xs text-fg-muted">({check.score.toFixed(0)}%)</span>
                  )}
                  {check.details && (
                    <span className="block text-xs text-fg-muted">{check.details}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CheckStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();

  if (status === 'pass') return <Badge variant="default">{t('data.passed')}</Badge>;
  if (status === 'fail') return <Badge variant="destructive">{t('data.failed')}</Badge>;
  if (status === 'warning') return <Badge variant="secondary">{t('common.warning')}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function formatDatasetType(type: string, t: (key: string) => string) {
  if (type === 'baseline') return t('data.datasetTypeBaseline');
  if (type === 'comparison') return t('data.datasetTypeComparison');
  if (type === 'monitoring') return t('data.datasetTypeMonitoring');
  return type;
}
