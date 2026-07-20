// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Me-lens Profile Navigation E2E — LFXV2-2741.
 *
 * Covers the redesigned Me-lens profile entry points added in PR #1136:
 *   1. Sidebar "me card" — a stretched-link card whose body navigates to /profile,
 *      plus a ⋯ overflow trigger that opens a popover of the five PROFILE_TABS links.
 *      Each tab link must navigate to its own route WITHOUT the stretched card's
 *      /profile link winning (the layered pointer-events contract).
 *   2. Dock avatar user menu — the "Settings" action (→ /profile/settings) and the
 *      "Profile & Account" action (→ /profile), each of which also activates the Me lens.
 *
 * Both surfaces are desktop-shell affordances; the mobile shell exposes separate
 * lens-mobile-* entries, so these specs skip on the narrow (mobile) viewport.
 *
 * The Me lens is the default (DEFAULT_LENS = 'me'), so a fresh context landing on a
 * /profile route renders the me card. "Me lens active" is asserted via that card's
 * presence, since showMeSelector() === (activeLens() === 'me') — the desktop lens rail
 * buttons are hidden by every current caller and expose no active-state hook.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 */

import { expect, Page, test } from '@playwright/test';

// ─── Timeouts ───────────────────────────────────────────────────────────────
test.setTimeout(60_000);

const SIDEBAR_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

// ─── Test data ────────────────────────────────────────────────────────────────
// PROFILE_TABS render order + testid (`me-card-tab-<id>`) → destination route.
// Mirrors packages/shared/src/constants/profile.constants.ts (note id `attribution` → route `attributions`).
const PROFILE_TAB_IDS = ['attribution', 'identities', 'individual-enrollment', 'transactions', 'settings'];

const PROFILE_TABS: { id: string; route: string }[] = [
  { id: 'attribution', route: 'attributions' },
  { id: 'identities', route: 'identities' },
  { id: 'individual-enrollment', route: 'individual-enrollment' },
  { id: 'transactions', route: 'transactions' },
  { id: 'settings', route: 'settings' },
];

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

// The me card and dock user menu are desktop-shell affordances; the mobile shell exposes
// separate lens-mobile-* entries. Skip on the narrow (mobile-chrome) viewport rather than
// hard-coding a project name, which keeps the gate correct if the project list changes.
function skipOnMobileViewport(page: Page): void {
  const viewport = page.viewportSize();
  if (viewport && viewport.width < 768) {
    test.skip(true, 'Desktop-only profile affordance — mobile uses the lens-mobile-* entries');
  }
}

/**
 * Neutralize the Osano cookie-consent overlay. global-setup clears cookies, so the banner
 * (.osano-cm-window) reappears in each fresh context and its bottom bar intercepts pointer events on
 * the popover items these tests click. Registered via addInitScript so it runs on every navigation
 * before page scripts — deterministic, unlike racing the banner's entrance animation to click Accept.
 * The dialog is irrelevant to these navigation flows, so hiding it is sufficient.
 */
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

/** Open the me-card ⋯ overflow popover and wait for the tab links to render. */
async function openProfileTabsPopover(page: Page): Promise<void> {
  await openPopover(page, 'me-card-more', 'me-card-tab-settings');
}

/** Open the dock avatar user menu and wait for its actions to render. */
async function openUserMenu(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await openPopover(page, 'lens-user-avatar', 'lens-settings');
}

// ─── S1: Sidebar me-lens profile card ─────────────────────────────────────────

test.describe('Me-lens profile card', () => {
  test.beforeEach(async ({ page }) => {
    skipOnMobileViewport(page);
    await suppressCookieBanner(page);
  });

  test('S1: card body navigates to /profile (stretched link)', async ({ page }) => {
    await gotoProfileAndWaitForCard(page, '/profile');

    await page.getByTestId('me-card-link').click();

    // /profile redirects to the first tab (attributions); assert we land in the Profile shell.
    await expect(page, 'me-card body should navigate into the Profile shell').toHaveURL(/\/profile\b/, { timeout: ELEMENT_TIMEOUT });
  });

  test('S2: the ⋯ overflow opens the five profile tabs, in order, each linking to its route', async ({ page }) => {
    await gotoProfileAndWaitForCard(page, '/profile');
    await openProfileTabsPopover(page);

    for (const id of PROFILE_TAB_IDS) {
      await expect(page.getByTestId(`me-card-tab-${id}`), `tab ${id} should be visible`).toBeVisible();
    }

    // Assert render order matches the PROFILE_TABS constant, not just presence.
    const renderedOrder = await page
      .locator('[data-testid^="me-card-tab-"]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-testid')?.replace('me-card-tab-', '')));
    expect(renderedOrder).toEqual(PROFILE_TAB_IDS);

    // Each tab links to its own /profile/<route> — the routing contract for all five, without the
    // flaky per-tab re-open/click loop (one representative navigation is asserted in S3).
    for (const tab of PROFILE_TABS) {
      await expect(page.getByTestId(`me-card-tab-${tab.id}`), `tab ${tab.id} should link to /profile/${tab.route}`).toHaveAttribute(
        'href',
        new RegExp(`/profile/${tab.route}$`)
      );
    }
  });

  test('S3: clicking a tab link navigates to its route, not the stretched card', async ({ page }) => {
    await gotoProfileAndWaitForCard(page, '/profile');
    await openProfileTabsPopover(page);

    // Settings resolves to /profile/settings, distinct from the card's /profile (→ /profile/attributions),
    // so landing there proves the popover link won over the underlying stretched-link anchor.
    await page.getByTestId('me-card-tab-settings').click();

    await expect(page, 'the Settings tab should navigate to /profile/settings').toHaveURL(/\/profile\/settings\b/, { timeout: ELEMENT_TIMEOUT });
  });
});

// ─── S4: Dock avatar user menu ────────────────────────────────────────────────

test.describe('Dock avatar user menu', () => {
  test.beforeEach(async ({ page }) => {
    skipOnMobileViewport(page);
    await suppressCookieBanner(page);
  });

  test('S4: Settings action navigates to /profile/settings and activates the Me lens', async ({ page }) => {
    await openUserMenu(page);

    await page.getByTestId('lens-settings').click();

    await expect(page, 'dock Settings should navigate to /profile/settings').toHaveURL(/\/profile\/settings\b/, { timeout: ELEMENT_TIMEOUT });
    // The Me lens is active iff the sidebar me card renders (showMeSelector === activeLens === 'me').
    await expect(page.getByTestId('me-selector'), 'Me lens should be active after the Settings action').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('S5: Profile & Account action navigates to /profile', async ({ page }) => {
    await openUserMenu(page);

    await page.getByTestId('lens-profile').click();

    await expect(page, 'dock Profile & Account should navigate into the Profile shell').toHaveURL(/\/profile\b/, { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('me-selector'), 'Me lens should be active after the Profile action').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });
});
