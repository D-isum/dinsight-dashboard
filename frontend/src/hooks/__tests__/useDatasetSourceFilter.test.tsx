import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDatasetSourceFilter } from '@/hooks/useDatasetSourceFilter';
import type { DinsightDatasetSummary } from '@/lib/dataset-normalizers';

vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({
    user: { id: 7 },
    currentOrg: { id: 9 },
  }),
}));

const datasets: DinsightDatasetSummary[] = [
  {
    dinsight_id: 10,
    name: 'DInsight ID 10',
    type: 'dinsight',
    source: { source: 'auto', deviceId: 1, deviceName: 'Press A' },
  },
  {
    dinsight_id: 11,
    name: 'DInsight ID 11',
    type: 'dinsight',
    source: { source: 'auto', deviceId: 1, deviceName: 'Press A' },
  },
  {
    dinsight_id: 20,
    name: 'DInsight ID 20',
    type: 'dinsight',
    source: { source: 'auto', deviceId: 2, deviceName: 'Press B' },
  },
];

describe('useDatasetSourceFilter', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('filters IDs by device and persists the selected device', () => {
    const { result, unmount } = renderHook(() => useDatasetSourceFilter(datasets));

    expect(result.current.selectedSourceKey).toBe('device-id:2');
    expect(result.current.filteredDatasetIds).toEqual([20]);

    act(() => result.current.setSelectedSourceKey('device-id:1'));

    expect(result.current.filteredDatasetIds).toEqual([10, 11]);
    expect(window.localStorage.getItem('dinsight:u7:dataset-source-selection:o9:v1')).toBe(
      'device-id:1'
    );

    unmount();

    const remounted = renderHook(() => useDatasetSourceFilter(datasets));
    expect(remounted.result.current.selectedSourceKey).toBe('device-id:1');
    expect(remounted.result.current.filteredDatasetIds).toEqual([10, 11]);
  });
});
