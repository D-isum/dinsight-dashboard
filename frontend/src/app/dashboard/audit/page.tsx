'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// /dashboard/audit now redirects to the consolidated settings page.
// Audit log lives as an admin-only tab under Settings so
// the top-level sidebar stays at 5 entries.
export default function AuditRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/account?section=audit-log');
  }, [router]);
  return null;
}
