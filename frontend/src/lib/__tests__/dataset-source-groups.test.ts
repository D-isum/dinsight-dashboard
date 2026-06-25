import { describe, expect, it } from 'vitest';
import type { DinsightDatasetSummary } from '@/lib/dataset-normalizers';
import {
  buildDatasetSourceGroups,
  filterDatasetsBySourceGroup,
  getDatasetSourceGroupKey,
  getLatestDatasetId,
  resolveDatasetSourceGroupKey,
} from '@/lib/dataset-source-groups';

const dataset = (id: number, source: DinsightDatasetSummary['source']): DinsightDatasetSummary => ({
  dinsight_id: id,
  name: `Dataset #${id}`,
  type: 'dinsight',
  source,
});

describe('dataset source groups', () => {
  const datasets = [
    dataset(1, { source: 'auto', deviceId: 10, deviceName: 'Press A' }),
    dataset(2, { source: 'auto', deviceId: 20, deviceName: 'Press B' }),
    dataset(3, { source: 'auto', deviceId: 10, deviceName: 'Press A' }),
    dataset(4, { source: 'manual' }),
  ];

  it('keeps IDs from different devices in separate groups', () => {
    expect(getDatasetSourceGroupKey(datasets[0])).toBe('device-id:10');
    expect(buildDatasetSourceGroups(datasets).map((group) => group.key)).toEqual([
      'device-id:10',
      'device-id:20',
      'manual',
    ]);
    expect(
      filterDatasetsBySourceGroup(datasets, 'device-id:10').map((item) => item.dinsight_id)
    ).toEqual([1, 3]);
  });

  it('resolves invalid persisted selections to the latest dataset device', () => {
    expect(resolveDatasetSourceGroupKey(datasets, 'device-id:999')).toBe('manual');
    expect(getLatestDatasetId(datasets)).toBe(4);
  });

  it('prefers source timestamps when finding the latest dataset', () => {
    const timestamped = [
      dataset(50, { source: 'auto', deviceId: 10, createdAt: '2026-01-01T00:00:00Z' }),
      dataset(2, { source: 'auto', deviceId: 20, createdAt: '2026-02-01T00:00:00Z' }),
    ];
    expect(getLatestDatasetId(timestamped)).toBe(2);
    expect(getLatestDatasetId([...timestamped, dataset(100, { source: 'manual' })])).toBe(2);
  });
});
