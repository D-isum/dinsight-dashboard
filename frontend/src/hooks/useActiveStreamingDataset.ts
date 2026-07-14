import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface StreamingStatusSummary {
  datasetId: number;
  status: 'not_started' | 'streaming' | 'completed';
  isActive: boolean;
}

interface ActiveStreamingDatasetResult {
  activeStreamingDatasetId: number | null;
  statusesByDatasetId: Record<number, StreamingStatusSummary>;
  isLoading: boolean;
}

const EMPTY_STATUSES: Record<number, StreamingStatusSummary> = {};

export function useActiveStreamingDataset(
  datasetIds: number[],
  refreshMs = 3_000,
  enabled = true
): ActiveStreamingDatasetResult {
  const stableDatasetIds = useMemo(
    () => Array.from(new Set(datasetIds)).filter((id) => Number.isInteger(id) && id > 0),
    [datasetIds]
  );

  const statusQuery = useQuery<StreamingStatusSummary[]>({
    queryKey: ['active-streaming-dataset', stableDatasetIds],
    enabled: enabled && stableDatasetIds.length > 0,
    staleTime: Math.max(1_000, Math.floor(refreshMs / 2)),
    refetchOnWindowFocus: true,
    refetchInterval: refreshMs,
    retry: false,
    queryFn: async () => {
      const checks = await Promise.allSettled(
        stableDatasetIds.map(async (datasetId) => {
          const response = await api.streaming.getStatus(datasetId);
          const payload = response?.data?.data as
            | { status?: 'not_started' | 'streaming' | 'completed'; is_active?: boolean }
            | undefined;
          const status = payload?.status ?? 'not_started';
          const isActive = Boolean(payload?.is_active) || status === 'streaming';
          return { datasetId, status, isActive } satisfies StreamingStatusSummary;
        })
      );

      return checks.flatMap((result, index) => {
        if (result.status === 'fulfilled') {
          return [result.value];
        }
        return [
          {
            datasetId: stableDatasetIds[index],
            status: 'not_started' as const,
            isActive: false,
          },
        ];
      });
    },
  });

  const statuses = useMemo(
    () => (enabled ? (statusQuery.data ?? []) : []),
    [enabled, statusQuery.data]
  );
  const activeStreamingDatasetId = useMemo(() => {
    const active = statuses
      .filter((entry) => entry.isActive || entry.status === 'streaming')
      .sort((a, b) => b.datasetId - a.datasetId);
    return active[0]?.datasetId ?? null;
  }, [statuses]);

  const statusesByDatasetId = useMemo(() => {
    if (statuses.length === 0) {
      return EMPTY_STATUSES;
    }
    return statuses.reduce<Record<number, StreamingStatusSummary>>((acc, entry) => {
      acc[entry.datasetId] = entry;
      return acc;
    }, {});
  }, [statuses]);

  return {
    activeStreamingDatasetId,
    statusesByDatasetId,
    isLoading: statusQuery.isLoading,
  };
}
