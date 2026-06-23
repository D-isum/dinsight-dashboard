import { describe, expect, it } from 'vitest';
import { detectCsvDelimiter, parseCsv, splitCombinedCsvFile } from '@/lib/combined-csv-split';

const fileLike = (content: string, name: string): File =>
  ({
    name,
    arrayBuffer: async () => new TextEncoder().encode(content).buffer,
  }) as unknown as File;

describe('combined-csv-split', () => {
  it('detects delimiters outside quoted header cells', () => {
    expect(detectCsvDelimiter('"device,name";timestamp;f_0')).toBe(';');
  });

  it('parses quoted CSV cells', () => {
    const parsed = parseCsv('timestamp,note,f_0\n2026-01-01,"pump, A",1\n');
    expect(parsed.headers).toEqual(['timestamp', 'note', 'f_0']);
    expect(parsed.rows[0]).toEqual(['2026-01-01', 'pump, A', '1']);
  });

  it('splits one CSV into baseline and monitoring files by timestamp range', async () => {
    const file = fileLike(
      [
        'timestamp,asset,f_0',
        '2026-01-01 00:00,A,1',
        '2026-01-02 00:00,A,2',
        '2026-01-03 00:00,A,3',
        '2026-01-04 00:00,A,4',
      ].join('\n'),
      'combined.csv'
    );

    const split = await splitCombinedCsvFile(file, {
      splitColumn: 'timestamp',
      rangeType: 'datetime',
      baselineStart: '2026-01-01 00:00',
      baselineEnd: '2026-01-02 23:59',
      monitoringStart: '2026-01-03 00:00',
      monitoringEnd: '2026-01-04 23:59',
    });

    expect(split.baselineRows).toBe(2);
    expect(split.monitoringRows).toBe(2);
    expect(split.baselineFile.name).toBe('combined-baseline.csv');
    expect(split.monitoringFile.name).toBe('combined-monitoring.csv');
  });

  it('splits by numeric day ranges', async () => {
    const file = fileLike('day,asset,f_0\n1,A,10\n2,A,20\n3,A,30\n', 'days.csv');

    const split = await splitCombinedCsvFile(file, {
      splitColumn: 'day',
      rangeType: 'number',
      baselineStart: '1',
      baselineEnd: '2',
      monitoringStart: '3',
      monitoringEnd: '3',
    });

    expect(split.baselineRows).toBe(2);
    expect(split.monitoringRows).toBe(1);
  });
});
