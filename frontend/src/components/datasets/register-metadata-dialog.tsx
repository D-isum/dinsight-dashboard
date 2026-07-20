'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, Loader2, Plus } from 'lucide-react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, type CreateDatasetMetadataRequest } from '@/lib/api-client';
import { useDatasetDiscovery } from '@/hooks/useDatasetDiscovery';
import { useDatasetSourceFilter } from '@/hooks/useDatasetSourceFilter';
import { DatasetSourceSelect } from '@/components/datasets/dataset-source-select';
import { formatDatasetOptionLabelLocalized } from '@/lib/dataset-source-groups';
import { useI18n } from '@/i18n/client';

// RegisterMetadataDialog lets an operator+admin attach metadata to a
// dinsight_data row that doesn't have any yet. The catalog page lists
// only datasets with metadata; this is the entry point for the
// "I just uploaded raw data, let me catalog it" flow.
//
// We list candidate dinsight_data IDs from /dinsight (already org-
// scoped on the backend) and filter out any that already appear in
// the metadata listing the caller passes in.

const DATASET_TYPES = [
  { value: 'baseline', labelKey: 'data.datasetTypeBaseline' },
  { value: 'comparison', labelKey: 'data.datasetTypeComparison' },
  { value: 'monitoring', labelKey: 'data.datasetTypeMonitoring' },
];

const PROCESSING_STAGES = [
  { value: '', labelKey: 'data.processingStageNotSpecified' },
  { value: 'raw', labelKey: 'data.processingStageRaw' },
  { value: 'preprocessed', labelKey: 'data.processingStagePreprocessed' },
  { value: 'transformed', labelKey: 'data.processingStageTransformed' },
];

export interface RegisterMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dataset IDs that already have metadata. Excluded from the picker. */
  excludedDatasetIds: number[];
  initialDatasetId?: number | null;
}

export function RegisterMetadataDialog({
  open,
  onOpenChange,
  excludedDatasetIds,
  initialDatasetId,
}: RegisterMetadataDialogProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const [datasetId, setDatasetId] = useState<number | null>(null);
  const [datasetType, setDatasetType] = useState('baseline');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [processingStage, setProcessingStage] = useState('');
  const [samplingFrequency, setSamplingFrequency] = useState('');
  const [version, setVersion] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { datasets, isLoading } = useDatasetDiscovery({
    queryKey: ['dinsight', 'metadata-registration-sources'],
    enabled: open,
    refetchInterval: 30_000,
  });
  const {
    groups: datasetSourceGroups,
    selectedSourceKey,
    setSelectedSourceKey,
    filteredDatasets,
  } = useDatasetSourceFilter(datasets);

  const candidateDatasets = filteredDatasets.filter(
    (dataset) => !excludedDatasetIds.includes(dataset.dinsight_id)
  );

  useEffect(() => {
    if (open && initialDatasetId && !excludedDatasetIds.includes(initialDatasetId)) {
      setDatasetId(initialDatasetId);
      return;
    }
    setDatasetId(null);
  }, [excludedDatasetIds, initialDatasetId, open, selectedSourceKey]);

  const mutation = useMutation({
    mutationFn: (data: CreateDatasetMetadataRequest) => api.datasets.createMetadata(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      handleClose();
    },
    onError: (e: any) => {
      setError(e?.response?.data?.message || t('data.registerMetadataFailed'));
    },
  });

  const handleClose = () => {
    setDatasetId(null);
    setDatasetType('baseline');
    setName('');
    setDescription('');
    setProcessingStage('');
    setSamplingFrequency('');
    setVersion('');
    setTagsRaw('');
    setError(null);
    onOpenChange(false);
  };

  const submit = () => {
    setError(null);
    if (datasetId === null) {
      setError(t('data.pickDatasetForMetadata'));
      return;
    }
    if (!name.trim()) {
      setError(t('data.metadataNameRequired'));
      return;
    }
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    mutation.mutate({
      dataset_id: datasetId,
      dataset_type: datasetType,
      name: name.trim(),
      description: description.trim() || undefined,
      processing_stage: processingStage || undefined,
      sampling_frequency: samplingFrequency.trim() || undefined,
      version: version.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : handleClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('data.registerDatasetMetadataTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('data.registerDatasetMetadataDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <Alert variant="danger">
            <AlertOctagon className="h-4 w-4" />
            <AlertTitle>{t('data.cannotRegisterMetadata')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reg-source">{t('data.deviceSource')}</Label>
            <DatasetSourceSelect
              groups={datasetSourceGroups}
              selectedSourceKey={selectedSourceKey}
              onChange={setSelectedSourceKey}
              disabled={isLoading}
              className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-60"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reg-dataset">{t('data.dataset')}</Label>
            <select
              id="reg-dataset"
              value={datasetId ?? ''}
              onChange={(e) => setDatasetId(e.target.value ? Number(e.target.value) : null)}
              disabled={isLoading}
              className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus disabled:opacity-60"
            >
              <option value="">
                {isLoading
                  ? t('data.loadingDatasets')
                  : candidateDatasets.length === 0
                    ? t('data.allSourceDatasetsHaveMetadata')
                    : t('data.pickDataset')}
              </option>
              {candidateDatasets.map((dataset) => (
                <option key={dataset.dinsight_id} value={dataset.dinsight_id}>
                  {formatDatasetOptionLabelLocalized(dataset, t)}
                </option>
              ))}
            </select>
            <p className="text-xs text-fg-muted">{t('data.metadataSourceHelp')}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="reg-type">{t('data.datasetType')}</Label>
              <select
                id="reg-type"
                value={datasetType}
                onChange={(e) => setDatasetType(e.target.value)}
                className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
              >
                {DATASET_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {t(type.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-version">{t('data.version')}</Label>
              <Input
                id="reg-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.0"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reg-name">{t('data.name')}</Label>
            <Input
              id="reg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('data.metadataNamePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reg-description">{t('data.descriptionLabel')}</Label>
            <Input
              id="reg-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('data.metadataDescriptionPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="reg-stage">{t('data.processingStage')}</Label>
              <select
                id="reg-stage"
                value={processingStage}
                onChange={(e) => setProcessingStage(e.target.value)}
                className="w-full rounded-md border border-strong bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-focus"
              >
                {PROCESSING_STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {t(s.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-frequency">{t('data.samplingFrequency')}</Label>
              <Input
                id="reg-frequency"
                value={samplingFrequency}
                onChange={(e) => setSamplingFrequency(e.target.value)}
                placeholder={t('data.samplingFrequencyPlaceholder')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reg-tags">{t('data.tagsCommaSeparated')}</Label>
            <Input
              id="reg-tags"
              value={tagsRaw}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="line-3, bearing, q4-2025"
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleClose}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending || datasetId === null || !name.trim()}
            onClick={submit}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {t('data.registeringMetadata')}
              </>
            ) : (
              <>
                <Plus className="me-2 h-4 w-4" />
                {t('data.registerMetadata')}
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
