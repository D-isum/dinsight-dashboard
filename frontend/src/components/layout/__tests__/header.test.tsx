import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Header } from '@/components/layout/header';
import { I18nProvider } from '@/i18n/client';

vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      full_name: 'Default Admin',
      email: 'admin@example.com',
      role: 'admin',
    },
    logout: vi.fn(),
  }),
}));

vi.mock('@/context/dashboard-workspace-context', () => ({
  useDashboardWorkspace: () => ({
    groups: [],
    selectedSourceKey: '',
    selectSource: vi.fn(),
    selectedDatasetId: null,
    filteredDatasets: [],
    selectDataset: vi.fn(),
    isLoadingDatasets: false,
  }),
}));

vi.mock('@/components/auth/require-permission', () => ({
  usePlatformAdmin: () => false,
}));

vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/i18n/language-switcher', () => ({ LanguageSwitcher: () => null }));
vi.mock('@/components/layout/activity-timeline', () => ({ ActivityTimeline: () => null }));
vi.mock('@/components/layout/command-palette', () => ({ CommandPalette: () => null }));
vi.mock('@/components/datasets/dataset-source-select', () => ({
  DatasetSourceSelect: () => null,
}));

describe('Header', () => {
  it('keeps the Arabic profile menu inside the viewport edge', () => {
    render(
      <I18nProvider initialLocale="ar">
        <Header onMenuClick={vi.fn()} isSidebarOpen={false} />
      </I18nProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /Default Admin/ }));

    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toHaveClass('end-0');
    expect(menu.parentElement).not.toHaveClass('start-0');
  });
});
