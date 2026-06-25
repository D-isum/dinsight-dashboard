import { MetadataEntry } from '@/types';
import {
  alignMetadataLength,
  normalizeMetadataArray,
  normalizeMetadataEntry,
} from '@/utils/metadata';

// Source attribution chain on a dinsight_data row. Auto-ingested
// datasets (Phase 6 IoT Hub upload worker) populate every device_*
// field; manual /analyze uploads leave them blank and `source` is
// "manual". The `source` discriminator drives the badge in the
// dataset picker + catalog table.
export interface DinsightDatasetSource {
  source: 'auto' | 'manual' | 'unknown';
  fileUploadId?: number;
  originalFileName?: string;
  deviceId?: number;
  deviceName?: string;
  deviceSlug?: string;
  iotHubDeviceId?: string;
  iotHubName?: string;
  createdAt?: string;
}

export interface DinsightDatasetSummary {
  dinsight_id: number;
  name: string;
  type: 'dinsight';
  records?: number;
  source: DinsightDatasetSource;
}

// Extracts the source-attribution block from a /dinsight payload.
// Tolerant of legacy backends that don't include the fields — the
// returned source defaults to "unknown" so UI logic stays simple
// (manual fallback in the dataset picker).
export const extractDatasetSource = (data: Record<string, unknown>): DinsightDatasetSource => {
  const rawSource = typeof data.source === 'string' ? data.source : '';
  const source: DinsightDatasetSource['source'] =
    rawSource === 'auto' || rawSource === 'manual' ? rawSource : 'unknown';

  const fileUploadId = toFiniteNumber(data.file_upload_id);
  const deviceId = toFiniteNumber(data.device_id);
  const originalFileName =
    typeof data.original_file_name === 'string' && data.original_file_name.length > 0
      ? (data.original_file_name as string)
      : undefined;
  const deviceName =
    typeof data.device_name === 'string' && data.device_name.length > 0
      ? (data.device_name as string)
      : undefined;
  const deviceSlug =
    typeof data.device_slug === 'string' && data.device_slug.length > 0
      ? (data.device_slug as string)
      : undefined;
  const iotHubDeviceId =
    typeof data.iot_hub_device_id === 'string' && data.iot_hub_device_id.length > 0
      ? (data.iot_hub_device_id as string)
      : undefined;
  const iotHubName =
    typeof data.iot_hub_name === 'string' && data.iot_hub_name.length > 0
      ? (data.iot_hub_name as string)
      : undefined;
  const createdAt =
    typeof data.created_at === 'string' && data.created_at.length > 0
      ? (data.created_at as string)
      : undefined;

  return {
    source,
    fileUploadId: fileUploadId !== null ? fileUploadId : undefined,
    originalFileName,
    deviceId: deviceId !== null ? deviceId : undefined,
    deviceName,
    deviceSlug,
    iotHubDeviceId,
    iotHubName,
    createdAt,
  };
};

export interface CoordinateSeries {
  dinsight_x: number[];
  dinsight_y: number[];
  metadata: MetadataEntry[];
}

const toFiniteNumber = (value: unknown): number | null => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

export const isValidPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export const normalizeDinsightDatasetSummary = (
  id: number,
  payload: unknown
): DinsightDatasetSummary | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const x = Array.isArray(data.dinsight_x) ? data.dinsight_x : null;
  const y = Array.isArray(data.dinsight_y) ? data.dinsight_y : null;

  if (!x || !y || x.length === 0 || y.length === 0) {
    return null;
  }

  const resolvedId =
    typeof data.dinsight_id === 'number' && data.dinsight_id > 0 ? data.dinsight_id : id;

  return {
    dinsight_id: resolvedId,
    name: `Dataset #${resolvedId}`,
    type: 'dinsight',
    records: Math.min(x.length, y.length),
    source: extractDatasetSource(data),
  };
};

export const normalizeCoordinateSeriesFromDinsightPayload = (
  payload: unknown,
  includeMetadata = true
): CoordinateSeries | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const rawX = Array.isArray(data.dinsight_x) ? data.dinsight_x : [];
  const rawY = Array.isArray(data.dinsight_y) ? data.dinsight_y : [];

  const x: number[] = [];
  const y: number[] = [];

  const size = Math.min(rawX.length, rawY.length);
  for (let i = 0; i < size; i++) {
    const xValue = toFiniteNumber(rawX[i]);
    const yValue = toFiniteNumber(rawY[i]);
    if (xValue == null || yValue == null) {
      continue;
    }
    x.push(xValue);
    y.push(yValue);
  }

  if (x.length === 0 || y.length === 0) {
    return null;
  }

  const metadata = includeMetadata
    ? alignMetadataLength(normalizeMetadataArray(data.point_metadata), x.length)
    : [];

  return {
    dinsight_x: x,
    dinsight_y: y,
    metadata,
  };
};

export const normalizeCoordinateSeriesFromMonitoringRows = (
  payload: unknown,
  includeMetadata = true
): CoordinateSeries | null => {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : payload &&
        typeof payload === 'object' &&
        Array.isArray((payload as Record<string, unknown>).data)
      ? ((payload as Record<string, unknown>).data as unknown[])
      : [];

  if (rows.length === 0) {
    return null;
  }

  const x: number[] = [];
  const y: number[] = [];
  const metadata: MetadataEntry[] = [];

  rows.forEach((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return;
    }

    const data = row as Record<string, unknown>;
    const xValue = toFiniteNumber(data.dinsight_x);
    const yValue = toFiniteNumber(data.dinsight_y);

    if (xValue == null || yValue == null) {
      return;
    }

    x.push(xValue);
    y.push(yValue);
    metadata.push(includeMetadata ? normalizeMetadataEntry(data.metadata) : {});
  });

  if (x.length === 0 || y.length === 0) {
    return null;
  }

  return {
    dinsight_x: x,
    dinsight_y: y,
    metadata: includeMetadata ? alignMetadataLength(metadata, x.length) : [],
  };
};

export const normalizeCoordinateSeriesFromMonitoringCoordinates = (
  payload: unknown,
  includeMetadata = true
): CoordinateSeries | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const rawX = Array.isArray(data.dinsight_x) ? data.dinsight_x : [];
  const rawY = Array.isArray(data.dinsight_y) ? data.dinsight_y : [];

  const x: number[] = [];
  const y: number[] = [];

  const size = Math.min(rawX.length, rawY.length);
  for (let i = 0; i < size; i++) {
    const xValue = toFiniteNumber(rawX[i]);
    const yValue = toFiniteNumber(rawY[i]);
    if (xValue == null || yValue == null) {
      continue;
    }
    x.push(xValue);
    y.push(yValue);
  }

  if (x.length === 0 || y.length === 0) {
    return null;
  }

  const metadata = includeMetadata
    ? alignMetadataLength(normalizeMetadataArray(data.metadata), x.length)
    : [];

  return {
    dinsight_x: x,
    dinsight_y: y,
    metadata,
  };
};
