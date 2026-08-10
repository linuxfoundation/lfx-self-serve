// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Public-profile visibility drawer E2E — LFXV2-2629.
 *
 * Covers the visibility drawer opened from the profile panel:
 *   1. Opening it fetches the current visibility (GET /api/profile/visibility) and seeds the toggles.
 *   2. Toggling a section auto-saves (debounced PATCH) and the inline status reflects "saved".
 *   3. The client-side cascade: turning the `basic` parent off zeroes its About Me / Personal
 *      Information children in the persisted map.
 *   4. Closing the drawer flushes a pending (debounced) change so nothing is lost.
 *   5. A failed load shows the error + retry affordance, and retry recovers into the form.
 *   6. Dismissing the drawer while a save is in flight keeps it open (busy-close guard) and closes
 *      only once the queued flush drains, still carrying the close-time edit.
 *   7. A superseded failed save (an older write that fails while a newer one is already queued) does
 *      not pin the inline indicator on "Saving".
 *
 * Every test stubs GET and PATCH /api/profile/visibility so the real account is never mutated — the
 * assertions are on the seeded state, the drawer behaviour, and the PATCH payloads.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 */

import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

type Sections = Record<string, boolean>;

/** All-false section map with optional overrides (mirrors PROFILE_VISIBILITY_DEFAULTS ordering). */
function sectionsMap(overrides: Sections = {}): Sections {
  return {
    basic: false,
    aboutMe: false,
    personalInfo: false,
    technical_contribution: false,
    community_roles: false,
    event_activities: false,
    training_activities: false,
    certification_activities: false,
    badges: false,
    skills: false,
    ...overrides,
  };
}

// Hard skip when the auth-bootstrap failed — hostname-exact match so a crafted URL can't fool the gate.
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

// Neutralize the Osano consent overlay, which otherwise intercepts pointer events.
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
  await expect(page.getByTestId('profile-display-name'), 'profile display name should resolve').toBeVisible({ timeout: LOAD_TIMEOUT });
}

/** Open the visibility drawer from the panel affordance and wait for its body. */
async function openDrawer(page: Page): Promise<void> {
  await page.getByTestId('profile-visibility-button').click();
  await expect(page.getByTestId('profile-visibility-drawer-body'), 'visibility drawer should open').toBeVisible({ timeout: ELEMENT_TIMEOUT });
}

/** The interactive input inside an lfx-toggle wrapper for a given visibility key. */
function toggleInput(page: Page, key: string) {
  return page.locator(`[data-test="profile-visibility-drawer-toggle-${key}"] input`);
}

