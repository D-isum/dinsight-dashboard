import { expect, test } from '@playwright/test';

const API_BASE = 'http://localhost:8080/api/v1';

test.describe('core workflows', () => {
  test('auth pages basic flow: login -> invite-only registration -> login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /Welcome Back/i })).toBeVisible();

    await page.getByRole('link', { name: /Sign up/i }).click();
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByRole('heading', { name: /Registration is invite-only/i })).toBeVisible();

    await page.getByRole('link', { name: /Back to sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('dashboard shell: 4-page IA only + perf budget', async ({ context, page }) => {
    await context.addCookies([
      {
        name: 'access_token',
        value: 'test-token',
        domain: 'localhost',
        path: '/',
      },
    ]);

    await context.route(`${API_BASE}/**`, async (route) => {
      const url = route.request().url();

      if (url.endsWith('/users/profile')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { id: 1, full_name: 'Factory Operator', role: 'user', email: 'operator@test' },
          }),
        });
        return;
      }

      if (url.endsWith('/users/live-monitor-preferences')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              updated_at: new Date().toISOString(),
              preferences: {
                selectedId: 1,
                streamSpeed: '1x',
                manualSelectionEnabled: false,
                __meta: { updatedAt: new Date().toISOString() },
              },
            },
          }),
        });
        return;
      }

      if (/\/dinsight\/\d+$/.test(url)) {
        const id = Number(url.split('/').pop());
        if (id === 1) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                dinsight_id: 1,
                source_file: 'baseline.csv',
                uploaded_at: new Date().toISOString(),
                dinsight_x: [0.1, 0.2],
                dinsight_y: [0.3, 0.4],
              },
            }),
          });
          return;
        }

        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ success: false }),
        });
        return;
      }

      if (/\/streaming\/1\/status$/.test(url)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              total_points: 100,
              streamed_points: 50,
              progress_percentage: 50,
              latest_glow_count: 5,
              is_active: true,
              status: 'streaming',
            },
          }),
        });
        return;
      }

      if (url.endsWith('/anomaly/detect')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { anomaly_percentage: 2.4, anomaly_count: 2, total_points: 50 },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {} }),
      });
    });

    await page.goto('/dashboard');
    await expect(page.getByText('Machine status', { exact: true })).toBeVisible();

    await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Data', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Asset Monitor', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toBeVisible();

    await expect(page.getByRole('link', { name: /Visualization/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Streaming/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Live Monitor', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Health Insights', exact: true })).toHaveCount(0);

    const dclMs = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return nav ? nav.domContentLoadedEventEnd : 0;
    });
    expect(dclMs).toBeLessThan(5000);
  });
});
