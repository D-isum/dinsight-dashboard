import { Home, Database, Monitor, ShieldAlert, UserCog, type LucideIcon } from 'lucide-react';
import { type Action } from '@/lib/permissions';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
  requiresAuth?: boolean;
  requiredRoles?: Array<'admin' | 'user' | 'viewer'>;
  // Restricts the item to users with this role in the currently-active
  // organization. Kept for nav entries that gate on a role itself rather
  // than a specific action.
  requiredOrgRoles?: Array<'admin' | 'operator' | 'viewer'>;
  // Restricts the item to users who can perform this Action in the
  // currently-active org. The action name matches the backend's policy
  // table — a grep across both codebases finds every gate.
  requiredAction?: Action;
  description?: string;
}

// Top-level sidebar IA. Five entries only. Account, security,
// alerts, audit log, license, and related controls live under Settings
// as tabs. Per-tab routing inside that page uses ?section=...
//
// Anything that USED to be top-level (alerts, audit) now redirects to
// /dashboard/account?section=... — see src/app/dashboard/{alerts,audit}/
// page.tsx for the redirect stubs.
export const mainNavItems: NavItem[] = [
  {
    label: 'Machine Status',
    href: '/dashboard',
    icon: Home,
    requiresAuth: true,
    description: 'Current machine condition and next actions',
  },
  {
    label: 'Data Ingestion',
    href: '/dashboard/data',
    icon: Database,
    requiresAuth: true,
    description: 'Upload baseline and monitoring datasets',
  },
  {
    label: 'Live Monitor',
    href: '/dashboard/live',
    icon: Monitor,
    requiresAuth: true,
    description: 'Observe live and near-real-time machine behavior',
  },
  {
    label: 'Health Insights',
    href: '/dashboard/insights',
    icon: ShieldAlert,
    requiresAuth: true,
    description: 'Anomaly and wear trend interpretation',
  },
  {
    label: 'Settings',
    href: '/dashboard/account',
    icon: UserCog,
    requiresAuth: true,
    description: 'Account, security, teams, devices, alerts, validation, license, and audit log.',
  },
];

export const bottomNavItems: NavItem[] = [];

export const userMenuItems = [{ label: 'Settings', href: '/dashboard/account' }];

export const quickActions = [
  { label: 'Upload Data', href: '/dashboard/data', icon: Database },
  { label: 'Open Live Monitor', href: '/dashboard/live', icon: Monitor },
  { label: 'View Insights', href: '/dashboard/insights', icon: ShieldAlert },
];
