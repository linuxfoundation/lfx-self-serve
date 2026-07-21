// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Profile Edit Drawer E2E — LFXV2-2742.
 *
 * Covers the right-side edit drawer that replaced the profile edit dialog:
 *   1. Both entry points (the "Edit profile" button and the avatar edit-badge) open the drawer.
 *   2. Cancel / the close icon dismiss it.
 *   3. The form is seeded from the current profile, and Save closes the drawer and reflects the
 *      change in the panel via the optimistic update.
 *
 * The Save test stubs PATCH /api/profile so it never mutates the real test user's profile — the
 * assertion is on the drawer-close + optimistic-update behaviour, not on a persisted write.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 */

import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

// Hard skip when the auth-bootstrap failed — hostname-exact match so a crafted URL like
// `https://auth0.com.evil.com/` can't fool the gate (mirrors org-selector.spec.ts).
function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — keep running; a failure here is useful signal, not noise.
  }
}

// Neutralize the Osano consent overlay, which otherwise intercepts pointer events. Registered via
// addInitScript so it applies on every navigation before page scripts (see me-profile-nav.spec.ts).
async function suppressCookieBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const hide = (): void => {
      if (document.getElementById('e2e-hide-osano')) {
        return;
      }
      const style = document.createElement('style');
      style.id = 'e2e-hide-osano';
      style.textContent = '.osano-cm-window { display: none !important; pointer-events: none !important; }';
      (document.head ?? document.documentElement).appendChild(style);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hide);
    } else {
      hide();
    }
  });
}

/** Navigate to the profile hub and wait for the panel to render with real data. */
async function gotoProfile(page: Page): Promise<void> {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page.getByTestId('profile-panel'), 'profile panel should render').toBeVisible({ timeout: LOAD_TIMEOUT });
  // openEditDrawer() no-ops until the profile GET has populated combinedProfile; the display name
  // resolves once that data is in, so wait for it before triggering the drawer.
  await expect(page.getByTestId('profile-display-name'), 'profile display name should resolve').toBeVisible({ timeout: LOAD_TIMEOUT });
}

test.describe('Profile edit drawer', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });

  test('S1: the "Edit profile" button opens the drawer, Cancel closes it', async ({ page }) => {
    await gotoProfile(page);

    await page.getByTestId('profile-edit-button').click();

    const drawer = page.getByTestId('profile-edit-drawer-body');
    await expect(drawer, 'drawer should open').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('profile-edit-drawer-header')).toContainText('Edit Profile');
    await expect(page.getByTestId('profile-edit-drawer-first-name')).toBeVisible();

    await page.getByTestId('profile-edit-drawer-cancel-button').locator('button').click();
    await expect(drawer, 'drawer should close on Cancel').toBeHidden({ timeout: ELEMENT_TIMEOUT });
  });

  test('S2: the avatar edit-badge opens the drawer', async ({ page }) => {
    await gotoProfile(page);

    await page.getByTestId('profile-panel-edit-badge').click();

    await expect(page.getByTestId('profile-edit-drawer-body'), 'drawer should open from the avatar badge').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('S3: Save closes the drawer and the panel reflects the edited name', async ({ page }) => {
    // Stub the write so the real profile is never mutated — assert on drawer-close + optimistic update.
    // Capture the request body to lock in the { user_metadata: {...} } envelope the layout's
    // applyOptimisticProfileUpdate depends on.
    let patchBody: { user_metadata?: { given_name?: string } } | null = null;
    await page.route('**/api/profile', async (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fallback();
    });

    await gotoProfile(page);
    await page.getByTestId('profile-edit-button').click();

    const drawer = page.getByTestId('profile-edit-drawer-body');
    await expect(drawer).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    const firstName = page.getByTestId('profile-edit-drawer-first-name').locator('input');
    const uniqueName = `E2E-${Date.now()}`;
    await firstName.fill(uniqueName);

    const saveButton = page.getByTestId('profile-edit-drawer-save-button').locator('button');
    await expect(saveButton, 'Save enables once the form is dirty').toBeEnabled({ timeout: ELEMENT_TIMEOUT });
    await saveButton.click();

    await expect(drawer, 'drawer should close after a successful save').toBeHidden({ timeout: ELEMENT_TIMEOUT });
    // Optimistic update: given_name maps to the panel's display name without a refetch.
    await expect(page.getByTestId('profile-display-name'), 'panel should reflect the edited name optimistically').toContainText(uniqueName, {
      timeout: ELEMENT_TIMEOUT,
    });
    // The drawer must send a user_metadata envelope (not a flat body) carrying the edited field.
    expect(patchBody?.user_metadata?.given_name).toBe(uniqueName);
  });
});
