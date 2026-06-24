export type AxisRange = [number, number];

interface AxisRangeOptions {
  includeZero?: boolean;
  lowerBound?: number;
  upperBound?: number;
  minSpan?: number;
  paddingRatio?: number;
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
