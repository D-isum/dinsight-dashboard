'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { OrgSwitcher } from '@/components/layout/org-switcher';
import { mainNavItems, bottomNavItems } from '@/lib/nav-config';
import { can } from '@/lib/permissions';
import { formatRoleLabel } from '@/lib/role-labels';
import { useI18n } from '@/i18n/client';
import { cn } from '@/utils/cn';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({
  isOpen,
  onClose,
  isCollapsed = false,
  onToggleCollapse = () => undefined,
}: SidebarProps) {
  const pathname = usePathname();
  const { user, currentOrgRole } = useAuth();
  const { t, direction } = useI18n();
  const isRtl = direction === 'rtl';

  const isActiveLink = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    if (href === '/dashboard/monitor') {
      return (
        pathname.startsWith('/dashboard/monitor') ||
        pathname.startsWith('/dashboard/live') ||
        pathname.startsWith('/dashboard/insights')
      );
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
          'fixed inset-y-0 z-50 w-72 transform bg-canvas transition-[width,transform] duration-300 ease-in-out xl:relative xl:translate-x-0',
          isRtl ? 'right-0 border-l border-border' : 'left-0 border-r border-border',
          isCollapsed && 'xl:w-20',
          isOpen ? 'translate-x-0' : isRtl ? 'translate-x-full' : '-translate-x-full'
        )}
      >
        <div className="flex h-full flex-col">
          {/* Sidebar header */}
          <div
            className={cn(
              'flex h-16 items-center justify-between border-b border-border px-4',
              isCollapsed && 'xl:px-1'
            )}
          >
            <Link
              href="/dashboard"
              className={cn('group flex items-center gap-3', isCollapsed && 'xl:gap-0')}
              onClick={onClose}
            >
              <div className="relative">
                <div className="relative h-10 w-10 bg-accent rounded-lg flex items-center justify-center shadow-sm">
                  <Sparkles className="h-5 w-5 text-accent-contrast" />
                </div>
              </div>
              <div className={cn('flex flex-col', isCollapsed && 'xl:sr-only')}>
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
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'hidden rounded-lg hover:bg-surface-hover xl:inline-flex',
                isCollapsed && 'xl:h-8 xl:w-8'
              )}
              onClick={onToggleCollapse}
              aria-label={isCollapsed ? t('header.expandSidebar') : t('header.collapseSidebar')}
              title={isCollapsed ? t('header.expandSidebar') : t('header.collapseSidebar')}
            >
              {isCollapsed ? (
                isRtl ? (
                  <PanelRightOpen className="h-5 w-5" />
                ) : (
                  <PanelLeftOpen className="h-5 w-5" />
                )
              ) : isRtl ? (
                <PanelRightClose className="h-5 w-5" />
              ) : (
                <PanelLeftClose className="h-5 w-5" />
              )}
            </Button>
          </div>

          {/* Org switcher — shows active organization + role, opens a
              picker when the user belongs to more than one. */}
          <div className={cn('border-b border-border px-4 py-3', isCollapsed && 'xl:hidden')}>
            <OrgSwitcher />
          </div>

          {/* Navigation */}
          <nav
            className={cn(
              'flex-1 space-y-1 overflow-y-auto p-4 scrollbar-thin',
              isCollapsed && 'xl:px-2'
            )}
          >
            {/* Main navigation */}
            <div className="space-y-1">
              <h3
                className={cn(
                  'mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-fg-subtle',
                  isCollapsed && 'xl:sr-only'
                )}
              >
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
                      isCollapsed && 'xl:justify-center xl:px-2',
                      isActive
                        ? cn(
                            'bg-surface-selected text-accent dark:bg-surface-selected dark:text-accent',
                            isRtl ? 'border-r-4 border-strong' : 'border-l-4 border-strong'
                          )
                        : cn(
                            'text-fg hover:bg-surface-hover/50 hover:text-fg',
                            isRtl
                              ? 'border-r-4 border-transparent'
                              : 'border-l-4 border-transparent'
                          )
                    )}
                    title={description}
                  >
                    <div
                      className={cn(
                        'rounded-lg p-1.5 transition-colors',
                        isRtl ? 'ml-3' : 'mr-3',
                        isCollapsed && (isRtl ? 'xl:ml-0' : 'xl:mr-0'),
                        isActive
                          ? 'bg-surface-selected dark:bg-surface-selected text-accent'
                          : 'bg-surface-muted text-fg-muted group-hover:bg-surface-hover'
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className={cn('flex-1', isCollapsed && 'xl:sr-only')}>{label}</span>
                    {item.badge && (
                      <span
                        className={cn(
                          'inline-flex items-center justify-center rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-accent-contrast',
                          isRtl ? 'mr-2' : 'ml-2'
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                    {isActive && (
                      <ChevronRight
                        className={cn(
                          'h-4 w-4 text-accent',
                          isRtl && 'rotate-180',
                          isCollapsed && 'xl:hidden'
                        )}
                      />
                    )}
                  </Link>
                );
              })}
            </div>

            {/* System status widget (Quick Actions block removed — its links
                duplicated entries already in MAIN MENU) */}
            <div className={cn('mt-6', isCollapsed && 'xl:hidden')}>
              <div className="rounded-lg bg-surface-muted/50 border border-border p-4">
                <h4 className="text-xs font-semibold text-fg-muted uppercase tracking-wider mb-2">
                  {t('nav.systemStatus')}
                </h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-fg-muted">{t('common.apiStatus')}</span>
                    <span className="flex items-center text-xs">
                      <span
                        className={cn('h-2 w-2 rounded-full bg-success', isRtl ? 'ml-1' : 'mr-1')}
                      ></span>
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
          <div className={cn('border-t border-border p-4', isCollapsed && 'xl:px-2')}>
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
                        ? cn(
                            'bg-surface-selected text-accent dark:bg-surface-selected dark:text-accent',
                            isRtl ? 'border-r-4 border-strong' : 'border-l-4 border-strong'
                          )
                        : cn(
                            'text-fg hover:bg-surface-hover/50',
                            isRtl
                              ? 'border-r-4 border-transparent'
                              : 'border-l-4 border-transparent'
                          )
                    )}
                    title={description}
                  >
                    <Icon className={cn('h-4 w-4', isRtl ? 'ml-3' : 'mr-3')} />
                    {label}
                  </Link>
                );
              })}
            </div>

            {/* User info */}
            <div className={cn('rounded-lg bg-surface-muted/50 p-3', isCollapsed && 'xl:p-2')}>
              <div
                className={cn(
                  'flex items-center gap-3',
                  isCollapsed && 'xl:justify-center xl:gap-0'
                )}
              >
                <div className="relative">
                  <div className="h-10 w-10 rounded-lg bg-surface-muted flex items-center justify-center shadow-sm">
                    <span className="text-sm font-semibold text-fg">
                      {user?.full_name
                        ?.split(' ')
                        .map((n) => n[0])
                        .join('') || 'U'}
                    </span>
                  </div>
                  <div
                    className={cn(
                      'absolute -bottom-1 h-3 w-3 rounded-full border-2 border-white bg-success dark:border-canvas',
                      isRtl ? '-left-1' : '-right-1'
                    )}
                  />
                </div>
                <div className={cn('min-w-0 flex-1', isCollapsed && 'xl:sr-only')}>
                  <p className="text-sm font-medium text-fg truncate">
                    {user?.full_name || t('common.user')}
                  </p>
                  <p className="text-xs text-fg-muted truncate">{formatRoleLabel(user?.role, t)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
