'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { useI18n } from '@/i18n/client';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableError,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from '@/components/ui/table';

// PlatformAnalyticsSection is the vendor-admin "ops at a glance"
// surface. One row per organization with the counts the support /
// account teams ask for first: how many devices, how many members,
// how much data have they pushed, and when was the last ingest.
// Numbers come from a single backend round-trip
// (GET /api/v1/platform/analytics) that runs subselects against
// devices + memberships + file_uploads + blob_ingestion_log.

interface AnalyticsRow {
  org_id: number;
  org_name: string;
  org_slug: string;
  device_count_total: number;
  device_count_active: number;
  device_count_paused: number;
  device_count_retired: number;
  member_count: number;
  file_uploads_total: number;
  ingestion_rows_total: number;
  ingestion_rows_failed: number;
  last_ingestion_at?: string;
}

export function PlatformAnalyticsSection() {
  const { t, formatDate, formatNumber } = useI18n();
  const query = useQuery({
    queryKey: ['platform', 'analytics'],
    queryFn: async () => (await api.platform.analytics.list()).data.data as AnalyticsRow[],
    // Analytics changes slowly; refresh on a 60s tick so the dashboard
    // feels live without hammering the DB.
    refetchInterval: 60_000,
  });

  // The seeded default org is included in fleet analytics and marked
  // with a platform badge so staff can distinguish internal activity
  // from customer activity.
  const rows = query.data ?? [];
  const totals = aggregate(rows);

  return (
    <section className="space-y-4">
      <header>
        <h3 className="text-sm font-semibold">{t('admin.fleetAnalytics')}</h3>
        <p className="text-xs text-muted-foreground">
          {t('admin.fleetAnalyticsDescription', { slug: 'default' })}
        </p>
      </header>

      {query.isSuccess && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label={t('admin.customers')} value={rows.length} />
          <StatCard
            label={t('admin.devices')}
            value={totals.devices}
            sub={`${formatNumber(totals.devicesActive)} ${t('admin.active')}`}
          />
          <StatCard label={t('admin.members')} value={totals.members} />
          <StatCard label={t('admin.uploads')} value={totals.uploads} />
          <StatCard
            label={t('admin.ingestionRows')}
            value={totals.ingestion}
            sub={
              totals.ingestionFailed > 0
                ? `${formatNumber(totals.ingestionFailed)} ${t('admin.failed')}`
                : t('admin.allClean')
            }
            tone={totals.ingestionFailed > 0 ? 'warn' : 'ok'}
          />
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.customer')}</TableHead>
            <TableHead>{t('admin.devices')}</TableHead>
            <TableHead>{t('admin.members')}</TableHead>
            <TableHead>{t('admin.uploads')}</TableHead>
            <TableHead>{t('admin.ingestionOkFailed')}</TableHead>
            <TableHead>{t('admin.lastIngest')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isLoading && <TableLoading message={t('admin.loadingAnalytics')} rowSpan={6} />}
          {query.isError && <TableError message={t('admin.failedLoadAnalytics')} rowSpan={6} />}
          {query.isSuccess && query.data.length === 0 && (
            <TableEmpty message={t('admin.noOrganizations')} rowSpan={6} />
          )}
          {query.isSuccess &&
            query.data.map((row) => {
              const isDefault = row.org_slug === 'default';
              const ingestionOk = row.ingestion_rows_total - row.ingestion_rows_failed;
              return (
                <TableRow key={row.org_id}>
                  <TableCell className="font-medium">
                    {row.org_name}
                    {isDefault && (
                      <Badge variant="outline" className="ms-2">
                        {t('admin.platform')}
                      </Badge>
                    )}
                    <div className="text-xs text-muted-foreground font-mono">{row.org_slug}</div>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{row.device_count_total}</span>
                    <div className="text-xs text-muted-foreground">
                      {formatNumber(row.device_count_active)} {t('admin.active')} ·{' '}
                      {formatNumber(row.device_count_paused)} {t('admin.paused')} ·{' '}
                      {formatNumber(row.device_count_retired)} {t('admin.retired')}
                    </div>
                  </TableCell>
                  <TableCell>{formatNumber(row.member_count)}</TableCell>
                  <TableCell>{formatNumber(row.file_uploads_total)}</TableCell>
                  <TableCell>
                    <span className="font-medium">{formatNumber(ingestionOk)}</span>
                    <span className="text-muted-foreground"> / </span>
                    <span
                      className={
                        row.ingestion_rows_failed > 0
                          ? 'text-danger-text font-medium'
                          : 'text-muted-foreground'
                      }
                    >
                      {formatNumber(row.ingestion_rows_failed)}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.last_ingestion_at
                      ? formatDate(row.last_ingestion_at, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </section>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: 'ok' | 'warn';
}) {
  const { formatNumber } = useI18n();
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{formatNumber(value)}</div>
      {sub && (
        <div
          className={tone === 'warn' ? 'text-xs text-danger-text' : 'text-xs text-muted-foreground'}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function aggregate(rows: AnalyticsRow[]) {
  return rows.reduce(
    (acc, r) => ({
      devices: acc.devices + r.device_count_total,
      devicesActive: acc.devicesActive + r.device_count_active,
      members: acc.members + r.member_count,
      uploads: acc.uploads + r.file_uploads_total,
      ingestion: acc.ingestion + r.ingestion_rows_total,
      ingestionFailed: acc.ingestionFailed + r.ingestion_rows_failed,
    }),
    { devices: 0, devicesActive: 0, members: 0, uploads: 0, ingestion: 0, ingestionFailed: 0 }
  );
}
