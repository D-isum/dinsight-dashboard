'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PauseCircle, PlayCircle, RefreshCcw, Trash2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { usePermission } from '@/components/auth/require-permission';
import { Actions } from '@/lib/permissions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { useI18n } from '@/i18n/client';

// DevicesSection is the customer-side Devices admin surface.
//
// Post the May 2026 IoT Hub pivot, devices are NOT created from the
// dashboard. They are registered in Azure IoT Hub by the vendor side
// (currently manual; the vendor's registration API will replace the
// manual step). The connection string is loaded onto the physical
// device by the vendor before deployment — the customer admin never
// touches credentials.
//
// What the customer admin CAN do here:
//   - See every device in their fleet with status + last-ingested
//     timestamp.
//   - Pause / resume ingestion for a device (e.g. during planned
//     downtime).
//   - Trigger a manual "Sync now" pass.
//   - Delete a device they no longer want surfaced in the dashboard
//     (historical data stays).
//
// What they CANNOT do here:
//   - Add a new device (vendor-managed; contact support).
//   - View or rotate the device's IoT Hub credential (vendor-managed).

type DeviceStatus = 'active' | 'paused' | 'retired';

interface DeviceRow {
  id: number;
  uuid: string;
  organization_id: number;
  name: string;
  slug: string;
  blob_path_prefix: string;
  description?: string;
  status: DeviceStatus;
  iot_hub_name?: string;
  iot_hub_device_id?: string;
  last_ingested_at?: string;
  last_ingest_error?: string;
  created_at: string;
  updated_at: string;
}

const STATUS_BADGE: Record<
  DeviceStatus,
  { labelKey: string; variant: 'default' | 'outline' | 'secondary' }
> = {
  active: { labelKey: 'settings.active', variant: 'default' },
  paused: { labelKey: 'settings.paused', variant: 'secondary' },
  retired: { labelKey: 'settings.retired', variant: 'outline' },
};

export function DevicesSection() {
  const { t } = useI18n();
  const canUpdate = usePermission(Actions.DeviceUpdate);
  const canDelete = usePermission(Actions.DeviceDelete);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold">{t('settings.devices')}</h2>
        <p className="text-sm text-muted-foreground">{t('settings.devicesDescription')}</p>
        <p className="text-xs text-muted-foreground">{t('settings.devicesSupportHint')}</p>
      </header>

      <DevicesTable canUpdate={canUpdate} canDelete={canDelete} />
    </div>
  );
}

// ---------- Devices table ----------

// alertKind separates "expected config gap" notifications (info,
// non-destructive) from real errors. The backend returns specific
// codes for the config-gap cases so we can pick the right tone.
type AlertKind = 'info' | 'error';

interface DeviceAlert {
  kind: AlertKind;
  title: string;
  message: string;
}

function classifyError(
  err: unknown,
  fallbackTitle: string,
  t: (key: string, values?: Record<string, string | number>) => string
): DeviceAlert {
  const { code, message } = extractApiErrorParts(err);
  if (code === 'BLOB_DISABLED' || code === 'INGESTION_CONTAINER_NOT_CONFIGURED') {
    return {
      kind: 'info',
      title: t('settings.cloudSyncUnavailable'),
      message: message ?? t('settings.cloudSyncUnavailableDescription'),
    };
  }
  return {
    kind: 'error',
    title: fallbackTitle,
    message: message ?? t('settings.deviceActionFailed', { action: fallbackTitle.toLowerCase() }),
  };
}

