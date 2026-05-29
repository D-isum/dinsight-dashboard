import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import {
  DinsightDatasetSummary,
  extractDatasetSource,
  normalizeDinsightDatasetSummary,
} from '@/lib/dataset-normalizers';

export interface DatasetDiscoveryOptions {
  enabled?: boolean;
  maxId?: number;
  maxConsecutiveMisses?: number;
  staleTime?: number;
  refetchInterval?: number;
  refetchOnWindowFocus?: boolean;
  queryKey?: readonly unknown[];
}

export interface DatasetDiscoveryResult {
  datasets: DinsightDatasetSummary[];
  datasetIds: number[];
  latestDatasetId: number | null;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

const defaultOptions: Required<Omit<DatasetDiscoveryOptions, 'queryKey'>> = {
  enabled: true,
  maxId: 1000,
  maxConsecutiveMisses: 5,
  staleTime: 10_000,
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
};
const EMPTY_DATASETS: DinsightDatasetSummary[] = [];
let isDinsightListEndpointSupported: boolean | null = null;

export function useDatasetDiscovery(options?: DatasetDiscoveryOptions): DatasetDiscoveryResult {
  const merged = { ...defaultOptions, ...options };

  const query = useQuery<DinsightDatasetSummary[]>({
    queryKey: options?.queryKey ?? ['available-dinsight-ids'],
    enabled: merged.enabled,
    staleTime: merged.staleTime,
    refetchInterval: merged.refetchInterval,
    refetchOnWindowFocus: merged.refetchOnWindowFocus,
    retry: false,
    queryFn: async () => {
      const fromKnownIds = async (ids: number[]) => {
        const summaries = await Promise.all(
          ids.map(async (id) => {
            try {
              const response = await api.analysis.getDinsight(id);
              if (!response?.data?.success) {
                return null;
              }
              return normalizeDinsightDatasetSummary(id, response?.data?.data);
            } catch {
              return null;
            }
          })
        );
        return summaries
          .filter((entry): entry is DinsightDatasetSummary => Boolean(entry))
          .sort((a, b) => a.dinsight_id - b.dinsight_id);
      };

      if (isDinsightListEndpointSupported !== false) {
        try {
          const listResponse = await api.analysis.listDinsightIds();
          isDinsightListEndpointSupported = true;

          // Phase-6+ backends return a rich `datasets` block alongside
          // `ids`. When present, build summaries directly from it —
          // one round trip instead of N. Falls back to fromKnownIds
          // (per-id detail fetch) for older backends that only return
          // `ids`.
          const rawDatasets = listResponse?.data?.data?.datasets;
          if (Array.isArray(rawDatasets) && rawDatasets.length > 0) {
            const summaries: DinsightDatasetSummary[] = [];
            for (const entry of rawDatasets) {
              if (!entry || typeof entry !== 'object') continue;
              const data = entry as Record<string, unknown>;
              const id = Number(data.dinsight_id);
              if (!Number.isInteger(id) || id <= 0) continue;
              summaries.push({
                dinsight_id: id,
                name: `DInsight ID ${id}`,
                type: 'dinsight',
                source: extractDatasetSource(data),
              });
            }
            return summaries.sort((a, b) => a.dinsight_id - b.dinsight_id);
          }

          const rawIds = listResponse?.data?.data?.ids;
          const ids = Array.isArray(rawIds)
            ? rawIds
                .map((value) => Number(value))
                .filter((value) => Number.isInteger(value) && value > 0)
                .sort((a, b) => a - b)
            : [];

          return fromKnownIds(ids);
        } catch (error: any) {
          if (error?.response?.status === 404) {
            isDinsightListEndpointSupported = false;
          }
          // Fallback below keeps compatibility with older API servers.
        }
      }

      const fallbackResults: DinsightDatasetSummary[] = [];
      const seenIds = new Set<number>();
      let consecutiveMisses = 0;

      for (
        let id = 1;
        id <= merged.maxId && consecutiveMisses < merged.maxConsecutiveMisses;
        id++
      ) {
        try {
          const response = await api.analysis.getDinsight(id);
          const summary = normalizeDinsightDatasetSummary(id, response?.data?.data);

          if (response?.data?.success && summary) {
            if (!seenIds.has(summary.dinsight_id)) {
              seenIds.add(summary.dinsight_id);
              fallbackResults.push(summary);
            }
            consecutiveMisses = 0;
          } else {
            consecutiveMisses += 1;
          }
        } catch {
          consecutiveMisses += 1;
        }
      }

      return fallbackResults.sort((a, b) => a.dinsight_id - b.dinsight_id);
    },
  });

  const datasets = query.data ?? EMPTY_DATASETS;
  const datasetIds = useMemo(() => datasets.map((dataset) => dataset.dinsight_id), [datasets]);
  const latestDatasetId = datasets.length > 0 ? datasets[datasets.length - 1].dinsight_id : null;

  return {
    datasets,
    datasetIds,
    latestDatasetId,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: query.refetch,
  };
}
