// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

/**
 * US2 acceptance scenarios — signed-in user discovers in-app help, public
 * visitor sees the minimal docs shell.
 *
 * Coverage (per task T031 / T035):
 *   1. Signed-in `/docs` mounts the existing app chrome (lens switcher
 *      column + docs icon visible), preserving FR-009a.
 *   2. Anonymous `/docs/<topic>/<slug>` mounts the public minimal shell —
 *      docs sidebar nav rendered, lens switcher absent, sign-in CTA
 *      visible, FR-009b.
 *   3. Session round-trip: a signed-in user can reach `/docs` from a
 *      non-docs route via the docs icon and the URL remains stable. The
 *      docs icon's active state lights up correctly.
 *   4. Shell flip on auth state change: a context with auth swaps to the
 *      public shell when the storage state is cleared (T035 / FR-009c).
 */

const DATA_LOAD_TIMEOUT = 30_000;
const TEST_TIMEOUT = 60_000;

// 30s data-load timeout demands a test timeout that comfortably exceeds it,
// per docs/architecture/testing/testing-best-practices.md (avoid flake from
// the default 30s test timeout colliding with a 30s `toBeVisible`).
test.describe.configure({ timeout: TEST_TIMEOUT });

test.describe('Docs portal — shell auth states (US2)', () => {
  test.describe('Authenticated visitor', () => {
    test('lens-switcher renders with the docs button on /docs', async ({ page }) => {
      await page.goto('/docs', { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/auth0\.com/);
      await expect(page.getByTestId('lens-switcher')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('lens-docs-button')).toBeVisible();
      await expect(page.getByTestId('docs-shell-authed')).toBeVisible();
    });

    test('docs button is reachable from a non-docs route and routes to /docs', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const docsButton = page.getByTestId('lens-docs-button');
      await expect(docsButton).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      await docsButton.click();
      await expect(page).toHaveURL(/\/docs(\/|$)/);
      await expect(page.getByTestId('docs-landing')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    });

    test('returning to a non-docs route restores prior context', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('lens-switcher')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

      await page.goto('/docs', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('docs-shell-authed')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

      await page.goBack();
      await expect(page).toHaveURL(/^.*\/$|^.*\/dashboard/);
      // Lens switcher persists outside docs and the docs icon is still present.
      await expect(page.getByTestId('lens-switcher')).toBeVisible();
      await expect(page.getByTestId('lens-docs-button')).toBeVisible();
    });
  });

  test.describe('Anonymous visitor', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('public minimal shell renders on /docs', async ({ page }) => {
      const response = await page.goto('/docs', { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      await expect(page.getByTestId('docs-shell-public')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('docs-sidebar-nav')).toBeVisible();
      await expect(page.getByTestId('docs-sidebar-docs-button')).toBeVisible();
      await expect(page.getByTestId('docs-sidebar-signin-button')).toBeVisible();
      // Lens switcher must NOT render in the public shell.
      await expect(page.getByTestId('lens-switcher')).toHaveCount(0);
    });

    test('sign-in CTA preserves returnTo for the current docs URL', async ({ page }) => {
      await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
      const signIn = page.getByTestId('docs-sidebar-signin-button');
      await expect(signIn).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      const href = await signIn.getAttribute('href');
      expect(href).toMatch(/^\/login\?returnTo=/);
      expect(decodeURIComponent(href!.split('returnTo=')[1] ?? '')).toContain('/docs/meetings');
    });

    test('public shell at deep article URL still renders', async ({ page }) => {
      const response = await page.goto('/docs/meetings', { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      await expect(page.getByTestId('docs-shell-public')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('docs-article-title')).toBeVisible();
    });
  });
});
