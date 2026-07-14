import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import LoginPage from '@/app/login/page';
import { I18nProvider } from '@/i18n/client';

const renderLoginPage = () =>
  render(
    <I18nProvider initialLocale="en">
      <LoginPage />
    </I18nProvider>
  );

// LoginPage uses Suspense + searchParams; the explicit mocks below stub
// the surfaces we care about so the test focuses on the SSO discovery
// behavior, not the password form internals.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ login: vi.fn() }),
}));

const ssoConfigMock = vi.fn();
vi.mock('@/lib/api-client', () => ({
  api: {
    auth: {
      ssoConfig: (...args: any[]) => ssoConfigMock(...args),
    },
  },
}));

beforeEach(() => {
  ssoConfigMock.mockReset();
});

describe('Login page SSO button', () => {
  it('hides the SSO button when /auth/sso/config reports disabled', async () => {
    ssoConfigMock.mockResolvedValueOnce({
      data: { success: true, data: { enabled: false, label: 'Single sign-on' } },
    });
    renderLoginPage();

    // Wait long enough for the useEffect to settle.
    await waitFor(() => {
      expect(ssoConfigMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/Continue with/i)).not.toBeInTheDocument();
  });

  it('renders the SSO button with the deployment label when enabled', async () => {
    ssoConfigMock.mockResolvedValueOnce({
      data: { success: true, data: { enabled: true, label: 'UPDF SSO' } },
    });
    renderLoginPage();

    await waitFor(() => {
      expect(screen.getByText(/Continue with UPDF SSO/i)).toBeInTheDocument();
    });
    // It's an anchor (full-page navigation, not SPA route).
    const link = screen.getByText(/Continue with UPDF SSO/i).closest('a');
    expect(link).toHaveAttribute('href', '/api/v1/auth/sso/login');
  });

  it('hides the SSO button when the discovery call fails', async () => {
    ssoConfigMock.mockRejectedValueOnce(new Error('network'));
    renderLoginPage();

    await waitFor(() => {
      expect(ssoConfigMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/Continue with/i)).not.toBeInTheDocument();
  });
});
