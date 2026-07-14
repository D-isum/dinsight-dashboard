import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useActiveStreamingDataset } from '@/hooks/useActiveStreamingDataset';
import { api } from '@/lib/api-client';
import { createQueryClientWrapper } from '@/test/query-client';

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual('@/lib/api-client');
  return {
    ...actual,
    api: {
      ...((actual as any).api ?? {}),
      streaming: {
        ...((actual as any).api?.streaming ?? {}),
        getStatus: vi.fn(),
      },
    },
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useActiveStreamingDataset', () => {
  it('does not scan dataset statuses when discovery is disabled', () => {
    const { result } = renderHook(() => useActiveStreamingDataset([5, 6, 7], 60_000, false), {
      wrapper: createQueryClientWrapper(),
    });

    expect(api.streaming.getStatus).not.toHaveBeenCalled();
    expect(result.current.activeStreamingDatasetId).toBeNull();
    expect(result.current.statusesByDatasetId).toEqual({});
  });

  it('finds the newest active dataset when discovery is enabled', async () => {
    vi.mocked(api.streaming.getStatus).mockImplementation(
      async (datasetId: number) =>
        ({
          data: {
            success: true,
            data: {
              status: datasetId === 7 ? 'streaming' : 'completed',
              is_active: datasetId === 7,
            },
          },
        }) as any
    );

    const { result } = renderHook(() => useActiveStreamingDataset([5, 7], 60_000), {
      wrapper: createQueryClientWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(api.streaming.getStatus).toHaveBeenCalledTimes(2);
    expect(result.current.activeStreamingDatasetId).toBe(7);
    expect(result.current.statusesByDatasetId[7]).toMatchObject({
      status: 'streaming',
      isActive: true,
    });
  });
});
