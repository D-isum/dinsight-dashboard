import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBaselineMonitoringData } from '@/hooks/useBaselineMonitoringData';
import { api } from '@/lib/api-client';
import { createQueryClientWrapper } from '@/test/query-client';

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual('@/lib/api-client');
  return {
    ...actual,
    api: {
      ...((actual as any).api ?? {}),
      analysis: {
        ...((actual as any).api?.analysis ?? {}),
        getDinsight: vi.fn(),
      },
      monitoring: {
        ...((actual as any).api?.monitoring ?? {}),
        get: vi.fn(),
        getCoordinates: vi.fn(),
      },
    },
  };
});

describe('useBaselineMonitoringData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads baseline and monitoring rows', async () => {
    vi.mocked(api.analysis.getDinsight).mockResolvedValue({
      data: {
        success: true,
        data: {
          dinsight_x: [1, 2],
          dinsight_y: [3, 4],
          point_metadata: [{ tag: 'b1' }, { tag: 'b2' }],
        },
      },
    } as any);

    vi.mocked(api.monitoring.get).mockResolvedValue({
      data: [{ dinsight_x: 10, dinsight_y: 20, metadata: { tag: 'm1' } }],
    } as any);

    const { result } = renderHook(
      () => useBaselineMonitoringData({ dinsightId: 7, monitoringMode: 'rows' }),
      {
        wrapper: createQueryClientWrapper(),
      }
    );

    await waitFor(() => {
      expect(result.current.isLoadingBaseline).toBe(false);
      expect(result.current.isLoadingMonitoring).toBe(false);
    });

    expect(result.current.baselineData?.dinsight_x).toEqual([1, 2]);
    expect(result.current.monitoringData?.dinsight_y).toEqual([20]);
  });

  it('uses monitoring rows when coordinate views need metadata', async () => {
    vi.mocked(api.analysis.getDinsight).mockResolvedValue({
      data: {
        success: true,
        data: {
          dinsight_x: [1],
          dinsight_y: [2],
          point_metadata: [{ timestamp: '2003/10/22  12:06:24' }],
        },
      },
    } as any);

    vi.mocked(api.monitoring.get).mockResolvedValue({
      data: [{ dinsight_x: 3, dinsight_y: 4, metadata: { timestamp: 'monitor-1' } }],
    } as any);

    const { result } = renderHook(
      () =>
        useBaselineMonitoringData({
          dinsightId: 8,
          monitoringMode: 'coordinates',
          includeMetadata: true,
        }),
      {
        wrapper: createQueryClientWrapper(),
      }
    );

    await waitFor(() => {
      expect(result.current.isLoadingBaseline).toBe(false);
      expect(result.current.isLoadingMonitoring).toBe(false);
    });

    expect(api.monitoring.get).toHaveBeenCalledWith(8, {
      include_values: false,
      include_metadata: true,
      max_points: undefined,
    });
    expect(api.monitoring.getCoordinates).not.toHaveBeenCalled();
    expect(result.current.monitoringData?.metadata).toEqual([{ timestamp: 'monitor-1' }]);
  });
});
