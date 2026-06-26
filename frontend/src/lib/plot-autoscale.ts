export type AxisRange = [number, number];

interface AxisRangeOptions {
  includeZero?: boolean;
  lowerBound?: number;
  upperBound?: number;
  minSpan?: number;
  paddingRatio?: number;
}

interface AxisRangeExpansionOptions {
  factor?: number;
  minSpan?: number;
}

const DEFAULT_MIN_SPAN = 1;
const DEFAULT_PADDING_RATIO = 0.08;

export function buildPaddedAxisRange(
  values: Array<number | null | undefined>,
  options: AxisRangeOptions = {}
): AxisRange | undefined {
  const finiteValues = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );

  if (options.includeZero) {
    finiteValues.push(0);
  }

  if (finiteValues.length === 0) {
    return undefined;
  }

  let min = Math.min(...finiteValues);
  let max = Math.max(...finiteValues);
  const minSpan = options.minSpan ?? DEFAULT_MIN_SPAN;
  const paddingRatio = options.paddingRatio ?? DEFAULT_PADDING_RATIO;

  if (min === max) {
    const span = Math.max(Math.abs(max), minSpan);
    min -= span / 2;
    max += span / 2;
  } else {
    const padding = Math.max((max - min) * paddingRatio, minSpan * 0.02);
    min -= padding;
    max += padding;
  }

  if (typeof options.lowerBound === 'number') {
    min = Math.max(options.lowerBound, min);
  }
  if (typeof options.upperBound === 'number') {
    max = Math.min(options.upperBound, max);
  }

  if (min >= max) {
    max = min + minSpan;
  }

  return [min, max];
}

export function axisRangeRevisionPart(range: AxisRange | undefined): string {
  if (!range) return 'auto';
  return range.map((value) => value.toPrecision(8)).join(':');
}

export function expandAxisRange(
  range: AxisRange | undefined,
  options: AxisRangeExpansionOptions = {}
): AxisRange | undefined {
  if (!range) {
    return undefined;
  }

  const [min, max] = range;
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return range;
  }

  const factor = Math.max(1, options.factor ?? 1);
  const targetSpan = Math.max(span * factor, options.minSpan ?? 0);
  const center = (min + max) / 2;

  return [center - targetSpan / 2, center + targetSpan / 2];
}

export function plotRevisionFromParts(parts: Array<string | number | null | undefined>): number {
  const key = parts.map((part) => (part == null ? '' : String(part))).join('|');
  let hash = 2166136261;

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
