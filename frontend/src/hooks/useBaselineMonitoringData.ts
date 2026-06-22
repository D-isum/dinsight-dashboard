import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import {
  CoordinateSeries,
  normalizeCoordinateSeriesFromDinsightPayload,
  normalizeCoordinateSeriesFromMonitoringCoordinates,
  normalizeCoordinateSeriesFromMonitoringRows,
} from '@/lib/dataset-normalizers';

export interface BaselineMonitoringDataOptions {
  dinsightId: number | null;
  includeMonitoring?: boolean;
  includeMetadata?: boolean;
  monitoringMode?: 'rows' | 'coordinates';
  maxPoints?: number;
  refreshKey?: number;
}

export interface BaselineMonitoringDataResult {
  baselineData: CoordinateSeries | null;
  monitoringData: CoordinateSeries | null;
  isLoadingBaseline: boolean;
  isLoadingMonitoring: boolean;
  baselineError: string | null;
  monitoringError: string | null;
  refetchBaseline: () => Promise<unknown>;
  refetchMonitoring: () => Promise<unknown>;
}

const extractErrorMessage = (error: any, fallback: string): string =>
  error?.response?.data?.message || error?.message || fallback;

export function useBaselineMonitoringData(
  options: BaselineMonitoringDataOptions
): BaselineMonitoringDataResult {
  const includeMonitoring = options.includeMonitoring ?? true;
  const includeMetadata = options.includeMetadata ?? true;
  const monitoringMode = options.monitoringMode ?? 'rows';
  const maxPoints = options.maxPoints;

  const baselineQuery = useQuery<CoordinateSeries | null, Error>({
    queryKey: ['baseline-data', options.dinsightId, includeMetadata, maxPoints, options.refreshKey],
    enabled: !!options.dinsightId,
    retry: false,
    queryFn: async () => {
      const response = await api.analysis.getDinsight(options.dinsightId as number, {
        include_metadata: includeMetadata,
        max_points: maxPoints,
      });
      const normalized = normalizeCoordinateSeriesFromDinsightPayload(
        response?.data?.data,
        includeMetadata
      );

      if (!response?.data?.success || !normalized) {
        throw new Error('Baseline dataset does not contain valid coordinates yet.');
      }

      return normalized;
    },
  });

  const monitoringQuery = useQuery<CoordinateSeries | null, Error>({
    queryKey: [
      'monitoring-data',
      options.dinsightId,
      includeMonitoring,
      includeMetadata,
      monitoringMode,
      maxPoints,
      options.refreshKey,
    ],
    enabled: !!options.dinsightId && includeMonitoring,
    retry: false,
    queryFn: async () => {
      if (!options.dinsightId) {
        return null;
      }

      if (monitoringMode === 'coordinates') {
        const response = await api.monitoring.getCoordinates(options.dinsightId, {
          max_points: maxPoints,
        });
        const normalized = normalizeCoordinateSeriesFromMonitoringCoordinates(
          response?.data,
          includeMetadata
        );

        if (!normalized) {
          throw new Error('Monitoring data not available for this baseline yet.');
        }

        return normalized;
      }

      const response = await api.monitoring.get(options.dinsightId, {
        include_values: false,
        include_metadata: includeMetadata,
        max_points: maxPoints,
      });
      const normalized = normalizeCoordinateSeriesFromMonitoringRows(
        response?.data,
        includeMetadata
      );
      if (!normalized) {
        throw new Error('Monitoring data not available for this baseline yet.');
      }

      return normalized;
    },
  });

  const monitoringError = (() => {
    if (!monitoringQuery.error) {
      return null;
    }

    const error = monitoringQuery.error as any;
    const status = error?.response?.status;
    if (status === 404) {
      return 'Monitoring data not found for this baseline. Upload monitoring data to continue.';
    }

    return extractErrorMessage(error, 'Unable to load monitoring data.');
  })();

  return {
    baselineData: baselineQuery.data ?? null,
    monitoringData: monitoringQuery.data ?? null,
    isLoadingBaseline: baselineQuery.isLoading,
    isLoadingMonitoring: monitoringQuery.isLoading,
    baselineError: baselineQuery.error
      ? extractErrorMessage(baselineQuery.error, 'Unable to load baseline dataset.')
      : null,
    monitoringError,
    refetchBaseline: baselineQuery.refetch,
    refetchMonitoring: monitoringQuery.refetch,
  };
}
