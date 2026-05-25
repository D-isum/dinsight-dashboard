'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
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
  const query = useQuery({
    queryKey: ['platform', 'analytics'],
    queryFn: async () => (await api.platform.analytics.list()).data.data as AnalyticsRow[],
    // Analytics changes slowly; refresh on a 60s tick so the dashboard
    // feels live without hammering the DB.
    refetchInterval: 60_000,
  });

  // The `default` org doubles as the vendor's dogfood customer in
  // the current MVP — Pattern B in the architecture doc. It counts
  // as a customer because it IS one (the vendor uses it to test
  // every feature a real customer would). The `platform` badge on
  // its row marks it as vendor-internal for clarity; nothing about
  // the counts excludes it.
  //
  // Phase 7 (post-GA) will split vendor staff identity from customer
  // tenancy, at which point default becomes a plain customer org
  // and a separate /admin app holds the platform-admin surface.
  const rows = query.data ?? [];
  const totals = aggregate(rows);

  return (
    <section className="space-y-4">
      <header>
        <h3 className="text-sm font-semibold">Fleet analytics</h3>
        <p className="text-xs text-muted-foreground">
          Per-customer counts across devices, members, file uploads, and ingestion. Recomputed every
          60 seconds. The vendor&apos;s own org (<code>default</code>) doubles as the dogfood
          customer and is included in the counts.
        </p>
      </header>

      {query.isSuccess && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="Customers" value={rows.length} />
          <StatCard label="Devices" value={totals.devices} sub={`${totals.devicesActive} active`} />
          <StatCard label="Members" value={totals.members} />
          <StatCard label="Uploads" value={totals.uploads} />
          <StatCard
            label="Ingestion rows"
            value={totals.ingestion}
            sub={totals.ingestionFailed > 0 ? `${totals.ingestionFailed} failed` : 'all clean'}
            tone={totals.ingestionFailed > 0 ? 'warn' : 'ok'}
          />
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Devices</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Uploads</TableHead>
            <TableHead>Ingestion (ok/failed)</TableHead>
            <TableHead>Last ingest</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isLoading && <TableLoading message="Loading analytics…" rowSpan={6} />}
          {query.isError && <TableError message="Failed to load analytics." rowSpan={6} />}
          {query.isSuccess && query.data.length === 0 && (
            <TableEmpty message="No organizations on this platform yet." rowSpan={6} />
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
                      <Badge variant="outline" className="ml-2">
                        platform
                      </Badge>
                    )}
                    <div className="text-xs text-muted-foreground font-mono">{row.org_slug}</div>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{row.device_count_total}</span>
                    <div className="text-xs text-muted-foreground">
                      {row.device_count_active}a / {row.device_count_paused}p /{' '}
                      {row.device_count_retired}r
                    </div>
                  </TableCell>
                  <TableCell>{row.member_count}</TableCell>
                  <TableCell>{row.file_uploads_total}</TableCell>
                  <TableCell>
                    <span className="font-medium">{ingestionOk}</span>
                    <span className="text-muted-foreground"> / </span>
                    <span
                      className={
                        row.ingestion_rows_failed > 0
                          ? 'text-danger-text font-medium'
                          : 'text-muted-foreground'
                      }
                    >
                      {row.ingestion_rows_failed}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.last_ingestion_at ? new Date(row.last_ingestion_at).toLocaleString() : '—'}
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
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value.toLocaleString()}</div>
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
