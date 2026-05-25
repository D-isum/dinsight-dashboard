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
  { label: string; variant: 'default' | 'outline' | 'secondary' }
> = {
  active: { label: 'Active', variant: 'default' },
  paused: { label: 'Paused', variant: 'secondary' },
  retired: { label: 'Retired', variant: 'outline' },
};

export function DevicesSection() {
  const canUpdate = usePermission(Actions.DeviceUpdate);
  const canDelete = usePermission(Actions.DeviceDelete);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold">Devices</h2>
        <p className="text-sm text-muted-foreground">
          Each device is one physical machine being monitored. Devices are registered by your
          Dinsight provider — the mobile app on each device authenticates to Azure IoT Hub with a
          device-scoped credential that arrives pre-loaded. From this page you can monitor
          ingestion, pause a device for planned downtime, or trigger a manual sync.
        </p>
        <p className="text-xs text-muted-foreground">
          Need to add a new device or rotate a credential? Contact support — it&apos;s a
          vendor-managed action.
        </p>
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

function classifyError(err: unknown, fallbackTitle: string): DeviceAlert {
  const { code, message } = extractApiErrorParts(err);
  if (code === 'BLOB_DISABLED' || code === 'INGESTION_CONTAINER_NOT_CONFIGURED') {
    return {
      kind: 'info',
      title: 'Cloud sync not available here',
      message:
        message ??
        'Cloud storage is not configured in this environment. Sync only runs against production Azure.',
    };
  }
  return {
    kind: 'error',
    title: fallbackTitle,
    message: message ?? `${fallbackTitle.toLowerCase()}.`,
  };
}

function DevicesTable({ canUpdate, canDelete }: { canUpdate: boolean; canDelete: boolean }) {
  const qc = useQueryClient();
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
    onError: (err) => setAlert(classifyError(err, 'Failed to update device')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.devices.delete(id),
    onSuccess: () => {
      setAlert(null);
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (err) => setAlert(classifyError(err, 'Failed to remove device')),
  });

  const syncMutation = useMutation({
    mutationFn: (id: number) => api.devices.syncNow(id),
    onSuccess: () => {
      setAlert(null);
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (err) => setAlert(classifyError(err, 'Sync failed')),
  });

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Current devices</h3>

      {alert && (
        <Alert variant={alert.kind === 'error' ? 'destructive' : 'default'}>
          <AlertTitle>{alert.title}</AlertTitle>
          <AlertDescription>{alert.message}</AlertDescription>
        </Alert>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>IoT Hub identity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last ingested</TableHead>
            {(canUpdate || canDelete) && <TableHead aria-label="Actions" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.isLoading && <TableLoading message="Loading devices…" rowSpan={5} />}
          {query.isError && <TableError message="Failed to load devices." rowSpan={5} />}
          {query.isSuccess && query.data.length === 0 && (
            <TableEmpty
              message="No devices yet. Devices are registered by your Dinsight provider — contact support to provision one."
              rowSpan={5}
            />
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
                        {d.iot_hub_name && <div className="text-[10px]">hub: {d.iot_hub_name}</div>}
                      </>
                    ) : (
                      <span className="italic text-muted-foreground">(not yet linked)</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {d.last_ingested_at ? formatDate(d.last_ingested_at) : '—'}
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
                                ? 'Trigger an immediate ingestion pass for this device'
                                : 'Sync requires an IoT Hub-linked device'
                            }
                            onClick={() => syncMutation.mutate(d.id)}
                          >
                            <RefreshCcw className="h-4 w-4" /> Sync now
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
                            <PauseCircle className="h-4 w-4" /> Pause
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
                            <PlayCircle className="h-4 w-4" /> Resume
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
                                window.confirm(
                                  `Remove device ${d.name} from the dashboard? Historical data stays; the device is hidden from this list.`
                                )
                              ) {
                                deleteMutation.mutate(d.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" /> Remove
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

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

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
