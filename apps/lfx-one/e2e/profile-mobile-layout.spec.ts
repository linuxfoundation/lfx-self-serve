// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Profile & Account hub — mobile layout E2E — LFXV2-3285.
 *
 * Regression coverage for the mobile-viewport layout fix: below the `lg` breakpoint the profile
 * rail must render inline in the content column (not as a `position: fixed` 300px overlay), and
 * the content column must reclaim the full available width instead of reserving a gutter for a
 * rail that no longer floats there. The pre-fix bug left a 390px viewport with ~50px of usable
 * content width (390 - 300px gutter - 40px page padding).
 *
 * The existing profile specs (profile-edit-drawer.spec.ts, profile-visibility-drawer.spec.ts) pass
 * under the mobile-chrome project today purely because they assert `toBeVisible()` on the panel —
 * the fixed-width rail was technically "visible" even when it starved the content column, and
 * because the content was compressed rather than overflowing, no overflow-based check caught it
 * either. This spec asserts the actual geometry instead.
 *
 * Runs meaningfully only under the mobile-chrome project (393x727, per playwright.config.ts) — the
 * whole file skips itself at the `lg` breakpoint (1024px) and up, since the layout it covers is
 * identical to the (already-covered) desktop fixed-rail behavior there.
 *
 * Prerequisites (mirrors profile-edit-drawer.spec.ts):
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 */

import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const LOAD_TIMEOUT = 20_000;

const LG_BREAKPOINT = 1024;
// px-5 page padding (40px total) plus slack for mobile chrome — matches the tolerance implied by
// the original bug report (390px viewport - 300px gutter - 40px padding = ~50px of content).
const WIDTH_SLACK = 80;

const ROUTES = ['/profile', '/profile/settings'] as const;

// Hard skip when the auth-bootstrap failed — hostname-exact match so a crafted URL like
// `https://auth0.com.evil.com/` can't fool the gate (mirrors profile-edit-drawer.spec.ts).
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

// This spec only covers the below-lg layout LFXV2-3285 fixed; skip entirely at lg and up rather
// than hard-coding a project name, so it stays correct if the project list changes (mirrors
// skipOnMobileViewport in me-profile-nav.spec.ts, inverted).
function skipAtOrAboveLgViewport(page: Page): void {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= LG_BREAKPOINT) {
    test.skip(true, 'Mobile/tablet-only layout regression coverage — see playwright.config.ts mobile-chrome project');
  }
}

// Neutralize the Osano consent overlay, which otherwise intercepts pointer events and can affect
// layout measurements. Registered via addInitScript so it applies before page scripts run (mirrors
// profile-edit-drawer.spec.ts / me-profile-nav.spec.ts).
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

test.describe('Profile & Account hub — mobile layout (LFXV2-3285)', () => {
  test.beforeEach(async ({ page }) => {
    skipAtOrAboveLgViewport(page);
    await suppressCookieBanner(page);
  });

  for (const route of ROUTES) {
    test(`content column reclaims full width and the panel renders inline @ ${route}`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      const panel = page.getByTestId('profile-panel');
      const content = page.getByTestId('profile-content');
      const tabs = page.getByTestId('profile-tabs-desktop');

      await expect(panel, 'profile panel should render').toBeVisible({ timeout: LOAD_TIMEOUT });
      await expect(content, 'profile content column should render').toBeVisible({ timeout: LOAD_TIMEOUT });
      await expect(tabs, 'subtab nav should render').toBeVisible({ timeout: LOAD_TIMEOUT });

      const viewport = page.viewportSize();
      if (!viewport) {
        throw new Error('viewport size unavailable');
      }

      // The content column must reclaim (close to) the full viewport width — not be squeezed by an
      // unconditional right gutter reserved for a rail that, below lg, no longer renders as a fixed
      // overlay.
      const contentBox = await content.boundingBox();
      expect(contentBox, 'content column should have a bounding box').not.toBeNull();
      expect(contentBox!.width, `content column width at ${viewport.width}px viewport`).toBeGreaterThanOrEqual(viewport.width - WIDTH_SLACK);

      // No horizontal page scroll — the classic symptom of a fixed-width element bleeding past the
      // viewport (1px fudge factor mirrors docs/responsive.spec.ts).
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `document scrollWidth at ${viewport.width}px`).toBeLessThanOrEqual(overflow.clientWidth + 1);

      // The panel must render above the subtab nav, proving it's inline in normal flow rather than
      // a `position: fixed` overlay pinned to the right edge (the pre-fix behavior at every width).
      const panelBox = await panel.boundingBox();
      const tabsBox = await tabs.boundingBox();
      expect(panelBox, 'profile panel should have a bounding box').not.toBeNull();
      expect(tabsBox, 'subtab nav should have a bounding box').not.toBeNull();
      expect(panelBox!.y, 'profile panel should render above the subtab nav').toBeLessThan(tabsBox!.y);

      // The panel must not overlap the content column — if it did, it would still be acting as a
      // fixed overlay laid on top of the page rather than a participant in normal flow.
      const overlapsHorizontally = panelBox!.x < contentBox!.x + contentBox!.width && panelBox!.x + panelBox!.width > contentBox!.x;
      const overlapsVertically = panelBox!.y < contentBox!.y + contentBox!.height && panelBox!.y + panelBox!.height > contentBox!.y;
      expect(overlapsHorizontally && overlapsVertically, 'profile panel should not overlap the content column').toBe(false);
    });
  }
});
