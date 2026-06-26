'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Search,
  Menu,
  User,
  LogOut,
  Settings,
  ChevronDown,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useDashboardWorkspace } from '@/context/dashboard-workspace-context';
import { usePlatformAdmin } from '@/components/auth/require-permission';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/i18n/language-switcher';
import { ActivityTimeline } from '@/components/layout/activity-timeline';
import { CommandPalette } from '@/components/layout/command-palette';
import { DatasetSourceSelect } from '@/components/datasets/dataset-source-select';
import { useI18n } from '@/i18n/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDatasetOptionLabelLocalized } from '@/lib/dataset-source-groups';
import { cn } from '@/utils/cn';

interface HeaderProps {
  onMenuClick: () => void;
  isSidebarOpen: boolean;
}

export function Header({ onMenuClick, isSidebarOpen: _isSidebarOpen }: HeaderProps) {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  const isPlatformAdmin = usePlatformAdmin();
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const {
    groups,
    selectedSourceKey,
    selectSource,
    selectedDatasetId,
    filteredDatasets,
    selectDataset,
    isLoadingDatasets,
  } = useDashboardWorkspace();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-surface">
      <CommandPalette open={isCommandOpen} onOpenChange={setIsCommandOpen} />
      <div className="flex h-16 items-center px-4 sm:px-6">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="mr-2 xl:hidden hover:bg-surface-hover rounded-lg transition-colors"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">{t('header.toggleMenu')}</span>
        </Button>

        {/* Compact brand anchor — sidebar is the canonical product mark on xl+ */}
        <div className="flex items-center xl:hidden">
          <Link href="/dashboard" aria-label="D'Insight" className="flex items-center">
            <div className="h-9 w-9 bg-accent rounded-lg flex items-center justify-center shadow-sm">
              <Sparkles className="h-5 w-5 text-accent-contrast" />
            </div>
          </Link>
        </div>

        {/* Search / command bar */}
        <div className="mx-3 hidden max-w-[16rem] flex-1 md:flex lg:max-w-xs 2xl:max-w-xl">
          <button
            type="button"
            onClick={() => setIsCommandOpen(true)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-left text-sm transition-colors duration-150',
              'text-fg-muted hover:border-control-border-focus hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas'
            )}
          >
            <Search className="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{t('header.searchPlaceholder')}</span>
            <span className="hidden rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-fg-subtle lg:inline-flex">
              {t('header.searchShortcut')}
            </span>
          </button>
        </div>

        <div className="hidden min-w-0 items-center gap-2 md:flex xl:hidden">
          <select
            value={selectedDatasetId != null ? String(selectedDatasetId) : ''}
            onChange={(event) =>
              selectDataset(event.target.value ? Number(event.target.value) : null)
            }
            disabled={isLoadingDatasets || filteredDatasets.length === 0}
            className="h-10 w-[10.5rem] rounded-lg border border-border bg-background px-2 text-xs text-fg disabled:opacity-60 lg:w-[12rem]"
            title={t('header.globalDatasetContext')}
            aria-label={t('header.globalDatasetContext')}
          >
            <option value="">
              {isLoadingDatasets ? `${t('common.loading')}...` : t('common.selectDataset')}
            </option>
            {filteredDatasets.map((dataset) => (
              <option key={dataset.dinsight_id} value={dataset.dinsight_id}>
                {formatDatasetOptionLabelLocalized(dataset, t)}
              </option>
            ))}
          </select>
        </div>

        <div className="hidden min-w-0 items-center gap-2 xl:flex 2xl:gap-3">
          <DatasetSourceSelect
            groups={groups}
            selectedSourceKey={selectedSourceKey}
            onChange={selectSource}
            disabled={isLoadingDatasets}
            className="h-10 w-[11.5rem] rounded-lg border border-border bg-background px-2 text-xs text-fg 2xl:w-[13rem]"
          />
          <select
            value={selectedDatasetId != null ? String(selectedDatasetId) : ''}
            onChange={(event) =>
              selectDataset(event.target.value ? Number(event.target.value) : null)
            }
            disabled={isLoadingDatasets || filteredDatasets.length === 0}
            className="h-10 w-[11.5rem] rounded-lg border border-border bg-background px-2 text-xs text-fg disabled:opacity-60 2xl:w-[14rem]"
            title={t('header.globalDatasetContext')}
            aria-label={t('header.globalDatasetContext')}
          >
            <option value="">
              {isLoadingDatasets ? t('common.loadingDatasets') : t('common.selectDataset')}
            </option>
            {filteredDatasets.map((dataset) => (
              <option key={dataset.dinsight_id} value={dataset.dinsight_id}>
                {formatDatasetOptionLabelLocalized(dataset, t)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1" />

        {/* Right side actions */}
        <div className="flex items-center space-x-2">
          {/* Mobile search button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden hover:bg-surface-hover rounded-lg transition-colors"
            onClick={() => setIsCommandOpen(true)}
          >
            <Search className="h-5 w-5" />
            <span className="sr-only">{t('common.search')}</span>
          </Button>

          <LanguageSwitcher compact />

          {/* Theme Toggle */}
          <ThemeToggle />

          <ActivityTimeline />

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-10 px-2 sm:px-3 hover:bg-surface-hover rounded-lg transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <div className="h-8 w-8 rounded-lg bg-surface-muted flex items-center justify-center shadow-sm">
                      <span className="text-sm font-semibold text-fg">
                        {user?.full_name
                          ?.split(' ')
                          .map((n) => n[0])
                          .join('') || 'U'}
                      </span>
                    </div>
                    <div className="absolute -bottom-1 -right-1 h-3 w-3 bg-success border-2 border-white dark:border-canvas rounded-full" />
                  </div>
                  <div className="hidden flex-col text-left 2xl:flex">
                    <span className="text-sm font-medium text-fg">
                      {user?.full_name || t('common.user')}
                    </span>
                    <span className="text-xs text-fg-muted">
                      {user?.role
                        ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
                        : t('header.member')}
                    </span>
                  </div>
                  <ChevronDown className="h-4 w-4 text-fg-subtle" />
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="right" className="w-56 rounded-lg">
              <div className="px-3 py-2 border-b dark:border-border">
                <p className="text-sm font-medium text-fg">{user?.full_name}</p>
                <p className="text-xs text-fg-muted truncate">{user?.email}</p>
              </div>
              <div className="py-2">
                <Link href="/dashboard/account">
                  <DropdownMenuItem className="px-3 py-2 hover:bg-surface-hover/50 transition-colors cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    <span>{t('common.account')}</span>
                  </DropdownMenuItem>
                </Link>
                <Link href="/dashboard/account?section=security">
                  <DropdownMenuItem className="px-3 py-2 hover:bg-surface-hover/50 transition-colors cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>{t('common.security')}</span>
                  </DropdownMenuItem>
                </Link>
              </div>
              {isPlatformAdmin && (
                <div className="border-t dark:border-border py-2">
                  <Link href="/dashboard/admin">
                    <DropdownMenuItem className="px-3 py-2 hover:bg-surface-hover/50 transition-colors cursor-pointer">
                      <ShieldAlert className="mr-2 h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <span>{t('header.admin')}</span>
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        {t('header.staff')}
                      </span>
                    </DropdownMenuItem>
                  </Link>
                </div>
              )}
              <div className="border-t dark:border-border py-2">
                <DropdownMenuItem
                  onClick={logout}
                  className="px-3 py-2 text-danger-text hover:bg-danger-bg transition-colors"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>{t('header.signOut')}</span>
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
