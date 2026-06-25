'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// /dashboard/alerts now redirects to the consolidated settings page.
// Active alerts + alert rules live as tabs under Settings so
// the top-level sidebar stays at 5 entries.
//
// Anyone with a bookmark to /dashboard/alerts lands here once and
// gets redirected to /dashboard/account?section=active-alerts.
export default function AlertsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/account?section=active-alerts');
  }, [router]);
  return null;
}
