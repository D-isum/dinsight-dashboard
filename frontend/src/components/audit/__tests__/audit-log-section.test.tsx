import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditLogSection } from '@/components/audit/audit-log-section';

// AuditLogSection is the extracted body of the former /dashboard/audit
// page. It's embedded as an admin-only tab under Settings.
// These tests pin: the role gate, the table render, and the empty
// state. The page-level redirect stub at /dashboard/audit isn't
// covered here (it's a 5-line useEffect).

const auditListMock = vi.fn();
vi.mock('@/lib/api-client', () => ({
  api: {
    audit: {
      list: (...args: any[]) => auditListMock(...args),
    },
  },
}));

let mockAuthValue: any = {};
vi.mock('@/context/auth-context', () => ({
  useAuth: () => mockAuthValue,
}));

beforeEach(() => {
  auditListMock.mockReset();
});

const renderSection = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuditLogSection />
    </QueryClientProvider>
  );
};

describe('AuditLogSection', () => {
  it('blocks operator-role users with an admin-required notice', () => {
    mockAuthValue = {
      currentOrg: { id: 1, name: 'Default Organization' },
      currentOrgRole: 'operator',
    };
    renderSection();

    expect(screen.getByText(/admin access required/i)).toBeInTheDocument();
    expect(auditListMock).not.toHaveBeenCalled();
  });

  it('blocks viewer-role users too', () => {
    mockAuthValue = {
      currentOrg: { id: 1, name: 'Default Organization' },
      currentOrgRole: 'viewer',
    };
    renderSection();

    expect(screen.getByText(/admin access required/i)).toBeInTheDocument();
    expect(auditListMock).not.toHaveBeenCalled();
  });

  it('renders the audit table for admin-role users', async () => {
    mockAuthValue = {
      currentOrg: { id: 1, name: 'Acme Plant' },
      currentOrgRole: 'admin',
    };
    auditListMock.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          items: [
            {
              id: 1,
              occurred_at: '2026-05-11T12:00:00.000Z',
              action: 'POST /api/v1/alerts/rules',
              resource_type: 'alerts',
              resource_id: '42',
              outcome: 'success',
              response_status: 201,
              user_id: 7,
              user_email: 'admin@acme.com',
              user_full_name: 'Admin User',
            },
            {
              id: 2,
              occurred_at: '2026-05-11T11:00:00.000Z',
              action: 'DELETE /api/v1/datasets/metadata/9',
              resource_type: 'datasets',
              resource_id: '9',
              outcome: 'failure',
              response_status: 500,
              user_id: 8,
              user_email: 'op@acme.com',
              user_full_name: 'Operator',
            },
          ],
          total: 2,
          limit: 50,
          offset: 0,
        },
      },
    });
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('Admin User')).toBeInTheDocument();
    });
    expect(screen.getByText('Operator')).toBeInTheDocument();
    expect(screen.getByText('POST /api/v1/alerts/rules')).toBeInTheDocument();
    expect(screen.getByText('alerts #42')).toBeInTheDocument();
    expect(screen.getByText('datasets #9')).toBeInTheDocument();
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('failure')).toBeInTheDocument();
    expect(auditListMock).toHaveBeenCalledTimes(1);
  });

  it('renders the empty-state message when there are zero entries', async () => {
    mockAuthValue = {
      currentOrg: { id: 1, name: 'New Org' },
      currentOrgRole: 'admin',
    };
    auditListMock.mockResolvedValueOnce({
      data: { success: true, data: { items: [], total: 0, limit: 50, offset: 0 } },
    });
    renderSection();

    await waitFor(() => {
      expect(screen.getByText(/No audit entries yet/i)).toBeInTheDocument();
    });
  });
});
