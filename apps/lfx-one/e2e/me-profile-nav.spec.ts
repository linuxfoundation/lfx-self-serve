// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Me-lens Profile Navigation E2E — LFXV2-2741.
 *
 * Covers the redesigned Me-lens profile entry points added in PR #1136:
 *   1. Navbar "me card" — its "Profile & Account" action links to /profile.
 *   2. Navbar account menu — the "Settings" action (→ /profile/settings) and the
 *      "Profile & Account" action (→ /profile), each of which also activates the Me lens.
 * Those run with the profile redesign flag pinned off. With it pinned on (#6069), the me card splits into Profile and
 * Account & Settings, and the account menu's Settings opens the /account landing page.
 *
 * Both surfaces are desktop-shell affordances; on mobile the navbar sits in a drawer,
 * so these specs skip on the narrow (mobile) viewport.
 *
 * "Me lens active" is asserted via the me card's visibility: showMeSelector() === (activeLens()
 * === 'me') toggles the card's `hidden` class. Because a fresh context defaults to the Me lens
 * (DEFAULT_LENS = 'me'), the account-menu tests first establish a non-Me (foundation) lens via
 * stubbed persona/nav APIs — otherwise the card would already be visible and the assertion could
 * not detect setLens('me') breaking.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, PROFILE_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import type { LensItem } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

// ─── Timeouts ───────────────────────────────────────────────────────────────
test.setTimeout(60_000);

const SIDEBAR_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

// ─── Test data ────────────────────────────────────────────────────────────────
// With the profile redesign off, /profile redirects to its first tab, so this is the canonical landing route for any bare-/profile nav.
const PROFILE_DEFAULT_URL = /\/profile\/attributions\b/;
// With it on, /profile is the Profile page itself (#6082).
const PROFILE_PAGE_URL = /\/profile$/;

// Foundation-lens fixtures — used only to seed a non-Me lens as the precondition for the account-menu tests.
const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_FOUNDATION_ITEM: LensItem = {
  uid: 'f0000000-0000-0000-0000-000000000001',
  slug: MOCK_FOUNDATION_SLUG,
  name: 'Test Foundation',
  logoUrl: null,
  isFoundation: true,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// The me card and account menu are desktop-shell affordances; the mobile shell hides them
// behind the drawer. Skip on the narrow (mobile-chrome) viewport rather than
// hard-coding a project name, which keeps the gate correct if the project list changes.
function skipOnMobileViewport(page: Page): void {
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 768) {
    test.skip(true, 'Desktop-only profile affordance — mobile opens the navbar in a drawer');
  }
}

/**
 * Neutralize the Transcend cookie-consent overlay. global-setup clears cookies, so the banner
 * (#transcend-consent-manager) reappears in each fresh context and its bottom bar intercepts pointer events on
 * the popover items these tests click. Registered via addInitScript so it runs on every navigation
 * before page scripts — deterministic, unlike racing the banner's entrance animation to click Accept.
 * The dialog is irrelevant to these navigation flows, so hiding it is sufficient.
 */
async function suppressCookieBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const hide = (): void => {
      if (document.getElementById('e2e-hide-transcend')) {
        return;
      }
      const style = document.createElement('style');
      style.id = 'e2e-hide-transcend';
      style.textContent = '#transcend-consent-manager { display: none !important; pointer-events: none !important; }';
      (document.head ?? document.documentElement).appendChild(style);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hide);
    } else {
      hide();
    }
  });
}

/**
 * Pin the profile redesign flag (#6067) for every page in this context, so the test account's LaunchDarkly targeting can't
 * decide which entry points render. The non-production localStorage override drives the browser; its cookie mirror drives
 * the server render, which can't read localStorage.
 */
async function pinProfileRedesign(page: Page, enabled: boolean): Promise<void> {
  const overrides = JSON.stringify({ [PROFILE_REDESIGN_FLAG]: enabled });
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
      document.cookie = `${key}=${encodeURIComponent(value)}; path=/; SameSite=Lax`;
    },
    [FEATURE_FLAG_OVERRIDE_STORAGE_KEY, overrides] as const
  );
}

/** Navigate to a Me-lens route and wait for the sidebar (with the me card) to render. */
async function gotoProfileAndWaitForCard(page: Page, url: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  await expect(page.getByTestId('sidebar'), `[${url}] sidebar should be visible`).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
  await expect(page.getByTestId('me-selector'), `[${url}] me-lens card should render`).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
}

/**
 * Open a popover by toggling its trigger, retrying until an expected item renders. The trigger can be
 * painted (SSR) before Angular binds its (click) handler, so an early click is silently dropped;
 * retrying self-heals that race. The guard only clicks when the menu is closed, so a slow-but-
 * successful open is never toggled back shut. All popovers here append to <body>, so the item is
 * queried on the page, not scoped to the trigger.
 */
async function openPopover(page: Page, triggerTestId: string, itemTestId: string): Promise<void> {
  const trigger = page.getByTestId(triggerTestId);
  await expect(trigger).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
  const item = page.getByTestId(itemTestId);
  await expect(async () => {
    if (!(await item.isVisible())) {
      await trigger.click();
    }
    await expect(item).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: SIDEBAR_LOAD_TIMEOUT });
}

// ─── Foundation-lens stubs (account-menu precondition) ──────────────────────────
// Seed a non-Me lens so the post-action `me-selector` assertion proves the account-menu action switched the
// lens back to Me, rather than passing trivially in the default-Me context. Mirrors the stub shape in
// persona-navigation.spec.ts (hermetic: unmatched lens requests return empty items).

async function stubPersona(page: Page, personas: string[]): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas, personaProjects: {}, projects: [], organizations: [], isRootWriter: false }),
    })
  );
}

