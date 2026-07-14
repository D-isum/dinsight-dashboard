import { Home, Database, Monitor, UserCog, type LucideIcon } from 'lucide-react';
import { type Action } from '@/lib/permissions';

export interface NavItem {
  label: string;
  labelKey?: string;
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
  descriptionKey?: string;
}

// Top-level sidebar IA. Four entries only. Account, security,
// alerts, audit log, license, and related controls live under Settings
// as tabs. Per-tab routing inside that page uses ?section=...
//
// Anything that USED to be top-level (alerts, audit) now redirects to
// /dashboard/account?section=... — see src/app/dashboard/{alerts,audit}/
// page.tsx for the redirect stubs.
export const mainNavItems: NavItem[] = [
  {
    label: 'Overview',
    labelKey: 'nav.machineStatus',
    href: '/dashboard',
    icon: Home,
    requiresAuth: true,
    description: 'Current machine condition and next actions',
    descriptionKey: 'nav.machineStatusDescription',
  },
  {
    label: 'Data',
    labelKey: 'nav.dataIngestion',
    href: '/dashboard/data',
    icon: Database,
    requiresAuth: true,
    description: 'Upload baseline and monitoring datasets',
    descriptionKey: 'nav.dataIngestionDescription',
  },
  {
    label: 'Asset Monitor',
    labelKey: 'nav.assetMonitor',
    href: '/dashboard/monitor',
    icon: Monitor,
    requiresAuth: true,
    description: 'Compare live behavior and deterioration in one workspace',
    descriptionKey: 'nav.assetMonitorDescription',
  },
  {
    label: 'Settings',
    labelKey: 'nav.settings',
    href: '/dashboard/account',
    icon: UserCog,
    requiresAuth: true,
    description: 'Account, security, teams, devices, alerts, validation, license, and audit log.',
    descriptionKey: 'nav.settingsDescription',
  },
];

export const bottomNavItems: NavItem[] = [];

export const userMenuItems = [
  { label: 'Settings', labelKey: 'nav.settings', href: '/dashboard/account' },
];

export const quickActions = [
  { label: 'Upload Data', labelKey: 'nav.uploadData', href: '/dashboard/data', icon: Database },
  {
    label: 'Open Asset Monitor',
    labelKey: 'nav.assetMonitor',
    href: '/dashboard/monitor',
    icon: Monitor,
  },
];
