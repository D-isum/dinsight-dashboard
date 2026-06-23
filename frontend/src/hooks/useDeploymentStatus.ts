import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, API_BASE_URL } from '@/lib/api-client';

export interface LicenseStatusInfo {
  isValid: boolean | null;
  daysUntilExpiry: number | null;
  expiresAt: string | null;
  customerId: string | null;
  version: string | null;
  registeredDevices: number | null;
  maxDevices: number | null;
}

export function useDeploymentStatus() {
  const licenseQuery = useQuery<LicenseStatusInfo | null>({
    queryKey: ['deployment-license-status'],
    queryFn: async () => {
      const response = await api.license.get();
      const payload = response?.data?.data ?? null;
      if (!payload) {
        return null;
      }
      return {
        isValid: typeof payload.is_valid === 'boolean' ? payload.is_valid : null,
        daysUntilExpiry:
          typeof payload.days_until_expiry === 'number' ? payload.days_until_expiry : null,
        expiresAt: typeof payload.expires_at === 'string' ? payload.expires_at : null,
        customerId: typeof payload.customer_id === 'string' ? payload.customer_id : null,
        version: typeof payload.version === 'string' ? payload.version : null,
        registeredDevices:
          typeof payload.registered_devices === 'number' ? payload.registered_devices : null,
        maxDevices: typeof payload.max_devices === 'number' ? payload.max_devices : null,
      };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });

  const runtime = useMemo(() => {
    const browserHost = typeof window !== 'undefined' ? window.location.host : '';
    const sharedVmHost = '135.149.57.99';
    const isSharedVm = browserHost.includes(sharedVmHost) || API_BASE_URL.includes(sharedVmHost);
    const isLocal =
      /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(browserHost) ||
      /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(API_BASE_URL);
    const configuredLabel = process.env.NEXT_PUBLIC_DEPLOYMENT_LABEL;
    const devExtensionDays = process.env.NEXT_PUBLIC_LICENSE_DEV_EXTENSION_DAYS;

    return {
      apiBaseUrl: API_BASE_URL,
      browserHost,
      label:
        configuredLabel || (isSharedVm ? 'Shared dev VM' : isLocal ? 'Local dev' : 'Deployment'),
      isSharedVm,
      isLocal,
      devLicenseExtensionDays:
        devExtensionDays && Number.isFinite(Number(devExtensionDays))
          ? Number(devExtensionDays)
          : null,
    };
  }, []);

  return {
    runtime,
    license: licenseQuery.data ?? null,
    isLoadingLicense: licenseQuery.isLoading,
    licenseError: licenseQuery.error ? (licenseQuery.error as Error).message : null,
  };
}
