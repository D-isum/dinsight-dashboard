'use client';

import { AlertTriangle, CheckCircle2, Server, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useDeploymentStatus } from '@/hooks/useDeploymentStatus';

export function DeploymentStatusCard({ compact = false }: { compact?: boolean }) {
  const { runtime, license, isLoadingLicense, licenseError } = useDeploymentStatus();
  const expired =
    license?.expiresAt != null && Number.isFinite(Date.parse(license.expiresAt))
      ? Date.parse(license.expiresAt) <= Date.now()
      : false;
  const licenseValid = license?.isValid === true && !expired;
  const statusLabel = isLoadingLicense
    ? 'Checking license'
    : licenseError
      ? 'License unavailable'
      : licenseValid
        ? 'License valid'
        : 'License attention';

  return (
    <Card className="border-border/60">
      <CardContent className={compact ? 'p-3' : 'p-4'}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Server className="h-4 w-4 text-fg-muted" />
              <span className="text-sm font-semibold text-fg">{runtime.label}</span>
              {runtime.isSharedVm && <Badge variant="info">DEV VM</Badge>}
              {runtime.isLocal && !runtime.isSharedVm && <Badge variant="outline">LOCAL</Badge>}
            </div>
            {!compact && (
              <p className="truncate text-xs text-muted-foreground">
                API: <span className="font-medium text-fg">{runtime.apiBaseUrl}</span>
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {licenseValid ? (
              <CheckCircle2 className="h-4 w-4 text-success-text" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-warning-text" />
            )}
            <Badge variant={licenseValid ? 'success' : licenseError ? 'warning' : 'danger'}>
              {statusLabel}
            </Badge>
          </div>
        </div>

        {!compact && (
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <div>
              Expires:{' '}
              <span className="font-medium text-fg">
                {license?.expiresAt ? new Date(license.expiresAt).toLocaleDateString() : 'Unknown'}
              </span>
            </div>
            <div>
              Devices:{' '}
              <span className="font-medium text-fg">
                {license?.registeredDevices ?? 'N/A'} /{' '}
                {license?.maxDevices === -1 ? 'Unlimited' : (license?.maxDevices ?? 'N/A')}
              </span>
            </div>
            <div>
              Customer:{' '}
              <span className="font-medium text-fg">{license?.customerId ?? 'Unknown'}</span>
            </div>
          </div>
        )}

        {runtime.devLicenseExtensionDays != null && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Dev license extension advertised for {runtime.devLicenseExtensionDays} day(s). Keep this
            disabled in production builds.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
