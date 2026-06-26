'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatRoleLabel } from '@/lib/role-labels';
import { useI18n } from '@/i18n/client';
import { cn } from '@/utils/cn';

/**
 * OrgSwitcher — the active-organization picker shown under the sidebar
 * brand block. Reads / writes via useAuth.
 *
 * On switch:
 *   1. AuthContext.setCurrentOrg updates the in-memory state and writes
 *      the current_org_id cookie. The axios request interceptor stamps
 *      every subsequent request with the new X-Org-ID.
 *   2. React Query's cache is invalidated wholesale so no data from the
 *      previous org leaks into the new org's view. Per-query refetches
 *      will re-issue with the new header.
 *
 * Falls back to a flat label (no dropdown affordance) when the user
 * belongs to exactly one org, since a switcher with one option is just
 * noise.
 */
export function OrgSwitcher() {
  const { user, currentOrg, setCurrentOrg, currentOrgRole } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const orgs = user?.organizations ?? [];

  // Pre-auth or zero-membership state: render nothing rather than a
  // broken affordance. The dashboard layout's ResolveOrg gate handles
  // the 'no orgs' error UX downstream.
  if (orgs.length === 0 || !currentOrg) {
    return null;
  }

  // Single-org case: show the name as a flat row, no dropdown — a
  // switcher with one option misleads users into thinking there are
  // more orgs available.
  if (orgs.length === 1) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
        <Building2 className="h-4 w-4 text-fg-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{currentOrg.name}</p>
          {currentOrgRole && (
            <p className="truncate text-xs text-fg-muted">{formatRoleLabel(currentOrgRole, t)}</p>
          )}
        </div>
      </div>
    );
  }

  const handleSwitch = (orgId: number) => {
    if (orgId === currentOrg.id) return;
    setCurrentOrg(orgId);
    // Wipe React Query's cache so no stale data from the previous org
    // bleeds into the new org's screens. Each consumer will refetch on
    // its next render with the new X-Org-ID header.
    queryClient.invalidateQueries();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('settings.switchOrganization')}
          className={cn(
            'group flex w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm',
            'hover:bg-surface-hover transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas'
          )}
        >
          <Building2 className="h-4 w-4 text-fg-muted shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate font-medium text-fg">{currentOrg.name}</p>
            {currentOrgRole && (
              <p className="truncate text-xs text-fg-muted">{formatRoleLabel(currentOrgRole, t)}</p>
            )}
          </div>
          <ChevronsUpDown className="h-4 w-4 text-fg-subtle shrink-0" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="left" className="w-64">
        <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-fg-subtle">
          {t('settings.organizations')}
        </div>
        {orgs.map((org) => {
          const isActive = org.id === currentOrg.id;
          return (
            <DropdownMenuItem
              key={org.id}
              onClick={() => handleSwitch(org.id)}
              className="flex items-start gap-2 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{org.name}</p>
                <p className="truncate text-xs text-fg-muted">{formatRoleLabel(org.role, t)}</p>
              </div>
              {isActive && <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
