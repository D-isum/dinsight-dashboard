'use client';

import { AlertTriangle, CheckCircle2, Server, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useDeploymentStatus } from '@/hooks/useDeploymentStatus';
import { useI18n } from '@/i18n/client';

export function DeploymentStatusCard({ compact = false }: { compact?: boolean }) {
  const { t, formatDate, formatNumber } = useI18n();
  const { runtime, license, isLoadingLicense, licenseError } = useDeploymentStatus();
  const signedExpiresAt = license?.originalExpiresAt ?? license?.expiresAt ?? null;
  const activeExpiresAt =
    license?.devExtensionActive === true
      ? (license.effectiveExpiresAt ?? signedExpiresAt)
      : signedExpiresAt;
  const signedExpired =
    signedExpiresAt != null && Number.isFinite(Date.parse(signedExpiresAt))
      ? Date.parse(signedExpiresAt) <= Date.now()
      : false;
  const expired =
    activeExpiresAt != null && Number.isFinite(Date.parse(activeExpiresAt))
      ? Date.parse(activeExpiresAt) <= Date.now()
      : false;
  const licenseValid = license?.isValid === true && !expired;
  const devExtensionActive = license?.devExtensionActive === true;
  const showInactiveExtensionWarning =
    !licenseValid &&
    signedExpired &&
    !devExtensionActive &&
    runtime.devLicenseExtensionDays != null;
  const statusLabel = isLoadingLicense
    ? t('license.checking')
    : licenseError
      ? t('license.unavailable')
      : devExtensionActive && licenseValid
        ? t('license.devExtensionStatus')
        : licenseValid
          ? t('license.valid')
          : t('license.attention');

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
                {t('license.api')}: <span className="font-medium text-fg">{runtime.apiBaseUrl}</span>
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
              {t('license.expires')}:{' '}
              <span className="font-medium text-fg">
                {activeExpiresAt ? formatDate(activeExpiresAt) : t('common.unknown')}
              </span>
            </div>
            <div>
              {t('license.devices')}:{' '}
              <span className="font-medium text-fg">
                {license?.registeredDevices != null
                  ? formatNumber(license.registeredDevices)
                  : t('common.notAvailable')}{' '}
                /{' '}
                {license?.maxDevices === -1
                  ? t('license.unlimited')
                  : license?.maxDevices != null
                    ? formatNumber(license.maxDevices)
                    : t('common.notAvailable')}
              </span>
            </div>
            <div>
              {t('license.customer')}:{' '}
              <span className="font-medium text-fg">{license?.customerId ?? t('common.unknown')}</span>
            </div>
          </div>
        )}

        {devExtensionActive ? (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('license.activeExtensionWarning', {
              originalDate: license?.originalExpiresAt
                ? formatDate(license.originalExpiresAt)
                : t('common.unknown'),
              effectiveDate: activeExpiresAt ? formatDate(activeExpiresAt) : t('common.unknown'),
            })}
          </div>
        ) : (
          showInactiveExtensionWarning && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-text">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t('license.inactiveExtensionWarning', {
                days: formatNumber(runtime.devLicenseExtensionDays ?? 0),
              })}
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}