async function stubFoundationNav(page: Page): Promise<void> {
  await page.route('**/api/nav/lens-items*', (route) => {
    const url = route.request().url();
    const requestedLens = new URL(url).searchParams.get('lens') ?? 'foundation';
    const items = requestedLens === 'foundation' ? [MOCK_FOUNDATION_ITEM] : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, next_page_token: null, upstream_failed: false, lens: requestedLens }),
    });
  });
  await page.route(`**/api/projects/${MOCK_FOUNDATION_SLUG}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ uid: MOCK_FOUNDATION_ITEM.uid, slug: MOCK_FOUNDATION_SLUG, name: 'Test Foundation', public: true, writer: true }),
    })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sfid: null }) }));
}

/** Put the app on the foundation lens (me card hidden) so a later switch to Me is observable. */
async function establishFoundationLens(page: Page): Promise<void> {
  await stubPersona(page, ['board-member']);
  await stubFoundationNav(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page.getByTestId('sidebar'), 'sidebar should be visible on the foundation lens').toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
  // Precondition: not on the Me lens. The card stays in the DOM but is toggled off via a `hidden`
  // class ([class.hidden]="!showMeSelector()"), so assert not-visible rather than not-attached.
  await expect(page.getByTestId('me-selector'), 'me card should be hidden off the Me lens').toBeHidden({ timeout: SIDEBAR_LOAD_TIMEOUT });
}

/** Establish a non-Me lens, then open the navbar account menu and wait for its actions to render. */
async function openUserMenu(page: Page): Promise<void> {
  await establishFoundationLens(page);
  await openPopover(page, 'lens-user-avatar', 'lens-settings');
}

// ─── S1: Navbar me-lens profile card ─────────────────────────────────────────

test.describe('Me-lens profile card', () => {
  test.beforeEach(async ({ page }) => {
    skipOnMobileViewport(page);
    await suppressCookieBanner(page);
    await pinProfileRedesign(page, false);
  });

  test('S1: Profile & Account navigates to /profile', async ({ page }) => {
    // Start on a different Me-lens tab so the assertion proves the click *changed* the route — not
    // just that we were already somewhere under /profile.
    await gotoProfileAndWaitForCard(page, '/profile/identities');

    await page.getByTestId('me-card-link').click();

    // The action links to /profile, which redirects to the canonical first tab.
    await expect(page, 'Profile & Account should navigate to the default Profile tab').toHaveURL(PROFILE_DEFAULT_URL, { timeout: ELEMENT_TIMEOUT });
  });
});

// ─── S4: Navbar account menu ────────────────────────────────────────────────

test.describe('Navbar account menu', () => {
  test.beforeEach(async ({ page }) => {
    skipOnMobileViewport(page);
    await suppressCookieBanner(page);
    await pinProfileRedesign(page, false);
  });

  test('S4: Settings action navigates to /profile/settings and activates the Me lens', async ({ page }) => {
    // openUserMenu starts on the foundation lens (me card hidden), so the assertions below prove the
    // action both navigated and switched the lens back to Me.
    await openUserMenu(page);

    await page.getByTestId('lens-settings').click();

    await expect(page, 'Settings should navigate to /profile/settings').toHaveURL(/\/profile\/settings\b/, { timeout: ELEMENT_TIMEOUT });
    // The Me lens is active iff the sidebar me card becomes visible (showMeSelector === activeLens === 'me').
    await expect(page.getByTestId('me-selector'), 'Settings action should switch the lens to Me').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('S5: Profile & Account action navigates to /profile and activates the Me lens', async ({ page }) => {
    await openUserMenu(page);

    await page.getByTestId('lens-profile').click();

    // /profile redirects to the canonical first tab; asserting it (not a bare /profile match) proves
    // the action reached the Profile shell rather than merely staying on some /profile* URL.
    await expect(page, 'Profile & Account should navigate to the default Profile tab').toHaveURL(PROFILE_DEFAULT_URL, { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('me-selector'), 'Profile action should switch the lens to Me').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });
});

// ─── S6: Profile redesign entry points (#6069) ───────────────────────────────

test.describe('Profile redesign entry points', () => {
  test.beforeEach(async ({ page }) => {
    skipOnMobileViewport(page);
    await suppressCookieBanner(page);
    await pinProfileRedesign(page, true);
  });

  test('S6: the me card splits into Profile and Account & Settings, each active on its own pages', async ({ page }) => {
    await gotoProfileAndWaitForCard(page, '/account/identities');
    const profile = page.getByTestId('me-card-profile-link');
    const account = page.getByTestId('me-card-account-link');

    await expect(page.getByTestId('me-card-link'), 'the single Profile & Account link should be gone').toHaveCount(0);
    await expect(profile).toHaveAttribute('href', '/profile');
    await expect(account).toHaveAttribute('href', '/account');
    await expect(account, 'Account & Settings should be active on an Account & Settings page').toHaveClass(/\bis-active\b/);
    await expect(profile).not.toHaveClass(/\bis-active\b/);

    await account.click();
    await expect(page, 'Account & Settings should open the landing page').toHaveURL(/\/account$/, { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('account-landing')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await profile.click();
    await expect(page).toHaveURL(PROFILE_PAGE_URL, { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('profile-hero')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(profile, 'Profile should be active on the Profile pages').toHaveClass(/\bis-active\b/);
    await expect(account).not.toHaveClass(/\bis-active\b/);
  });

  test('S7: the account menu Settings action opens the Account & Settings landing page', async ({ page }) => {
    await openUserMenu(page);

    await page.getByTestId('lens-settings').click();

    await expect(page, 'Settings should open /account').toHaveURL(/\/account$/, { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('me-selector'), 'Settings action should switch the lens to Me').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });
});
