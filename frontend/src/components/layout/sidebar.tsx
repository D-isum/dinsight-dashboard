'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { X, ChevronRight, Sparkles } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { OrgSwitcher } from '@/components/layout/org-switcher';
import { mainNavItems, bottomNavItems } from '@/lib/nav-config';
import { can } from '@/lib/permissions';
import { useI18n } from '@/i18n/client';
import { cn } from '@/utils/cn';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, currentOrgRole } = useAuth();
  const { t } = useI18n();

  const isActiveLink = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname.startsWith(href);
  };

  const hasPermission = (item: (typeof mainNavItems)[0]) => {
    if (!item.requiresAuth) return true;
    if (!user) return false;
    if (item.requiredRoles && !item.requiredRoles.includes(user.role)) {
      return false;
    }
    // Per-org role gate (legacy entries that name roles directly).
    if (item.requiredOrgRoles && item.requiredOrgRoles.length > 0) {
      if (!currentOrgRole || !item.requiredOrgRoles.includes(currentOrgRole)) {
        return false;
      }
    }
    // Action-based gate (preferred). Sourced from the same matrix the
    // backend's middleware.RequireAction reads, so the cosmetic hide
    // and the authoritative 403 always agree.
    if (item.requiredAction) {
      if (!can(currentOrgRole, item.requiredAction)) {
        return false;
      }
    }
    return true;
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-scrim transition-opacity xl:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <div
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-300 ease-in-out xl:relative xl:translate-x-0',
          'bg-canvas border-r border-border',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-full flex-col">
          {/* Sidebar header */}
          <div className="flex h-16 items-center justify-between border-b border-border px-4">
            <Link href="/dashboard" className="flex items-center space-x-3 group" onClick={onClose}>
              <div className="relative">
                <div className="relative h-10 w-10 bg-accent rounded-lg flex items-center justify-center shadow-sm">
                  <Sparkles className="h-5 w-5 text-accent-contrast" />
                </div>
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-xl text-accent">D'Insight</span>
                <span className="text-xs text-fg-muted">{t('app.productSubtitle')}</span>
              </div>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="xl:hidden hover:bg-surface-hover rounded-lg transition-colors"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
              <span className="sr-only">{t('header.closeSidebar')}</span>
            </Button>
          </div>

          {/* Org switcher — shows active organization + role, opens a
              picker when the user belongs to more than one. */}
          <div className="border-b border-border px-4 py-3">
            <OrgSwitcher />
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 p-4 overflow-y-auto scrollbar-thin">
            {/* Main navigation */}
            <div className="space-y-1">
              <h3 className="px-3 mb-2 text-xs font-semibold text-fg-subtle uppercase tracking-wider">
                {t('nav.mainMenu')}
              </h3>
              {mainNavItems.filter(hasPermission).map((item) => {
                const isActive = isActiveLink(item.href);
                const Icon = item.icon;
                const label = item.labelKey ? t(item.labelKey) : item.label;
                const description = item.descriptionKey ? t(item.descriptionKey) : item.description;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      'group flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-surface-selected dark:bg-surface-selected text-accent dark:text-accent border-l-4 border-strong'
                        : 'text-fg hover:bg-surface-hover/50 hover:text-fg border-l-4 border-transparent'
                    )}
                    title={description}
                  >
                    <div
                      className={cn(
                        'mr-3 rounded-lg p-1.5 transition-colors',
                        isActive
                          ? 'bg-surface-selected dark:bg-surface-selected text-accent'
                          : 'bg-surface-muted text-fg-muted group-hover:bg-surface-hover'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="flex-1">{label}</span>
                    {item.badge && (
                      <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold rounded-full bg-danger text-accent-contrast">
                        {item.badge}
                      </span>
                    )}
                    {isActive && <ChevronRight className="h-4 w-4 text-accent" />}
                  </Link>
                );
              })}
            </div>

            {/* System status widget (Quick Actions block removed — its links
                duplicated entries already in MAIN MENU) */}
            <div className="mt-6">
              <div className="rounded-lg bg-surface-muted/50 border border-border p-4">
                <h4 className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-2">
                  {t('nav.systemStatus')}
                </h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-fg-muted">{t('common.apiStatus')}</span>
                    <span className="flex items-center text-xs">
                      <span className="h-2 w-2 bg-success rounded-full mr-1"></span>
                      <span className="text-success-text font-medium">{t('common.online')}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-fg-muted">{t('common.processing')}</span>
                    <span className="text-xs font-medium text-fg">{t('common.ready')}</span>
                  </div>
                </div>
              </div>
            </div>
          </nav>

          {/* Bottom navigation */}
          <div className="border-t border-border p-4">
            <div className="space-y-1 mb-4">
              {bottomNavItems.filter(hasPermission).map((item) => {
                const isActive = isActiveLink(item.href);
                const Icon = item.icon;
                const label = item.labelKey ? t(item.labelKey) : item.label;
                const description = item.descriptionKey ? t(item.descriptionKey) : item.description;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={cn(
                      'group flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-surface-selected dark:bg-surface-selected text-accent dark:text-accent border-l-4 border-strong'
                        : 'text-fg hover:bg-surface-hover/50 border-l-4 border-transparent'
                    )}
                    title={description}
                  >
                    <Icon className="mr-3 h-4 w-4" />
                    {label}
                  </Link>
                );
              })}
            </div>

            {/* User info */}
            <div className="rounded-lg bg-surface-muted/50 p-3">
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <div className="h-10 w-10 rounded-lg bg-surface-muted flex items-center justify-center shadow-sm">
                    <span className="text-sm font-semibold text-fg">
                      {user?.full_name
                        ?.split(' ')
                        .map((n) => n[0])
                        .join('') || 'U'}
                    </span>
                  </div>
                  <div className="absolute -bottom-1 -right-1 h-3 w-3 bg-success border-2 border-white dark:border-canvas rounded-full" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-fg truncate">
                    {user?.full_name || t('common.user')}
                  </p>
                  <p className="text-xs text-fg-muted truncate">
                    {user?.role
                      ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
                      : t('common.user')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
