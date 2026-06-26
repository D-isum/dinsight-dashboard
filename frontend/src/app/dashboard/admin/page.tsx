'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BarChart3, Building2, HardDrive, LifeBuoy } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PlatformAnalyticsSection } from '@/components/platform/platform-analytics-section';
import { CustomersSection } from '@/components/platform/customers-section';
import { PlatformDevicesSection } from '@/components/platform/platform-devices-section';
import { SupportSessionsSection } from '@/components/platform/support-sessions-section';
import { useI18n } from '@/i18n/client';

// /dashboard/admin landing — the vendor-staff platform-admin surface.
// Four sections in tabs:
//   - Overview (analytics)   — fleet-wide aggregate counts
//   - Customers              — onboard + list + delete customer orgs
//   - Devices                — cross-org device list (read-only)
//   - Support sessions       — open + close audited cross-tenant sessions
//
// Tab selection is reflected in ?tab=<key> so deep links land on the
// right section.

const VALID_TABS = ['overview', 'customers', 'devices', 'support'] as const;
type AdminTab = (typeof VALID_TABS)[number];

function isAdminTab(v: string | null): v is AdminTab {
  return v !== null && (VALID_TABS as readonly string[]).includes(v);
}

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminContent />
    </Suspense>
  );
}

function AdminContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const initialTab: AdminTab = isAdminTab(searchParams.get('tab'))
    ? (searchParams.get('tab') as AdminTab)
    : 'overview';
  const [tab, setTab] = useState<AdminTab>(initialTab);

  // Keep ?tab=... in sync with the active tab without polluting history.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', tab);
    }
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : '?', { scroll: false });
    // searchParams in the dep array would loop; intentionally omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('admin.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.description')}</p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as AdminTab)}>
        <TabsList className="grid w-full grid-cols-4 max-w-2xl">
          <TabsTrigger value="overview" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">{t('admin.overview')}</span>
          </TabsTrigger>
          <TabsTrigger value="customers" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">{t('admin.customers')}</span>
          </TabsTrigger>
          <TabsTrigger value="devices" className="gap-2">
            <HardDrive className="h-4 w-4" />
            <span className="hidden sm:inline">{t('admin.devices')}</span>
          </TabsTrigger>
          <TabsTrigger value="support" className="gap-2">
            <LifeBuoy className="h-4 w-4" />
            <span className="hidden sm:inline">{t('admin.support')}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <PlatformAnalyticsSection />
        </TabsContent>
        <TabsContent value="customers" className="mt-6">
          <CustomersSection />
        </TabsContent>
        <TabsContent value="devices" className="mt-6">
          <PlatformDevicesSection />
        </TabsContent>
        <TabsContent value="support" className="mt-6">
          <SupportSessionsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
