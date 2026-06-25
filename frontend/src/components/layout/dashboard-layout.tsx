'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, RefreshCw, ScrollText } from 'lucide-react';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { useAuth, withAuth } from '@/context/auth-context';
import { DashboardWorkspaceProvider } from '@/context/dashboard-workspace-context';
import { ErrorBoundary } from '@/components/error-boundary';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api, LicenseIssue, LICENSE_ISSUE_EVENT } from '@/lib/api-client';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

interface LicenseInfo {
  expires_at: string;
  is_valid: boolean;
}

const issueFromLicenseInfo = (info: LicenseInfo | null | undefined): LicenseIssue | null => {
  if (!info) return null;
  const expiresAtMs = Date.parse(info.expires_at);
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
  if (info.is_valid && !expired) return null;

  return {
    code: expired ? 'LICENSE_EXPIRED' : 'LICENSE_INVALID',
    message: expired
      ? 'The deployment license has expired.'
      : 'The deployment license is not currently valid.',
    detectedAt: new Date().toISOString(),
  };
};

function LicenseLockout({ issue }: { issue: LicenseIssue }) {
  const isExpired = issue.code === 'LICENSE_EXPIRED';

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-3xl items-center">
      <div className="w-full rounded-lg border border-danger-border bg-surface p-6 shadow-sm">
        <Alert variant="danger">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>
            {isExpired ? 'Deployment license expired' : 'License issue detected'}
          </AlertTitle>
          <AlertDescription>
            <p>
              {issue.message} Your sign-in is still active, but licensed analysis and monitoring
              routes are locked until an administrator installs a renewed license.
            </p>
          </AlertDescription>
        </Alert>

        <div className="mt-5 grid gap-3 rounded-lg border border-border bg-surface-muted p-4 text-sm text-fg-muted">
          <div>
            <span className="font-medium text-fg">Issue code:</span> {issue.code}
          </div>
          <div>
            <span className="font-medium text-fg">Detected:</span>{' '}
            {new Date(issue.detectedAt).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/dashboard/account?section=license">
              <ScrollText className="mr-2 h-4 w-4" aria-hidden="true" />
              View license details
            </Link>
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

function DashboardLayoutComponent({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [licenseIssue, setLicenseIssue] = useState<LicenseIssue | null>(null);
  const { isLoading } = useAuth();
  const pathname = usePathname();
  const showingAccountSettings = pathname === '/dashboard/account';

  // Handle responsive sidebar behavior
  useEffect(() => {
    const handleResize = () => {
      if (typeof window !== 'undefined' && window.innerWidth >= 1280) {
        setSidebarOpen(false);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  useEffect(() => {
    const handleLicenseIssue = (event: Event) => {
      setLicenseIssue((event as CustomEvent<LicenseIssue>).detail);
    };

    window.addEventListener(LICENSE_ISSUE_EVENT, handleLicenseIssue);
    return () => window.removeEventListener(LICENSE_ISSUE_EVENT, handleLicenseIssue);
  }, []);

  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;

    api.license
      .get()
      .then((response) => {
        if (cancelled) return;
        const info = (response?.data?.data ?? null) as LicenseInfo | null;
        setLicenseIssue(issueFromLicenseInfo(info));
      })
      .catch(() => {
        // The response interceptor handles structured license failures.
        // Other errors should not replace the dashboard with a license screen.
      });

    return () => {
      cancelled = true;
    };
  }, [isLoading]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-strong"></div>
      </div>
    );
  }

  return (
    <DashboardWorkspaceProvider>
      <div className="h-screen flex min-w-0 bg-canvas">
        {/* Sidebar */}
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main content */}
        <div className="min-w-0 flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <Header onMenuClick={() => setSidebarOpen(true)} isSidebarOpen={sidebarOpen} />

          {/* Page content — wrapped so a render-time crash in one page surfaces
              the ErrorBoundary fallback instead of breaking the entire app shell. */}
          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-canvas">
            <div className="mx-auto w-full max-w-7xl min-w-0 px-4 py-6">
              {licenseIssue && showingAccountSettings && (
                <Alert variant="danger" className="mb-4">
                  <AlertTriangle aria-hidden="true" />
                  <AlertTitle>Deployment license requires attention</AlertTitle>
                  <AlertDescription>
                    {licenseIssue.message} Licensed analysis and monitoring routes are locked until
                    an administrator installs a renewed license.
                  </AlertDescription>
                </Alert>
              )}
              {licenseIssue && !showingAccountSettings ? (
                <LicenseLockout issue={licenseIssue} />
              ) : (
                <ErrorBoundary>{children}</ErrorBoundary>
              )}
            </div>
          </main>
        </div>
      </div>
    </DashboardWorkspaceProvider>
  );
}

export const DashboardLayout = withAuth(DashboardLayoutComponent);
