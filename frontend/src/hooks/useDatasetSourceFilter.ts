'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/auth-context';
import type { DinsightDatasetSummary } from '@/lib/dataset-normalizers';
import {
  buildDatasetSourceGroups,
  filterDatasetsBySourceGroup,
  getLatestDatasetId,
  resolveDatasetSourceGroupKey,
} from '@/lib/dataset-source-groups';
import { buildScopedKey, readScoped, writeScoped } from '@/lib/scoped-storage';

const DATASET_SOURCE_SELECTION_EVENT = 'dinsight:dataset-source-selection';

export function useDatasetSourceFilter(datasets: DinsightDatasetSummary[]) {
  const { user, currentOrg } = useAuth();
  const rawStorageKey = `dataset-source-selection:o${currentOrg?.id ?? 'none'}:v1`;
  const scopedStorageKey = buildScopedKey(rawStorageKey, user?.id);
  const groups = useMemo(() => buildDatasetSourceGroups(datasets), [datasets]);
  const [selectedSourceKey, setSelectedSourceKeyState] = useState<string | null>(null);

  const syncFromStorage = useCallback(() => {
    const stored = readScoped(rawStorageKey, user?.id);
    const resolved = resolveDatasetSourceGroupKey(datasets, stored);
    setSelectedSourceKeyState((current) => (current === resolved ? current : resolved));
    if (resolved && resolved !== stored) {
      writeScoped(rawStorageKey, user?.id, resolved);
    }
  }, [datasets, rawStorageKey, user?.id]);

  useEffect(() => {
    syncFromStorage();
  }, [syncFromStorage]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === scopedStorageKey) syncFromStorage();
    };
    const onSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ storageKey?: string }>).detail;
      if (!detail?.storageKey || detail.storageKey === scopedStorageKey) syncFromStorage();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(DATASET_SOURCE_SELECTION_EVENT, onSelection);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DATASET_SOURCE_SELECTION_EVENT, onSelection);
    };
  }, [scopedStorageKey, syncFromStorage]);

  const setSelectedSourceKey = useCallback(
    (key: string) => {
      if (!groups.some((group) => group.key === key)) return;
      if (key === selectedSourceKey) return;
      setSelectedSourceKeyState(key);
      writeScoped(rawStorageKey, user?.id, key);
      window.dispatchEvent(
        new CustomEvent(DATASET_SOURCE_SELECTION_EVENT, {
          detail: { storageKey: scopedStorageKey },
        })
      );
    },
    [groups, rawStorageKey, scopedStorageKey, selectedSourceKey, user?.id]
  );

  const filteredDatasets = useMemo(
    () => filterDatasetsBySourceGroup(datasets, selectedSourceKey),
    [datasets, selectedSourceKey]
  );
  const filteredDatasetIds = useMemo(
    () => filteredDatasets.map((dataset) => dataset.dinsight_id),
    [filteredDatasets]
  );
  const latestFilteredDatasetId = useMemo(
    () => getLatestDatasetId(filteredDatasets),
    [filteredDatasets]
  );

  return {
    groups,
    selectedSourceKey,
    setSelectedSourceKey,
    filteredDatasets,
    filteredDatasetIds,
    latestFilteredDatasetId,
  };
}
