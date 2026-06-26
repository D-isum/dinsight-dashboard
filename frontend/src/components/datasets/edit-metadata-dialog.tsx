'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, Loader2, Save } from 'lucide-react';
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
import { useI18n } from '@/i18n/client';

// EditMetadataDialog lets operators+admins curate the user-facing
// metadata for a dataset that the ingestion pipeline registered. The
// raw fields (dataset_id, type, parent_id) are immutable here — they
// reflect the pipeline's record of where the dataset came from. The
// editable surface is the human-friendly fields: name, description,
// processing stage, sampling frequency, tags, version.

export interface DatasetMetadataForEdit {
  dataset_id: number;
  name: string;
  description?: string;
  processing_stage?: string;
  sampling_frequency?: string;
  version?: string;
  tags?: string[];
}

export interface EditMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: DatasetMetadataForEdit;
  /** Called after a successful save with the new values applied. */
  onSaved?: () => void;
}

export function EditMetadataDialog({ open, onOpenChange, meta, onSaved }: EditMetadataDialogProps) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const [name, setName] = useState(meta.name);
  const [description, setDescription] = useState(meta.description ?? '');
  const [processingStage, setProcessingStage] = useState(meta.processing_stage ?? '');
  const [samplingFrequency, setSamplingFrequency] = useState(meta.sampling_frequency ?? '');
  const [version, setVersion] = useState(meta.version ?? '');
  const [tagsRaw, setTagsRaw] = useState((meta.tags ?? []).join(', '));
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (data: Partial<CreateDatasetMetadataRequest>) =>
      api.datasets.updateMetadata(meta.dataset_id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      queryClient.invalidateQueries({ queryKey: ['dataset', meta.dataset_id] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: any) => {
      setError(e?.response?.data?.message || t('data.failedSaveMetadata'));
    },
  });

  const submit = () => {
    setError(null);
    if (!name.trim()) {
      setError(t('data.metadataNameRequired'));
      return;
    }
    const tags = tagsRaw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    mutation.mutate({
      // dataset_id + dataset_type are required by the backend's
      // CreateDatasetMetadataRequest shape but unchanged on update.
      // The handler accepts the same struct for both verbs.
      dataset_id: meta.dataset_id,
      dataset_type: 'baseline', // server preserves the existing value when only edits apply
      name: name.trim(),
      description: description.trim() || undefined,
      processing_stage: processingStage.trim() || undefined,
      sampling_frequency: samplingFrequency.trim() || undefined,
      version: version.trim() || undefined,
      tags,
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('data.editDatasetMetadataTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('data.editDatasetMetadataDescription', { id: meta.dataset_id })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <Alert variant="danger">
            <AlertOctagon className="h-4 w-4" />
            <AlertTitle>{t('data.cannotSaveMetadata')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="meta-name">{t('data.name')}</Label>
            <Input id="meta-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="meta-description">{t('data.descriptionLabel')}</Label>
            <Input
              id="meta-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('data.metadataDescriptionPlaceholder')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="meta-stage">{t('data.processingStage')}</Label>
              <Input
                id="meta-stage"
                value={processingStage}
                onChange={(e) => setProcessingStage(e.target.value)}
                placeholder={t('data.processingStagePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="meta-frequency">{t('data.samplingFrequency')}</Label>
              <Input
                id="meta-frequency"
                value={samplingFrequency}
                onChange={(e) => setSamplingFrequency(e.target.value)}
                placeholder={t('data.samplingFrequencyLongPlaceholder')}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="meta-version">{t('data.version')}</Label>
              <Input
                id="meta-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="meta-tags">{t('data.tagsCommaSeparated')}</Label>
              <Input
                id="meta-tags"
                value={tagsRaw}
                onChange={(e) => setTagsRaw(e.target.value)}
                placeholder="line-3, bearing, q4-2025"
              />
            </div>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('settings.saving')}
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                {t('data.saveChanges')}
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
