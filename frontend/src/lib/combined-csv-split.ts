export type CombinedRangeType = 'datetime' | 'number';

export interface CombinedCsvSplitOptions {
  splitColumn: string;
  rangeType: CombinedRangeType;
  baselineStart: string;
  baselineEnd: string;
  monitoringStart: string;
  monitoringEnd: string;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

export interface CombinedCsvSplitResult {
  baselineFile: File;
  monitoringFile: File;
  baselineRows: number;
  monitoringRows: number;
  totalRows: number;
}

export interface CombinedCsvSplitPreview {
  baselineRows: number;
  monitoringRows: number;
  overlapRows: number;
  unmatchedRows: number;
  totalRows: number;
  splitColumn: string;
  firstValue: string;
  lastValue: string;
  minValue: string;
  maxValue: string;
}

const delimiterCandidates = [',', ';', '\t', '|'];

const normalizeText = (raw: string) =>
  raw
    .replace(/\u0000/g, '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n|\r/g, '\n');

const decodeFileText = async (file: File): Promise<string> => {
  const maybeFile = file as File & {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    text?: () => Promise<string>;
  };

  if (typeof maybeFile.text === 'function' && typeof maybeFile.arrayBuffer !== 'function') {
    return normalizeText(await maybeFile.text());
  }

  const buffer =
    typeof maybeFile.arrayBuffer === 'function'
      ? await maybeFile.arrayBuffer()
      : await new Response(file).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 2) {
    const bomLE = bytes[0] === 0xff && bytes[1] === 0xfe;
    const bomBE = bytes[0] === 0xfe && bytes[1] === 0xff;
    if (bomLE || bomBE) {
      return normalizeText(new TextDecoder(bomLE ? 'utf-16le' : 'utf-16be').decode(bytes));
    }
  }
  return normalizeText(new TextDecoder('utf-8').decode(bytes));
};

const countDelimiterOutsideQuotes = (line: string, delimiter: string): number => {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === delimiter) {
      count += 1;
    }
  }
  return count;
};

export const detectCsvDelimiter = (headerLine: string): string =>
  delimiterCandidates.reduce((best, candidate) =>
    countDelimiterOutsideQuotes(headerLine, candidate) >
    countDelimiterOutsideQuotes(headerLine, best)
      ? candidate
      : best
  );

const parseRows = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(field);
      field = '';
      continue;
    }

    if (!quoted && char === '\n') {
      row.push(field);
      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim().length > 0)) {
    rows.push(row);
  }

  return rows;
};

export const parseCsv = (text: string): ParsedCsv => {
  const normalized = normalizeText(text);
  const firstLine = normalized.split('\n').find((line) => line.trim().length > 0) ?? '';
  if (!firstLine) {
    throw new Error('CSV must contain a header row.');
  }

  const delimiter = detectCsvDelimiter(firstLine);
  const parsedRows = parseRows(normalized, delimiter);
  if (parsedRows.length < 2) {
    throw new Error('CSV must contain a header row and at least one data row.');
  }

  const headers = parsedRows[0].map((header) => header.trim());
  if (headers.length < 2 || headers.some((header) => header.length === 0)) {
    throw new Error('CSV header contains empty or invalid column names.');
  }

  return {
    headers,
    rows: parsedRows.slice(1),
    delimiter,
  };
};

const resolveColumnIndex = (headers: string[], splitColumn: string): number => {
  const exact = headers.indexOf(splitColumn);
  if (exact >= 0) {
    return exact;
  }
  const lower = splitColumn.toLowerCase();
  return headers.findIndex((header) => header.toLowerCase() === lower);
};

const parseDelimitedDateTime = (value: string): number | null => {
  const match = value.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4] ?? 0);
  const minutes = Number(match[5] ?? 0);
  const seconds = Number(match[6] ?? 0);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hours > 23 ||
    minutes > 59 ||
    seconds > 59
  ) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, hours, minutes, seconds, 0);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hours ||
    parsed.getMinutes() !== minutes ||
    parsed.getSeconds() !== seconds
  ) {
    return null;
  }

  return parsed.getTime();
};

const parseTimeLikeValue = (value: string): number => {
  const normalized = value.trim().replace(/\s+/g, ' ');

  const delimitedDateTime = parseDelimitedDateTime(normalized);
  if (delimitedDateTime !== null) {
    return delimitedDateTime;
  }

  const parsed = Date.parse(normalized);
  if (Number.isFinite(parsed)) {
    return parsed;
  }

  const normalizedSpace = Date.parse(normalized.replace(' ', 'T'));
  if (Number.isFinite(normalizedSpace)) {
    return normalizedSpace;
  }

  const timeOnly = normalized.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnly) {
    const hours = Number(timeOnly[1]);
    const minutes = Number(timeOnly[2]);
    const seconds = Number(timeOnly[3] ?? 0);
    if (hours < 24 && minutes < 60 && seconds < 60) {
      return (hours * 3600 + minutes * 60 + seconds) * 1000;
    }
  }

  throw new Error(`Unable to parse "${value}" as a date/time value.`);
};

const parseComparableValue = (value: string, rangeType: CombinedRangeType): number => {
  if (rangeType === 'number') {
    const parsed = Number(value.trim());
    if (!Number.isFinite(parsed)) {
      throw new Error(`Unable to parse "${value}" as a numeric/day value.`);
    }
    return parsed;
  }
  return parseTimeLikeValue(value);
};

