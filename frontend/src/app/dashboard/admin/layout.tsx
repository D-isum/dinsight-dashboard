'use client';

import Link from 'next/link';
import { ShieldAlert, ChevronLeft } from 'lucide-react';
import { usePlatformAdmin } from '@/components/auth/require-permission';
import { useAuth } from '@/context/auth-context';

// /dashboard/admin layout — the vendor-staff "platform admin" surface
// split out of the customer dashboard so the customer-facing UI never
// renders platform-management affordances at all (route-level gate,
// not just hidden tabs).
//
// Pattern B today (admin of seeded `default` org = platform admin).
// Phase 7 will replace this gate with a vendor-staff identity flag
// and move the routes to admin.dinsight.io (different Next.js app).
//
// Visual treatment intentionally differs from the customer dashboard:
//   - "Admin" wordmark + amber accent in the top bar.
//   - Back-to-dashboard breadcrumb so the user can always pop out.
// Same backend, same auth — only the framing changes.

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isLoading } = useAuth();
  const isPlatformAdmin = usePlatformAdmin();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-strong" />
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return <NotAuthorized />;
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Admin banner — visual signal that you've left the customer dashboard */}
      <div className="border-b-2 border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-amber-500/15 flex items-center justify-center">
              <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-400" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-fg">D'Insight Admin</span>
              <span className="text-xs text-fg-muted">
                Vendor-staff surface — managing customers, fleet, and support sessions
              </span>
            </div>
          </div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg transition-colors"
          >
            <ChevronLeft className="h-3 w-3" />
            Back to dashboard
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">{children}</div>
    </div>
  );
}

function NotAuthorized() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3 px-4 text-center">
      <ShieldAlert className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">Not authorized</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        This area is reserved for D'Insight platform administrators. If you reached this page by
        mistake, return to your dashboard.
      </p>
      <Link
        href="/dashboard"
        className="mt-2 inline-flex items-center gap-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-contrast hover:opacity-90"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
