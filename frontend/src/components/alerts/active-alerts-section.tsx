'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { usePermission } from '@/components/auth/require-permission';
import { Actions } from '@/lib/permissions';
import { api } from '@/lib/api-client';
import { useAuth } from '@/context/auth-context';

// ActiveAlertsSection is the operational feed of alerts that fired
// against this org's stored anomaly classifications. Was its own page
// at /dashboard/alerts; now embedded as a tab under Settings
// so the top-level sidebar can stay short.

interface AlertItem {
  id: number;
  classification_id: number;
  alert_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical' | string;
  title: string;
  message: string;
  anomaly_percentage: number;
  threshold_exceeded: boolean;
  status: 'active' | 'acknowledged' | 'resolved';
  acknowledged_by?: number;
  acknowledged_at?: string | null;
  resolved_by?: number;
  resolved_at?: string | null;
  created_at: string;
}

export function ActiveAlertsSection() {
  const { currentOrg } = useAuth();
  const queryClient = useQueryClient();
  const canAck = usePermission(Actions.AlertAck);
  const canResolve = usePermission(Actions.AlertResolve);

  const alertsQuery = useQuery<AlertItem[]>({
    queryKey: ['alerts', currentOrg?.id],
    queryFn: async () => {
      // GET /api/v1/alerts is paginated:
      //   { data: { alerts: [...], total, page, limit }, success: true }
      // We only render the rows here; if the BE response shape changes
      // back to a bare array later, the second branch keeps things safe.
      const res = await api.alerts.list();
      const payload = res?.data?.data;
      if (Array.isArray(payload)) return payload as AlertItem[];
      return (payload?.alerts ?? []) as AlertItem[];
    },
    enabled: Boolean(currentOrg?.id),
    refetchInterval: 30_000,
  });

  return (
    <ActiveAlertsTable
      alerts={alertsQuery.data ?? []}
      isLoading={alertsQuery.isLoading}
      canAck={canAck}
      canResolve={canResolve}
      onChanged={() => {
        queryClient.invalidateQueries({ queryKey: ['alerts'] });
      }}
    />
  );
}

interface ActiveAlertsTableProps {
  alerts: AlertItem[];
  isLoading: boolean;
  canAck: boolean;
  canResolve: boolean;
  onChanged: () => void;
}

function ActiveAlertsTable({
  alerts,
  isLoading,
  canAck,
  canResolve,
  onChanged,
}: ActiveAlertsTableProps) {
  const [resolveTarget, setResolveTarget] = useState<AlertItem | null>(null);
  const [resolveMessage, setResolveMessage] = useState('');

  const ackMutation = useMutation({
    mutationFn: ({ id, message }: { id: number; message?: string }) =>
      api.alerts.acknowledge(id, message),
    onSuccess: onChanged,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, message }: { id: number; message: string }) =>
      api.alerts.resolve(id, message),
    onSuccess: () => {
      setResolveTarget(null);
      setResolveMessage('');
      onChanged();
    },
  });

  // Active first, then acknowledged, then resolved. Inside each bucket,
  // newest first.
  const sorted = useMemo(() => {
    const order: Record<string, number> = { active: 0, acknowledged: 1, resolved: 2 };
    return [...alerts].sort((a, b) => {
      const da = order[a.status] ?? 99;
      const db = order[b.status] ?? 99;
      if (da !== db) return da - db;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [alerts]);

  if (isLoading) {
    return (
      <div className="rounded-md border border-border">
        <Table>
          <TableBody>
            <TableLoading message="Loading alerts" />
          </TableBody>
        </Table>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="rounded-md border border-border">
        <Table>
          <TableBody>
            <TableEmpty message="No active alerts in this organization." />
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Fired</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((alert) => (
              <TableRow key={alert.id}>
                <TableCell>
                  <SeverityBadge severity={alert.severity} />
                </TableCell>
                <TableCell>
                  <div className="font-medium text-fg">{alert.title}</div>
                  <div className="text-xs text-fg-muted">{alert.message}</div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={alert.status} />
                </TableCell>
                <TableCell className="text-sm text-fg-muted">
                  {new Date(alert.created_at).toLocaleString(undefined, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {alert.status === 'active' && canAck && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={ackMutation.isPending}
                        onClick={() => ackMutation.mutate({ id: alert.id })}
                      >
                        Acknowledge
                      </Button>
                    )}
                    {alert.status !== 'resolved' && canResolve && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => {
                          setResolveTarget(alert);
                          setResolveMessage('');
                        }}
                      >
                        Resolve
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={resolveTarget !== null}
        onOpenChange={(open) => !open && setResolveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve alert</AlertDialogTitle>
            <AlertDialogDescription>
              {resolveTarget?.title}. Add a short note about what was done — it&apos;s recorded in
              the audit log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="resolve-message">Resolution note</Label>
            <Input
              id="resolve-message"
              placeholder="e.g. Fan bearing replaced; vibration returned to baseline."
              value={resolveMessage}
              onChange={(e) => setResolveMessage(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!resolveMessage.trim() || resolveMutation.isPending}
              onClick={() =>
                resolveTarget &&
                resolveMutation.mutate({
                  id: resolveTarget.id,
                  message: resolveMessage.trim(),
                })
              }
            >
              {resolveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resolving
                </>
              ) : (
                'Resolve alert'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const variant =
    severity === 'critical' || severity === 'high'
      ? 'destructive'
      : severity === 'medium'
        ? 'default'
        : 'secondary';
  return <Badge variant={variant as 'destructive' | 'default' | 'secondary'}>{severity}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'resolved') return <Badge variant="outline">Resolved</Badge>;
  if (status === 'acknowledged') return <Badge variant="secondary">Acknowledged</Badge>;
  return <Badge variant="default">Active</Badge>;
}
