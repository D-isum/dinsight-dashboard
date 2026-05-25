'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Search,
  Bell,
  Menu,
  User,
  LogOut,
  Settings,
  ChevronDown,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { usePlatformAdmin } from '@/components/auth/require-permission';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/utils/cn';

interface HeaderProps {
  onMenuClick: () => void;
  isSidebarOpen: boolean;
}

export function Header({ onMenuClick, isSidebarOpen }: HeaderProps) {
  const { user, logout } = useAuth();
  const isPlatformAdmin = usePlatformAdmin();
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-surface">
      <div className="flex h-16 items-center px-4 sm:px-6">
        {/* Mobile menu button */}
        <Button
          variant="ghost"
          size="icon"
          className="mr-2 md:hidden hover:bg-surface-hover rounded-lg transition-colors"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>

        {/* Mobile brand anchor — sidebar is the canonical product mark on md+ */}
        <div className="flex items-center md:hidden">
          <Link href="/dashboard" aria-label="D'Insight" className="flex items-center">
            <div className="h-9 w-9 bg-accent rounded-lg flex items-center justify-center shadow-sm">
              <Sparkles className="h-5 w-5 text-accent-contrast" />
            </div>
          </Link>
        </div>

        {/* Search Bar */}
        <div className="flex-1 max-w-2xl mx-4 hidden md:flex">
          <div className="relative w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <input
              type="search"
              placeholder="Search analyses, datasets, or features..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={cn(
                'w-full rounded-lg border border-border bg-surface-muted pl-10 pr-4 py-2.5 text-sm transition-colors duration-150',
                'placeholder:text-fg-subtle',
                'focus:outline-none focus-visible:border-control-border-focus focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-canvas'
              )}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg-muted dark:hover:text-fg-subtle"
              >
                <span className="text-xs">ESC</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1" />

        {/* Right side actions */}
        <div className="flex items-center space-x-2">
          {/* Mobile search button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden hover:bg-surface-hover rounded-lg transition-colors"
          >
            <Search className="h-5 w-5" />
            <span className="sr-only">Search</span>
          </Button>

          {/* Theme Toggle */}
          <ThemeToggle />

          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative hover:bg-surface-hover rounded-lg transition-colors"
              >
                <Bell className="h-5 w-5" />
                <span className="absolute -top-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-danger text-xs font-medium text-accent-contrast shadow-sm">
                  3
                </span>
                <span className="sr-only">Notifications</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="right" className="w-80 rounded-lg">
              <div className="px-4 py-3 border-b dark:border-border">
                <h3 className="font-semibold text-fg">Notifications</h3>
                <p className="text-sm text-fg-muted">You have 3 unread notifications</p>
              </div>
              <div className="py-2">
                <DropdownMenuItem className="px-4 py-3 hover:bg-surface-hover/50 transition-colors">
                  <div className="flex gap-3 w-full">
                    <div className="flex-shrink-0">
                      <div className="h-2 w-2 bg-danger rounded-full mt-1.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-fg">High Anomaly Detected</p>
                      <p className="text-xs text-fg-muted mt-0.5">
                        Dataset analysis - 18.5% anomaly rate
                      </p>
                      <p className="text-xs text-fg-subtle mt-1">2 minutes ago</p>
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem className="px-4 py-3 hover:bg-surface-hover/50 transition-colors">
                  <div className="flex gap-3 w-full">
                    <div className="flex-shrink-0">
                      <div className="h-2 w-2 bg-success rounded-full mt-1.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-fg">Analysis Complete</p>
                      <p className="text-xs text-fg-muted mt-0.5">
                        Baseline data processing finished
                      </p>
                      <p className="text-xs text-fg-subtle mt-1">1 hour ago</p>
                    </div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem className="px-4 py-3 hover:bg-surface-hover/50 transition-colors">
                  <div className="flex gap-3 w-full">
                    <div className="flex-shrink-0">
                      <div className="h-2 w-2 bg-warning rounded-full mt-1.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-fg">Maintenance Due</p>
                      <p className="text-xs text-fg-muted mt-0.5">System maintenance scheduled</p>
                      <p className="text-xs text-fg-subtle mt-1">3 hours ago</p>
                    </div>
                  </div>
                </DropdownMenuItem>
              </div>
              <div className="border-t dark:border-border p-2">
                <Link
                  href="/dashboard/insights"
                  className="flex items-center justify-center w-full px-3 py-2 text-sm font-medium text-accent hover:bg-surface-hover/50 rounded-lg transition-colors"
                >
                  Open health insights
                </Link>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

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
                  <div className="hidden md:flex flex-col text-left">
                    <span className="text-sm font-medium text-fg">{user?.full_name || 'User'}</span>
                    <span className="text-xs text-fg-muted">
                      {user?.role
                        ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
                        : 'Member'}
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
                    <span>Account</span>
                  </DropdownMenuItem>
                </Link>
                <Link href="/dashboard/account">
                  <DropdownMenuItem className="px-3 py-2 hover:bg-surface-hover/50 transition-colors cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Security</span>
                  </DropdownMenuItem>
                </Link>
              </div>
              {isPlatformAdmin && (
                <div className="border-t dark:border-border py-2">
                  <Link href="/dashboard/admin">
                    <DropdownMenuItem className="px-3 py-2 hover:bg-surface-hover/50 transition-colors cursor-pointer">
                      <ShieldAlert className="mr-2 h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <span>Dinsight Admin</span>
                      <span className="ml-auto text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        staff
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
                  <span>Sign Out</span>
                </DropdownMenuItem>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
