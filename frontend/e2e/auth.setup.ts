/**
 * Playwright auth fixture.
 *
 * Runs ONCE before any test in the `chromium` project (declared as a setup
 * dependency in playwright.config.ts) and persists the authenticated state
 * to playwright/.auth/user.json. Authenticated specs then load that state
 * via `test.use({ storageState: STORAGE_STATE })` and skip the per-test
 * login dance.
 *
 * Today this fakes the auth cookies + user-profile API response. Once the
 * backend has a stable test login endpoint (Week 2 multi-tenancy migration
 * will add one), swap the fake mounts for a real POST /auth/login that
 * mints a valid JWT — the storageState contract stays the same.
 *
 * Why a setup file and not a regular fixture:
 *   - storageState load is a no-op per test (cheap), so the cost of login
 *     is amortized across the whole suite.
 *   - Authenticated specs become readable: zero ceremony before the action
 *     under test, just `await page.goto('/dashboard')`.
 *   - The RBAC tests landing in Week 4 will reuse this exact pattern with
 *     per-role storage state files (admin.json, operator.json, viewer.json).
 */
import { test as setup, expect } from '@playwright/test';
import { STORAGE_STATE } from './auth-state';

setup('authenticate', async ({ page, context }) => {
  // Cookies the frontend uses (see src/lib/api-client.ts tokenManager).
  // The values are intentionally placeholders — auth-context's API mocks
  // accept any non-empty token for now. Replace with a real login flow
  // once the backend exposes a test-token mint endpoint.
  await context.addCookies([
    {
      name: 'access_token',
      value: 'e2e-fixture-token',
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
    {
      name: 'refresh_token',
      value: 'e2e-fixture-refresh',
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ]);

  // Mock /users/profile so the auth context hydrates immediately on the
  // first protected page load. Once cookies are set, navigate so the
  // browser-side localStorage / state gets persisted alongside.
  await context.route('**/api/v1/users/profile', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          id: 1,
          email: 'e2e@example.com',
          full_name: 'E2E User',
          role: 'admin',
        },
      }),
    });
  });

  await page.goto('/dashboard');

  // Smoke check: the sidebar D'Insight wordmark proves the layout mounted,
  // which proves the auth context resolved successfully — i.e. our cookies
  // were honored. If this fails, the storageState we save is unauthenticated.
  await expect(page.getByText("D'Insight").first()).toBeVisible({ timeout: 10_000 });

  // Persist for downstream tests.
  await context.storageState({ path: STORAGE_STATE });
});
