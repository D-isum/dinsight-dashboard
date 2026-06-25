import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({
    user: { id: 1, full_name: 'Operator One', role: 'user', organizations: [] },
    currentOrg: null,
    setCurrentOrg: () => undefined,
    currentOrgRole: null,
  }),
}));

// OrgSwitcher (rendered inside Sidebar) uses useQueryClient to invalidate
// cached queries on org switch, so the test render needs a QueryClient in
// scope even when the switcher itself short-circuits to null.
const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

describe('Sidebar integration', () => {
  it('shows exactly the five top-level pages (alerts + audit moved to settings)', () => {
    renderWithQueryClient(<Sidebar isOpen onClose={() => undefined} />);

    expect(screen.getByRole('link', { name: /Machine Status/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Data Ingestion/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Live Monitor/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Health Insights/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings/i })).toBeInTheDocument();

    // Settings-y surfaces no longer have sidebar entries — they live
    // as tabs under Settings.
    expect(screen.queryByRole('link', { name: /^Alerts$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Audit/i })).not.toBeInTheDocument();

    // Legacy routes that were dropped during the IA cleanup stay gone.
    expect(screen.queryByRole('link', { name: /Visualization/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Streaming/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Profile/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Account' })).not.toBeInTheDocument();
  });
});
