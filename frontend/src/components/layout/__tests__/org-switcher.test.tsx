import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrgSwitcher } from '@/components/layout/org-switcher';
import { I18nProvider } from '@/i18n/client';

// useAuth is mocked per-test with the shape OrgSwitcher cares about.
const setCurrentOrg = vi.fn();
let mockAuthValue: any = {
  user: null,
  currentOrg: null,
  setCurrentOrg,
  currentOrgRole: null,
};
vi.mock('@/context/auth-context', () => ({
  useAuth: () => mockAuthValue,
}));

beforeEach(() => {
  setCurrentOrg.mockClear();
  mockAuthValue = {
    user: null,
    currentOrg: null,
    setCurrentOrg,
    currentOrgRole: null,
  };
});

const renderWithQueryClient = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nProvider initialLocale="en">
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </I18nProvider>
  );
};

describe('OrgSwitcher', () => {
  it('renders nothing when the user has no organizations', () => {
    mockAuthValue = {
      ...mockAuthValue,
      user: {
        id: 1,
        full_name: 'No Orgs',
        email: 'no@example.com',
        role: 'user',
        organizations: [],
      },
      currentOrg: null,
    };
    const { container } = renderWithQueryClient(<OrgSwitcher />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a flat label (no dropdown) when the user belongs to exactly one org', () => {
    const onlyOrg = {
      id: 7,
      name: 'Default Organization',
      slug: 'default',
      plan: 'pilot',
      subscription_status: 'active',
      role: 'operator' as const,
    };
    mockAuthValue = {
      ...mockAuthValue,
      user: {
        id: 1,
        full_name: 'One Org',
        email: 'one@example.com',
        role: 'user',
        organizations: [onlyOrg],
      },
      currentOrg: onlyOrg,
      currentOrgRole: 'operator' as const,
    };
    renderWithQueryClient(<OrgSwitcher />);
    expect(screen.getByText('Default Organization')).toBeInTheDocument();
    expect(screen.getByText('Operator')).toBeInTheDocument();
    // No switcher affordance.
    expect(screen.queryByRole('button', { name: /Switch organization/i })).not.toBeInTheDocument();
  });

  it('opens a dropdown and invokes setCurrentOrg on selection when multi-org', () => {
    const alpha = {
      id: 7,
      name: 'Alpha Corp',
      slug: 'alpha',
      plan: 'pilot',
      subscription_status: 'active',
      role: 'admin' as const,
    };
    const beta = {
      id: 8,
      name: 'Beta Holdings',
      slug: 'beta',
      plan: 'pilot',
      subscription_status: 'active',
      role: 'operator' as const,
    };
    mockAuthValue = {
      ...mockAuthValue,
      user: {
        id: 1,
        full_name: 'Multi',
        email: 'multi@example.com',
        role: 'user',
        organizations: [alpha, beta],
      },
      currentOrg: alpha,
      currentOrgRole: 'admin' as const,
    };
    renderWithQueryClient(<OrgSwitcher />);

    const trigger = screen.getByRole('button', { name: /Switch organization/i });
    expect(trigger).toBeInTheDocument();
    fireEvent.click(trigger);

    // Both orgs surfaced in the menu.
    expect(screen.getByText('Beta Holdings')).toBeInTheDocument();

    // Click the OTHER org (not the current one).
    fireEvent.click(screen.getByText('Beta Holdings'));
    expect(setCurrentOrg).toHaveBeenCalledWith(8);
  });

  it('does NOT call setCurrentOrg when the user clicks the already-active org', () => {
    const alpha = {
      id: 7,
      name: 'Alpha Corp',
      slug: 'alpha',
      plan: 'pilot',
      subscription_status: 'active',
      role: 'admin' as const,
    };
    const beta = {
      id: 8,
      name: 'Beta Holdings',
      slug: 'beta',
      plan: 'pilot',
      subscription_status: 'active',
      role: 'operator' as const,
    };
    mockAuthValue = {
      ...mockAuthValue,
      user: {
        id: 1,
        full_name: 'Multi',
        email: 'multi@example.com',
        role: 'user',
        organizations: [alpha, beta],
      },
      currentOrg: alpha,
      currentOrgRole: 'admin' as const,
    };
    renderWithQueryClient(<OrgSwitcher />);

    fireEvent.click(screen.getByRole('button', { name: /Switch organization/i }));
    // Click the current org inside the dropdown.
    const items = screen.getAllByText('Alpha Corp');
    // Two matches: one in the trigger, one in the menu — click the second.
    fireEvent.click(items[items.length - 1]);
    expect(setCurrentOrg).not.toHaveBeenCalled();
  });
});
