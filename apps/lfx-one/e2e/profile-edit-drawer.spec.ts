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

  test('S4: avatar upload 403 management_token_required redirects to Flow C authorization', async ({ page }) => {
    // Stub the upload to return the Flow C gate response, and stub the authorize route itself so the
    // resulting full-page redirect resolves locally instead of depending on real Auth0.
    let authorizeRequested = false;
    await page.route('**/api/profile/picture-upload', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'management_token_required',
            message: 'Profile authorization required',
            authorize_url: '/api/profile/auth/start?returnTo=/profile',
          }),
        });
        return;
      }
      await route.fallback();
    });
    await page.route('**/api/profile/auth/start**', async (route) => {
      authorizeRequested = true;
      await route.fulfill({ status: 302, headers: { location: '/profile' } });
    });

    await gotoProfile(page);
    await page.getByTestId('profile-edit-button').click();

    const drawer = page.getByTestId('profile-edit-drawer-body');
    await expect(drawer).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // 1x1 transparent PNG.
    const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await page.getByTestId('profile-edit-drawer-avatar-input').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: tinyPng });

    // The redirect is a real full-page navigation, so assert on the captured request rather than
    // racing the navigation's own lifecycle.
    await expect.poll(() => authorizeRequested, { timeout: ELEMENT_TIMEOUT }).toBe(true);
  });

  test('S4b: an over-2MB avatar is rejected client-side and never uploaded', async ({ page }) => {
    // Regression for LFXV2-2628: MAX_AVATAR_SIZE_BYTES was lowered from 20MB to 2MB. Assert the
    // rejection boundary sits at the new limit and that no request reaches the upload route.
    let uploadRequested = false;
    await page.route('**/api/profile/picture-upload', async (route) => {
      uploadRequested = true;
      await route.fallback();
    });

    await gotoProfile(page);
    await page.getByTestId('profile-edit-button').click();

    const drawer = page.getByTestId('profile-edit-drawer-body');
    await expect(drawer).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // A valid PNG header followed by padding, sized just over the 2MB (2 * 1024 * 1024 bytes) cap.
    const oversizedPng = Buffer.concat([
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      Buffer.alloc(2 * 1024 * 1024 + 1),
    ]);
    await page.getByTestId('profile-edit-drawer-avatar-input').setInputFiles({ name: 'oversized-avatar.png', mimeType: 'image/png', buffer: oversizedPng });

    await expect(page.locator('.p-toast'), 'error toast should appear').toContainText('Image must be 2MB or smaller.', { timeout: ELEMENT_TIMEOUT });
    expect(uploadRequested, 'the oversized file must never reach the upload route').toBe(false);
  });

  test('S5: About Me saves, the drawer closes, and the panel reflects the bio', async ({ page }) => {
    // Stub the write so the real profile is never mutated — assert on drawer-close + optimistic update,
    // and lock in that the bio rides inside the user_metadata envelope.
    let patchBody: { user_metadata?: { bio?: string } } | null = null;
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

    const bio = page.getByTestId('profile-edit-drawer-about-me').locator('textarea');
    const uniqueBio = `E2E bio ${Date.now()}`;
    await bio.fill(uniqueBio);

    const saveButton = page.getByTestId('profile-edit-drawer-save-button').locator('button');
    await expect(saveButton, 'Save enables once the form is dirty').toBeEnabled({ timeout: ELEMENT_TIMEOUT });
    await saveButton.click();

    await expect(drawer, 'drawer should close after a successful save').toBeHidden({ timeout: ELEMENT_TIMEOUT });
    // Optimistic update: bio maps to the panel's About Me block without a refetch.
    await expect(page.getByTestId('profile-panel-about'), 'panel should reflect the edited bio optimistically').toContainText(uniqueBio, {
      timeout: ELEMENT_TIMEOUT,
    });
    // The drawer must send the bio inside the user_metadata envelope.
    expect(patchBody?.user_metadata?.bio).toBe(uniqueBio);
  });

  test('S5: clearing a previously-set free-text field sends "" and hides it in the panel', async ({ page }) => {
    // Free-text fields are clearable (LFXV2-2933): emptying the control must send bio: '' rather than
    // the old `|| undefined` that omitted the key. Stub PATCH; patchBody holds the latest request.
    let patchBody: { user_metadata?: { bio?: string } } | null = null;
    await page.route('**/api/profile', async (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = route.request().postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fallback();
    });

    await gotoProfile(page);

    // Seed a bio so there's a set value to clear (the test user's starting bio is unknown).
    await page.getByTestId('profile-edit-button').click();
    const drawer = page.getByTestId('profile-edit-drawer-body');
    await expect(drawer).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    const bio = page.getByTestId('profile-edit-drawer-about-me').locator('textarea');
    const uniqueBio = `E2E bio ${Date.now()}`;
    await bio.fill(uniqueBio);

    const saveButton = page.getByTestId('profile-edit-drawer-save-button').locator('button');
    await expect(saveButton).toBeEnabled({ timeout: ELEMENT_TIMEOUT });
    await saveButton.click();
    await expect(drawer, 'drawer should close after the seeding save').toBeHidden({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('profile-panel-about'), 'panel should show the seeded bio').toContainText(uniqueBio, {
      timeout: ELEMENT_TIMEOUT,
    });

    // Reopen: the drawer is seeded from the layout's optimistically-updated profile, so the bio
    // textarea carries the value we just saved.
    await page.getByTestId('profile-edit-button').click();
    await expect(drawer, 'drawer should reopen').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(bio, 'reopened drawer should seed the just-saved bio').toHaveValue(uniqueBio, { timeout: ELEMENT_TIMEOUT });

    // Clear the field and save.
    await bio.fill('');
    await expect(saveButton, 'Save enables once the cleared field makes the form dirty').toBeEnabled({ timeout: ELEMENT_TIMEOUT });
    await saveButton.click();

    await expect(drawer, 'drawer should close after the clear save').toBeHidden({ timeout: ELEMENT_TIMEOUT });
    // Optimistic clear: the About Me block is hidden once bio is empty (@if (aboutMe()) gate).
    await expect(page.getByTestId('profile-panel-about'), 'panel should drop the About Me block once bio is cleared').toBeHidden({
      timeout: ELEMENT_TIMEOUT,
    });
    // The wire must carry an explicit empty string, not an omitted key.
    expect(patchBody?.user_metadata?.bio).toBe('');
  });

  test('S6: when metadata failed to load, clearing free-text fields omits them (no wipe)', async ({ page }) => {
    // Guard for LFXV2-2933: clear-to-empty only fires once profile metadata loaded. When the GET
    // returns no `profile` (a NATS getUserInfo miss), the drawer seeds those controls empty, so an
    // empty save must fall back to `|| undefined` and OMIT the keys rather than wipe stored data the
    // form never received. Rewrite the GET to strip `profile` (keeping the real `user` so the panel
    // still renders), then assert cleared bio + job_title are absent from the PATCH.
    let patchBody: { user_metadata?: Record<string, unknown> } | null = null;
    await page.route('**/api/profile', async (route) => {
      const request = route.request();
      if (request.method() === 'PATCH') {
        patchBody = request.postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      if (request.method() === 'GET') {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({ response, json: { ...body, profile: null } });
        return;
      }
      await route.fallback();
    });

    await gotoProfile(page);
    await page.getByTestId('profile-edit-button').click();

    const drawer = page.getByTestId('profile-edit-drawer-body');
    await expect(drawer).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Dirty then clear both fields so the form is submittable but each value is empty at save time.
    const bio = page.getByTestId('profile-edit-drawer-about-me').locator('textarea');
    const jobTitle = page.getByTestId('profile-edit-drawer-job-title').locator('input');
    await bio.fill('temporary bio');
    await bio.fill('');
    await jobTitle.fill('temporary title');
    await jobTitle.fill('');

    const saveButton = page.getByTestId('profile-edit-drawer-save-button').locator('button');
    await expect(saveButton, 'Save enables once the dirtied fields make the form dirty').toBeEnabled({ timeout: ELEMENT_TIMEOUT });
    await saveButton.click();
    await expect(drawer, 'drawer should close after save').toBeHidden({ timeout: ELEMENT_TIMEOUT });

    // metadataLoaded === false → freeText('') maps to undefined → JSON.stringify drops the keys.
    expect(patchBody?.user_metadata, 'PATCH should still send a user_metadata envelope').toBeTruthy();
    expect(patchBody?.user_metadata && 'bio' in patchBody.user_metadata, 'empty bio must be omitted, not sent as ""').toBe(false);
    expect(patchBody?.user_metadata && 'job_title' in patchBody.user_metadata, 'empty job_title must be omitted, not sent as ""').toBe(false);
  });

  test('S7: a save on a failed load does not enable clear-to-empty on reopen', async ({ page }) => {
    // Regression for LFXV2-2933: with the profile GET always returning no `profile`, a first save must
    // not fabricate a non-null profile that flips metadataLoaded true and lets a later save wipe fields.
    let lastPatchBody: { user_metadata?: Record<string, unknown> } | null = null;
    await page.route('**/api/profile', async (route) => {
      const request = route.request();
      if (request.method() === 'PATCH') {
        lastPatchBody = request.postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      if (request.method() === 'GET') {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({ response, json: { ...body, profile: null } });
        return;
      }
      await route.fallback();
    });

    await gotoProfile(page);

    const drawer = page.getByTestId('profile-edit-drawer-body');
    const jobTitle = page.getByTestId('profile-edit-drawer-job-title').locator('input');
    const bio = page.getByTestId('profile-edit-drawer-about-me').locator('textarea');
    const saveButton = page.getByTestId('profile-edit-drawer-save-button').locator('button');

    // First save on the degraded load: set a job_title so the form is dirty, then persist.
    await page.getByTestId('profile-edit-button').click();
    await expect(drawer).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await jobTitle.fill('Engineer');
    await expect(saveButton).toBeEnabled({ timeout: ELEMENT_TIMEOUT });
    await saveButton.click();
    await expect(drawer, 'drawer should close after the first save').toBeHidden({ timeout: ELEMENT_TIMEOUT });

    // Reopen and clear bio: metadataLoaded must still be false (the GET never loaded a profile), so an
    // empty bio is omitted rather than sent as '' and wiping data the failed GET never returned.
    await page.getByTestId('profile-edit-button').click();
    await expect(drawer, 'drawer should reopen').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await bio.fill('temporary bio');
    await bio.fill('');
    await expect(saveButton).toBeEnabled({ timeout: ELEMENT_TIMEOUT });
    await saveButton.click();
    await expect(drawer, 'drawer should close after the second save').toBeHidden({ timeout: ELEMENT_TIMEOUT });

    expect(lastPatchBody?.user_metadata, 'second PATCH should send a user_metadata envelope').toBeTruthy();
    expect(lastPatchBody?.user_metadata && 'bio' in lastPatchBody.user_metadata, 'empty bio must stay omitted after reopen').toBe(false);
  });

  test('S8: an over-limit emoji bio is hard-capped at 2000 code points, not UTF-16 units', async ({ page }) => {
    // Regression for LFXV2-3104: the cap counts code points, not UTF-16 units — a 2001-emoji paste
    // (4002 UTF-16 units) is trimmed to exactly 2000 emoji, where native [maxlength] would stop at ~1000.
    await gotoProfile(page);
    await page.getByTestId('profile-edit-button').click();

    const drawer = page.getByTestId('profile-edit-drawer-body');
    await expect(drawer).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    const bio = page.getByTestId('profile-edit-drawer-about-me').locator('textarea');
    await bio.fill('😀'.repeat(2001));

    // The field is trimmed by code point to exactly 2000 emoji (not 2000 UTF-16 units, which would be
    // 1000 emoji), so the value settles at 2000 glyphs and the counter reads 2000 / 2000.
    await expect(bio, 'over-limit bio should be capped at 2000 code points').toHaveValue('😀'.repeat(2000), { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('profile-edit-drawer-about-me-counter')).toHaveText('2000 / 2000');
  });
});
