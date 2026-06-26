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

// PlatformDevicesSection is the vendor-admin cross-org devices view.
// Read-only by design: vendor admins see every device on the platform
// with the owning org's slug for grouping. Writes (rename / pause /
// rotate-key) stay on the customer side so vendor admins can't
// silently modify customer state without going through support mode.

interface PlatformDeviceRow {
  device_id: number;
  uuid: string;
  organization_id: number;
  organization_name: string;
  organization_slug: string;
  name: string;
  slug: string;
  blob_path_prefix: string;
  status: 'active' | 'paused' | 'retired';
  iot_hub_name?: string;
  iot_hub_device_id?: string;
  api_key_hint?: string; // legacy; only set on pre-IoT-Hub rows
  last_ingested_at?: string;
  last_ingest_error?: string;
  created_at: string;
}

export function PlatformDevicesSection() {
  const { t, formatDate } = useI18n();
  const query = useQuery({
    queryKey: ['platform', 'devices'],
    queryFn: async () => (await api.platform.devices.list()).data.data as PlatformDeviceRow[],
  });

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t('admin.allDevices')}</h3>
      <p className="text-xs text-muted-foreground">{t('admin.allDevicesDescription')}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin.org')}</TableHead>
            <TableHead>{t('admin.device')}</TableHead>
            <TableHead>{t('admin.deviceIdentity')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead>{t('admin.lastIngested')}</TableHead>
            <TableHead>{t('admin.created')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isLoading && <TableLoading message={t('admin.loadingDevices')} rowSpan={6} />}
          {query.isError && <TableError message={t('admin.failedLoadDevices')} rowSpan={6} />}
          {query.isSuccess && query.data.length === 0 && (
            <TableEmpty message={t('admin.noDevices')} rowSpan={6} />
          )}
          {query.isSuccess &&
            query.data.map((d) => (
              <TableRow key={d.device_id}>
                <TableCell className="font-medium">
                  {d.organization_name}
                  <div className="text-xs text-muted-foreground">{d.organization_slug}</div>
                </TableCell>
                <TableCell>
                  {d.name}
                  <div className="text-xs text-muted-foreground">{d.slug}</div>
                </TableCell>
                <TableCell className="text-xs font-mono text-muted-foreground">
                  {d.iot_hub_device_id ? (
                    <>
                      {d.iot_hub_device_id}
                      {d.iot_hub_name && (
                        <div className="text-[10px]">{t('admin.hub', { name: d.iot_hub_name })}</div>
                      )}
                    </>
                  ) : (
                    <span className="italic">{t('admin.legacyNotLinked')}</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={d.status === 'active' ? 'default' : 'secondary'}>
                    {d.status === 'active'
                      ? t('admin.active')
                      : d.status === 'paused'
                        ? t('admin.paused')
                        : t('admin.retired')}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {d.last_ingested_at
                    ? formatDate(d.last_ingested_at, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })
                    : '—'}
                  {d.last_ingest_error && (
                    <div className="text-danger-text">{d.last_ingest_error}</div>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDate(d.created_at, { dateStyle: 'medium', timeStyle: 'short' })}
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </section>
  );
}
