// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

/**
 * LFXV2-3095 — a missing/private public profile must render the branded
 * not-found view in place (URL unchanged, no redirect) and return a real
 * HTTP 404 at the requested path, not a soft-404 (HTTP 200).
 *
 * Runs anonymously — `/u/:username` is a public route.
 */
const NONEXISTENT = '/u/__lfx-nonexistent-e2e-user__';
const TEST_TIMEOUT = 60_000;
const DATA_LOAD_TIMEOUT = 30_000;

// Anonymous context — overrides the default authenticated storageState.
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: TEST_TIMEOUT });

test.describe('Public profile — missing profile 404 (LFXV2-3095)', () => {
  test('SSR responds with a real HTTP 404 at the requested path', async ({ request }) => {
    const response = await request.get(NONEXISTENT);
    expect(response.status()).toBe(404);
    // The SSR HTML already carries the branded not-found view, not an empty shell.
    expect(await response.text()).toContain('public-profile-not-found-card');
  });

  test('renders the not-found view in place without a redirect', async ({ page }) => {
    const response = await page.goto(NONEXISTENT, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL(/\/u\/__lfx-nonexistent-e2e-user__$/);
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('public-profile-not-found-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // The "Powered by LFX" branding topbar must stay on the not-found view — guards against a regression
    // that drops the header while still rendering the not-found card.
    await expect(page.getByTestId('public-profile-topbar')).toBeVisible();
  });
});