test.describe('Profile visibility drawer', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });

  test('S1: opening the drawer seeds the toggles from the fetched visibility', async ({ page }) => {
    await page.route('**/api/profile/visibility', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            isPublic: true,
            sections: sectionsMap({ basic: true, aboutMe: true, personalInfo: true, badges: true }),
            preferenceId: 'pref-1',
          }),
        });
        return;
      }
      await route.fallback();
    });

    await gotoProfile(page);
    await openDrawer(page);

    // Sections tab is active first; the badges toggle should reflect the seeded `true`.
    await expect(toggleInput(page, 'badges'), 'seeded badges toggle should be on').toBeChecked({ timeout: ELEMENT_TIMEOUT });
    // A section left false in the fetched map should be off.
    await expect(toggleInput(page, 'skills'), 'seeded skills toggle should be off').not.toBeChecked();
  });

  test('S2: toggling a section auto-saves and the status reflects "saved"', async ({ page }) => {
    let lastPatch: { isPublic?: boolean; sections?: Sections } | null = null;
    await page.route('**/api/profile/visibility', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ isPublic: true, sections: sectionsMap({ basic: true, aboutMe: true, personalInfo: true }), preferenceId: 'pref-1' }),
        });
        return;
      }
      if (request.method() === 'PATCH') {
        lastPatch = request.postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ isPublic: lastPatch?.isPublic, sections: lastPatch?.sections, preferenceId: 'pref-1' }),
        });
        return;
      }
      await route.fallback();
    });

    await gotoProfile(page);
    await openDrawer(page);

    // Turn the badges section on; the debounced auto-save fires a PATCH carrying badges: true.
    const patchPromise = page.waitForRequest((r) => r.url().includes('/api/profile/visibility') && r.method() === 'PATCH');
    await page.locator('[data-test="profile-visibility-drawer-toggle-badges"]').click();
    await patchPromise;

    await expect(page.getByTestId('profile-visibility-drawer-status'), 'status should confirm the save').toContainText('All changes saved', {
      timeout: ELEMENT_TIMEOUT,
    });
    expect(lastPatch?.sections?.badges, 'PATCH should carry the toggled-on section').toBe(true);
  });

  test('S3: turning the basic parent off zeroes its children in the saved map', async ({ page }) => {
    let lastPatch: { sections?: Sections } | null = null;
    await page.route('**/api/profile/visibility', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ isPublic: true, sections: sectionsMap({ basic: true, aboutMe: true, personalInfo: true }), preferenceId: 'pref-1' }),
        });
        return;
      }
      if (request.method() === 'PATCH') {
        lastPatch = request.postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ isPublic: true, sections: lastPatch?.sections, preferenceId: 'pref-1' }),
        });
        return;
      }
      await route.fallback();
    });

    await gotoProfile(page);
    await openDrawer(page);

    // The basic group lives on the Personal Data tab.
    await page.getByTestId('profile-visibility-drawer-tab-personal').click();
    await expect(page.getByTestId('profile-visibility-drawer-personal'), 'personal tab panel should render').toBeVisible({ timeout: ELEMENT_TIMEOUT });

    const patchPromise = page.waitForRequest((r) => r.url().includes('/api/profile/visibility') && r.method() === 'PATCH');
    await page.locator('[data-test="profile-visibility-drawer-toggle-basic"]').click();
    await patchPromise;

    // Cascade: the parent and both children are off in the persisted map.
    expect(lastPatch?.sections?.basic, 'basic should be off').toBe(false);
    expect(lastPatch?.sections?.aboutMe, 'aboutMe should cascade off').toBe(false);
    expect(lastPatch?.sections?.personalInfo, 'personalInfo should cascade off').toBe(false);
  });

  test('S4: closing the drawer flushes a pending change', async ({ page }) => {
    let lastPatch: { sections?: Sections } | null = null;
    await page.route('**/api/profile/visibility', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ isPublic: true, sections: sectionsMap({ basic: true, aboutMe: true, personalInfo: true }), preferenceId: 'pref-1' }),
        });
        return;
      }
      if (request.method() === 'PATCH') {
        lastPatch = request.postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ isPublic: true, sections: lastPatch?.sections, preferenceId: 'pref-1' }),
        });
        return;
      }
      await route.fallback();
    });

    await gotoProfile(page);
    await openDrawer(page);

    // Toggle then immediately close — the close-time flush must persist the change without waiting for
    // the debounce window.
    const patchPromise = page.waitForRequest((r) => r.url().includes('/api/profile/visibility') && r.method() === 'PATCH');
    await page.locator('[data-test="profile-visibility-drawer-toggle-badges"]').click();
    await page.keyboard.press('Escape');
    await patchPromise;

    await expect(page.getByTestId('profile-visibility-drawer-body'), 'drawer should close').toBeHidden({ timeout: ELEMENT_TIMEOUT });
    expect(lastPatch?.sections?.badges, 'the flushed PATCH should carry the change').toBe(true);
  });

  test('S5: a failed load shows the retry affordance and recovers on retry', async ({ page }) => {
    let failNext = true;
    await page.route('**/api/profile/visibility', async (route) => {
      if (route.request().method() === 'GET') {
        if (failNext) {
          failNext = false;
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ isPublic: false, sections: sectionsMap(), preferenceId: null }),
        });
        return;
      }
      await route.fallback();
    });

    await gotoProfile(page);
    await openDrawer(page);

    // First load failed → the error + retry block renders instead of the form.
    await expect(page.getByTestId('profile-visibility-drawer-error'), 'error block should render on load failure').toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Retry re-fetches (now succeeding) and the form replaces the error block.
    await page.getByTestId('profile-visibility-drawer-retry-button').click();
    await expect(page.getByTestId('profile-visibility-drawer-error'), 'error block should clear after a successful retry').toBeHidden({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId('profile-visibility-drawer-tab-sections'), 'the tablist should render after retry').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('S6: a dismissal during an in-flight save keeps the drawer open, then closes once it drains', async ({ page }) => {
    const patchSections: Sections[] = [];
    let releaseFirstPatch: (() => void) | null = null;
    const firstPatchGate = new Promise<void>((resolve) => {
      releaseFirstPatch = resolve;
    });
    let patchCount = 0;
    let storedSections = sectionsMap({ basic: true, aboutMe: true, personalInfo: true });

    await page.route('**/api/profile/visibility', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ isPublic: true, sections: storedSections, preferenceId: 'pref-1' }),
        });
        return;
      }
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        patchCount += 1;
        patchSections.push(body.sections);
        // Hold the first save in flight so the close-time flush must queue behind it (concatMap).
        if (patchCount === 1) {
          await firstPatchGate;
        }
        storedSections = body.sections;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ isPublic: body.isPublic, sections: body.sections, preferenceId: 'pref-1' }),
        });
        return;
      }
      await route.fallback();
    });

    await gotoProfile(page);
    await openDrawer(page);

    // Save A: toggle badges → the debounced PATCH fires and is held open by the gate above.
    const firstPatch = page.waitForRequest((r) => r.url().includes('/api/profile/visibility') && r.method() === 'PATCH');
    await page.locator('[data-test="profile-visibility-drawer-toggle-badges"]').click();
    await firstPatch;

    // Edit B + dismiss while save A is still in flight → the flush queues B behind A, and the busy-close
    // guard keeps the drawer open (the dismissal can't cancel the write) rather than closing immediately.
    await page.locator('[data-test="profile-visibility-drawer-toggle-skills"]').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('profile-visibility-drawer-body'), 'drawer stays open while a save is pending').toBeVisible();
    await expect(page.getByTestId('profile-visibility-drawer-status'), 'the indicator reflects the pending save').toContainText('Saving', {
      timeout: ELEMENT_TIMEOUT,
    });

    // Release A → it drains, the queued flush issues the second PATCH, and the deferred close fires.
    releaseFirstPatch?.();
    await expect.poll(() => patchSections.length, { timeout: ELEMENT_TIMEOUT }).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('profile-visibility-drawer-body'), 'drawer closes once the deferred save drains').toBeHidden({ timeout: ELEMENT_TIMEOUT });

    // The queued flush serializes the state at dismissal (skills on), retaining both edits.
    expect(patchSections[1]?.skills, 'the queued flush should carry the close-time edit').toBe(true);
    expect(patchSections[1]?.badges, 'the queued flush should also retain the earlier toggle').toBe(true);
  });

  test('S7: a superseded failed save does not pin the indicator on "Saving"', async ({ page }) => {
    const patchSections: Sections[] = [];
    let releaseFirstPatch: (() => void) | null = null;
    const firstPatchGate = new Promise<void>((resolve) => {
      releaseFirstPatch = resolve;
    });
    let patchCount = 0;
    const storedSections = sectionsMap({ basic: true, aboutMe: true, personalInfo: true });

    await page.route('**/api/profile/visibility', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ isPublic: true, sections: storedSections, preferenceId: 'pref-1' }),
        });
        return;
      }
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON();
        patchCount += 1;
        patchSections.push(body.sections);
        if (patchCount === 1) {
          // Hold the older save in flight so the newer one queues behind it, then fail it.
          await firstPatchGate;
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
          return;
        }
        // The newer (superseding) save succeeds.
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ isPublic: body.isPublic, sections: body.sections, preferenceId: 'pref-1' }),
        });
        return;
      }
      await route.fallback();
    });

    await gotoProfile(page);
    await openDrawer(page);

    // Save A: toggle badges → the debounced PATCH fires and is held (it will 500).
    const firstPatch = page.waitForRequest((r) => r.url().includes('/api/profile/visibility') && r.method() === 'PATCH');
    await page.locator('[data-test="profile-visibility-drawer-toggle-badges"]').click();
    await firstPatch;

    // Save B: toggle skills → let the debounce elapse so B is accepted and queued behind A (concatMap
    // won't fire B's request until A settles, so waiting on the debounce is the only observable signal).
    await page.locator('[data-test="profile-visibility-drawer-toggle-skills"]').click();
    await page.waitForTimeout(1_000);

    // Release A → it fails, but a newer save (B) is already queued, so the failure is superseded: no
    // error toast, no sticky dirty. B drains successfully and the indicator settles on "saved".
    releaseFirstPatch?.();
    await expect.poll(() => patchSections.length, { timeout: ELEMENT_TIMEOUT }).toBeGreaterThanOrEqual(2);

    await expect(page.getByTestId('profile-visibility-drawer-status'), 'a superseded failure must not pin the indicator on Saving').toContainText(
      'All changes saved',
      { timeout: ELEMENT_TIMEOUT }
    );
    expect(patchSections[1]?.skills, 'the superseding save carries the newer edit').toBe(true);
    expect(patchSections[1]?.badges, 'the superseding save retains the earlier toggle').toBe(true);
  });
});
