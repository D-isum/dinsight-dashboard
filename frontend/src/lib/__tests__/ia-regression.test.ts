import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mainNavItems, quickActions } from '@/lib/nav-config';

const dashboardRoot = path.resolve(process.cwd(), 'src/app/dashboard');

describe('IA regression checks', () => {
  // Four top-level pages. Live coordinates and deterioration analysis share
  // Asset Monitor; settings-y surfaces remain under account settings.
  // License, notifications, and validation rules all live as tabs under
  // /dashboard/account so the sidebar stays scannable.
  it('keeps the sidebar trimmed to the four top-level pages', () => {
    const hrefs = mainNavItems.map((item) => item.href);
    expect(hrefs).toEqual([
      '/dashboard',
      '/dashboard/data',
      '/dashboard/monitor',
      '/dashboard/account',
    ]);
  });

  it('keeps the former live and insights URLs as compatibility routes', () => {
    expect(fs.existsSync(path.join(dashboardRoot, 'live', 'page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(dashboardRoot, 'insights', 'page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(dashboardRoot, 'monitor', 'page.tsx'))).toBe(true);
  });

  it('keeps the legacy alerts + audit routes as redirect stubs (no sidebar entry)', () => {
    // The routes still exist so bookmarks don't break — they redirect
    // to /dashboard/account?section=... See app/dashboard/{alerts,audit}/page.tsx.
    expect(fs.existsSync(path.join(dashboardRoot, 'alerts', 'page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(dashboardRoot, 'audit', 'page.tsx'))).toBe(true);
  });

  it('ensures legacy dashboard routes are removed from codebase', () => {
    const removed = [
      'analysis',
      'deterioration-analysis',
      'dinsight-analysis',
      'features',
      'profile',
      'settings',
      'streaming',
      'visualization',
    ];
    removed.forEach((segment) => {
      expect(fs.existsSync(path.join(dashboardRoot, segment))).toBe(false);
    });
  });

  it('keeps quick actions within operator IA', () => {
    const hrefs = quickActions.map((action) => action.href);
    expect(hrefs).toEqual(['/dashboard/data', '/dashboard/monitor']);
  });
});
