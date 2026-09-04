// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { skipWhenAuthMissing } from './helpers/auth.helper';

test.beforeEach(() => skipWhenAuthMissing());

/**
 * LFXV2-3095 — the primary catch-all behavior: an authenticated user hitting an
 * unknown in-app URL must render the branded not-found view in place, inside the
 * app shell (left nav visible), with the URL preserved and a real HTTP 404 at the
 * originally-requested path (no redirect, no soft-404).
 *
 * Runs authenticated (default storageState) — this exercises the empty-path-parent
 * → `**` child ordering, the `server.ts` 200→404 rewrite, and the REQUEST_CONTEXT
 * flag plumbing that the anonymous `/u/:username` spec does not cover.
 */
const UNKNOWN_PATH = '/__lfx-nonexistent-e2e-route__';
const TEST_TIMEOUT = 60_000;
const RENDER_TIMEOUT = 30_000;

test.describe.configure({ timeout: TEST_TIMEOUT });

test.describe('In-shell catch-all 404 for authenticated unknown route (LFXV2-3095)', () => {
  // Pin a desktop viewport so the assertion holds across every Playwright project: the shell's left-nav
  // sidebar is `hidden lg:flex`, so under the mobile-chrome project (Pixel 5, 393px) it is display:none.
  // A ≥lg width keeps the in-shell sidebar visible regardless of the project's default device viewport.
  test.use({ viewport: { width: 1440, height: 900 } });

  test('SSR responds with a real HTTP 404 at the requested path', async ({ request }) => {
    const response = await request.get(UNKNOWN_PATH);
    expect(response.status()).toBe(404);
    // The SSR HTML already carries the branded not-found view, not an empty shell or a redirect body.
    expect(await response.text()).toContain('not-found-card');
  });

  test('renders the not-found view in the app shell without a redirect', async ({ page }) => {
    const response = await page.goto(UNKNOWN_PATH, { waitUntil: 'domcontentloaded' });

    expect(response?.status()).toBe(404);
    // URL is preserved — no client-side redirect to /not-found or the login provider.
    await expect(page).toHaveURL(/\/__lfx-nonexistent-e2e-route__$/);
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Branded 404 renders inside the shell: the left-nav sidebar and main content region are present.
    await expect(page.getByTestId('not-found-card')).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: RENDER_TIMEOUT });
    await expect(page.getByTestId('main-content')).toBeVisible();
  });
});
