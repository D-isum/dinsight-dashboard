import type { DinsightDatasetSummary } from '@/lib/dataset-normalizers';

export interface DatasetSourceGroup {
  key: string;
  label: string;
  source: DinsightDatasetSummary['source']['source'];
  datasets: DinsightDatasetSummary[];
}

export function getDatasetSourceGroupKey(dataset: DinsightDatasetSummary): string {
  const { source } = dataset;

  if (source.source === 'manual') {
    return 'manual';
  }

  if (source.source === 'auto') {
    if (source.deviceId != null) return `device-id:${source.deviceId}`;
    if (source.deviceSlug) return `device-slug:${source.deviceSlug}`;
    if (source.iotHubDeviceId) return `iot-device:${source.iotHubDeviceId}`;
    return 'auto-unknown';
  }

  return 'unknown';
}

function getDatasetSourceGroupLabel(dataset: DinsightDatasetSummary): string {
  const { source } = dataset;

  if (source.source === 'manual') return 'Manual uploads';
  if (source.source === 'unknown') return 'Unknown / legacy source';

  return (
    source.deviceName ??
    source.deviceSlug ??
    source.iotHubDeviceId ??
    source.iotHubName ??
    'Unidentified auto-upload device'
  );
}

export function buildDatasetSourceGroups(datasets: DinsightDatasetSummary[]): DatasetSourceGroup[] {
  const groups = new Map<string, DatasetSourceGroup>();

  for (const dataset of datasets) {
    const key = getDatasetSourceGroupKey(dataset);
    const existing = groups.get(key);
    if (existing) {
      existing.datasets.push(dataset);
      continue;
    }

    groups.set(key, {
      key,
      label: getDatasetSourceGroupLabel(dataset),
      source: dataset.source.source,
      datasets: [dataset],
    });
  }

  return Array.from(groups.values()).sort((a, b) => {
    const sourceOrder = { auto: 0, manual: 1, unknown: 2 };
    const bySource = sourceOrder[a.source] - sourceOrder[b.source];
    return bySource !== 0 ? bySource : a.label.localeCompare(b.label);
  });
}

export function filterDatasetsBySourceGroup(
  datasets: DinsightDatasetSummary[],
  sourceGroupKey: string | null
): DinsightDatasetSummary[] {
  if (!sourceGroupKey) return [];
  return datasets.filter((dataset) => getDatasetSourceGroupKey(dataset) === sourceGroupKey);
}

export function getLatestDatasetId(datasets: DinsightDatasetSummary[]): number | null {
  let latest: DinsightDatasetSummary | null = null;

  for (const dataset of datasets) {
    if (!latest) {
      latest = dataset;
      continue;
    }

    const candidateTime = dataset.source.createdAt ? Date.parse(dataset.source.createdAt) : NaN;
    const latestTime = latest.source.createdAt ? Date.parse(latest.source.createdAt) : NaN;

    if (Number.isFinite(candidateTime) && Number.isFinite(latestTime)) {
      if (candidateTime > latestTime) latest = dataset;
      if (candidateTime === latestTime && dataset.dinsight_id > latest.dinsight_id)
        latest = dataset;
      continue;
    }

    if (Number.isFinite(candidateTime) && !Number.isFinite(latestTime)) {
      latest = dataset;
      continue;
    }

    if (!Number.isFinite(candidateTime) && Number.isFinite(latestTime)) {
      continue;
    }

    if (dataset.dinsight_id > latest.dinsight_id) {
      latest = dataset;
    }
  }

  return latest?.dinsight_id ?? null;
}

export function resolveDatasetSourceGroupKey(
  datasets: DinsightDatasetSummary[],
  requestedKey: string | null | undefined
): string | null {
  const groups = buildDatasetSourceGroups(datasets);
  if (requestedKey && groups.some((group) => group.key === requestedKey)) {
    return requestedKey;
  }

  const latestId = getLatestDatasetId(datasets);
  const latestDataset = datasets.find((dataset) => dataset.dinsight_id === latestId);
  return latestDataset ? getDatasetSourceGroupKey(latestDataset) : (groups[0]?.key ?? null);
}

export function formatDatasetOptionLabel(dataset: DinsightDatasetSummary): string {
  const id = `#${dataset.dinsight_id}`;
  if (dataset.source.source === 'auto') {
    const device =
      dataset.source.deviceName ??
      dataset.source.deviceSlug ??
      dataset.source.iotHubDeviceId ??
      'device';
    const file = dataset.source.originalFileName?.split('/').pop() ?? '';
    return file ? `${id} - ${device} - ${file} - Auto` : `${id} - ${device} - Auto`;
  }
  if (dataset.source.source === 'manual') {
    return `${id} - Manual upload`;
  }
  return `${id} - ${dataset.name}`;
}