function DevicesTable({ canUpdate, canDelete }: { canUpdate: boolean; canDelete: boolean }) {
  const qc = useQueryClient();
  const { t, formatDate } = useI18n();
  const query = useQuery({
    queryKey: ['devices'],
    queryFn: async () => (await api.devices.list()).data.data as DeviceRow[],
  });
  const [alert, setAlert] = useState<DeviceAlert | null>(null);

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { status?: DeviceStatus } }) =>
      api.devices.update(id, data),
    onSuccess: () => {
      setAlert(null);
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (err) => setAlert(classifyError(err, t('settings.failedUpdateDevice'), t)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.devices.delete(id),
    onSuccess: () => {
      setAlert(null);
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (err) => setAlert(classifyError(err, t('settings.failedRemoveDevice'), t)),
  });

  const syncMutation = useMutation({
    mutationFn: (id: number) => api.devices.syncNow(id),
    onSuccess: () => {
      setAlert(null);
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (err) => setAlert(classifyError(err, t('settings.syncFailed'), t)),
  });

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t('settings.currentDevices')}</h3>

      {alert && (
        <Alert variant={alert.kind === 'error' ? 'destructive' : 'default'}>
          <AlertTitle>{alert.title}</AlertTitle>
          <AlertDescription>{alert.message}</AlertDescription>
        </Alert>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('settings.name')}</TableHead>
            <TableHead>{t('admin.deviceIdentity')}</TableHead>
            <TableHead>{t('settings.status')}</TableHead>
            <TableHead>{t('admin.lastIngested')}</TableHead>
            {(canUpdate || canDelete) && <TableHead aria-label={t('common.actions')} />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isLoading && <TableLoading message={t('settings.loadingDevices')} rowSpan={5} />}
          {query.isError && <TableError message={t('settings.failedLoadDevices')} rowSpan={5} />}
          {query.isSuccess && query.data.length === 0 && (
            <TableEmpty message={t('settings.noDevicesProvisioned')} rowSpan={5} />
          )}
          {query.isSuccess &&
            query.data.map((d) => {
              const statusInfo = STATUS_BADGE[d.status];
              const hasIoTHub = !!d.iot_hub_device_id;
              return (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">
                    {d.name}
                    {d.description && (
                      <div className="text-xs text-muted-foreground">{d.description}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {hasIoTHub ? (
                      <>
                        {d.iot_hub_device_id}
                        {d.iot_hub_name && (
                          <div className="text-[10px]">
                            {t('admin.hub', { name: d.iot_hub_name })}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="italic text-muted-foreground">
                        {t('settings.notYetLinked')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusInfo.variant}>{t(statusInfo.labelKey)}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {d.last_ingested_at
                      ? formatDate(d.last_ingested_at, { dateStyle: 'medium', timeStyle: 'short' })
                      : '—'}
                    {d.last_ingest_error && (
                      <div className="text-danger-text">{d.last_ingest_error}</div>
                    )}
                  </TableCell>
                  {(canUpdate || canDelete) && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canUpdate && d.status === 'active' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1"
                            disabled={syncMutation.isPending || !hasIoTHub}
                            title={
                              hasIoTHub
                                ? t('settings.syncNowHint')
                                : t('settings.syncRequiresIotHub')
                            }
                            onClick={() => syncMutation.mutate(d.id)}
                          >
                            <RefreshCcw className="h-4 w-4" /> {t('settings.syncNow')}
                          </Button>
                        )}
                        {canUpdate && d.status === 'active' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1"
                            disabled={updateMutation.isPending}
                            onClick={() =>
                              updateMutation.mutate({ id: d.id, data: { status: 'paused' } })
                            }
                          >
                            <PauseCircle className="h-4 w-4" /> {t('settings.pause')}
                          </Button>
                        )}
                        {canUpdate && d.status === 'paused' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1"
                            disabled={updateMutation.isPending}
                            onClick={() =>
                              updateMutation.mutate({ id: d.id, data: { status: 'active' } })
                            }
                          >
                            <PlayCircle className="h-4 w-4" /> {t('settings.resume')}
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-destructive hover:text-destructive"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (
                                window.confirm(t('settings.removeDeviceConfirm', { name: d.name }))
                              ) {
                                deleteMutation.mutate(d.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" /> {t('settings.remove')}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </section>
  );
}

// ---------- helpers ----------

interface ApiErrorShape {
  response?: {
    data?: {
      error?: { message?: string; code?: string };
    };
  };
  message?: string;
}

function extractApiErrorParts(err: unknown): { code: string | null; message: string | null } {
  if (!err) return { code: null, message: null };
  const e = err as ApiErrorShape;
  const code = e?.response?.data?.error?.code ?? null;
  const message = e?.response?.data?.error?.message ?? e?.message ?? null;
  return { code, message };
}