const parseRangeBounds = (options: CombinedCsvSplitOptions) => {
  const baselineStart = parseComparableValue(options.baselineStart, options.rangeType);
  const baselineEnd = parseComparableValue(options.baselineEnd, options.rangeType);
  const monitoringStart = parseComparableValue(options.monitoringStart, options.rangeType);
  const monitoringEnd = parseComparableValue(options.monitoringEnd, options.rangeType);

  if (baselineStart > baselineEnd) {
    throw new Error('Baseline start must be before or equal to baseline stop.');
  }
  if (monitoringStart > monitoringEnd) {
    throw new Error('Monitoring start must be before or equal to monitoring stop.');
  }

  return {
    baselineStart,
    baselineEnd,
    monitoringStart,
    monitoringEnd,
  };
};

const inInclusiveRange = (
  value: string,
  start: string,
  end: string,
  rangeType: CombinedRangeType
): boolean => {
  const comparable = parseComparableValue(value, rangeType);
  const startValue = parseComparableValue(start, rangeType);
  const endValue = parseComparableValue(end, rangeType);
  return comparable >= startValue && comparable <= endValue;
};

const inParsedRange = (value: number, start: number, end: number): boolean =>
  value >= start && value <= end;

const csvEscape = (value: string): string => {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

const buildCsv = (headers: string[], rows: string[][]): string => {
  const lineFor = (row: string[]) =>
    headers.map((_, index) => csvEscape(row[index] ?? '')).join(',');
  return [headers.map(csvEscape).join(','), ...rows.map(lineFor)].join('\n') + '\n';
};

const splitBaseName = (name: string): string => name.replace(/\.[^.]+$/, '') || 'combined';

export const previewCombinedCsvSplitFile = async (
  file: File,
  options: CombinedCsvSplitOptions
): Promise<CombinedCsvSplitPreview> => {
  const parsed = parseCsv(await decodeFileText(file));
  const splitIndex = resolveColumnIndex(parsed.headers, options.splitColumn);
  if (splitIndex < 0) {
    throw new Error('Selected split column was not found in the CSV headers.');
  }

  const bounds = parseRangeBounds(options);
  let baselineRows = 0;
  let monitoringRows = 0;
  let overlapRows = 0;
  let unmatchedRows = 0;
  let minComparable = Number.POSITIVE_INFINITY;
  let maxComparable = Number.NEGATIVE_INFINITY;
  let minValue = '';
  let maxValue = '';

  for (const row of parsed.rows) {
    const rawValue = row[splitIndex] ?? '';
    const comparable = parseComparableValue(rawValue, options.rangeType);
    if (comparable < minComparable) {
      minComparable = comparable;
      minValue = rawValue;
    }
    if (comparable > maxComparable) {
      maxComparable = comparable;
      maxValue = rawValue;
    }

    const isBaseline = inParsedRange(comparable, bounds.baselineStart, bounds.baselineEnd);
    const isMonitoring = inParsedRange(comparable, bounds.monitoringStart, bounds.monitoringEnd);
    if (isBaseline) {
      baselineRows += 1;
    }
    if (isMonitoring) {
      monitoringRows += 1;
    }
    if (isBaseline && isMonitoring) {
      overlapRows += 1;
    }
    if (!isBaseline && !isMonitoring) {
      unmatchedRows += 1;
    }
  }

  return {
    baselineRows,
    monitoringRows,
    overlapRows,
    unmatchedRows,
    totalRows: parsed.rows.length,
    splitColumn: parsed.headers[splitIndex],
    firstValue: parsed.rows[0]?.[splitIndex] ?? '',
    lastValue: parsed.rows[parsed.rows.length - 1]?.[splitIndex] ?? '',
    minValue,
    maxValue,
  };
};

export const splitCombinedCsvFile = async (
  file: File,
  options: CombinedCsvSplitOptions
): Promise<CombinedCsvSplitResult> => {
  const parsed = parseCsv(await decodeFileText(file));
  const splitIndex = resolveColumnIndex(parsed.headers, options.splitColumn);
  if (splitIndex < 0) {
    throw new Error('Selected split column was not found in the CSV headers.');
  }

  parseRangeBounds(options);

  const baselineRows: string[][] = [];
  const monitoringRows: string[][] = [];

  for (const row of parsed.rows) {
    const rawValue = row[splitIndex] ?? '';
    if (inInclusiveRange(rawValue, options.baselineStart, options.baselineEnd, options.rangeType)) {
      baselineRows.push(row);
      continue;
    }
    if (
      inInclusiveRange(rawValue, options.monitoringStart, options.monitoringEnd, options.rangeType)
    ) {
      monitoringRows.push(row);
    }
  }

  if (baselineRows.length === 0) {
    throw new Error('Baseline range did not match any rows.');
  }
  if (monitoringRows.length === 0) {
    throw new Error('Monitoring range did not match any rows.');
  }

  const baseName = splitBaseName(file.name);
  const baselineFile = new File(
    [buildCsv(parsed.headers, baselineRows)],
    `${baseName}-baseline.csv`,
    {
      type: 'text/csv',
    }
  );
  const monitoringFile = new File(
    [buildCsv(parsed.headers, monitoringRows)],
    `${baseName}-monitoring.csv`,
    { type: 'text/csv' }
  );

  return {
    baselineFile,
    monitoringFile,
    baselineRows: baselineRows.length,
    monitoringRows: monitoringRows.length,
    totalRows: parsed.rows.length,
  };
};
