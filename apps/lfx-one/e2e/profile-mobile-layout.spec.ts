// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Profile & Account hub — mobile layout E2E — LFXV2-3285.
 *
 * Regression coverage for the mobile-viewport layout fix: below the `lg` breakpoint the profile
 * rail's wrapper must resolve to a non-`fixed` CSS position (in normal document flow, left-aligned
 * with the content column) instead of a `position: fixed` 300px overlay, and the content column
 * must reclaim the full available width instead of reserving a gutter for a rail that no longer
 * floats there. The pre-fix bug left a 390px viewport with ~50px of usable content width
 * (390 - 300px gutter - 40px page padding).
 *
 * The existing profile specs (profile-edit-drawer.spec.ts, profile-visibility-drawer.spec.ts) pass
 * under the mobile-chrome project today purely because they assert `toBeVisible()` on the panel —
 * the fixed-width rail was technically "visible" even when it starved the content column, and
 * because the content was compressed rather than overflowing, no overflow-based check caught it
 * either. This spec asserts the actual geometry and the underlying CSS mechanism instead.
 *
 * Verified this spec actually discriminates the bug: bounding-box "renders above the subtab nav" /
 * "does not overlap the content column" checks alone do NOT catch the pre-fix layout at a narrow
 * viewport — a fixed rail pinned to the right edge still sits above the nav and, once the content
 * column is squeezed thin enough, its box no longer geometrically overlaps the rail's box either.
 * The content-width assertion and the direct `position !== 'fixed'` / left-alignment checks below
 * are the ones that actually fail against the pre-fix template.
 *
 * Drives an explicit viewport matrix (mirrors e2e/docs/responsive.spec.ts) covering mobile and
 * tablet widths up to just under the `lg` breakpoint, rather than relying on whichever project
 * happens to run it — so the tablet band (768-1023px) is exercised too, not just mobile-chrome's
 * fixed 393px.
 *
 * Prerequisites (mirrors profile-edit-drawer.spec.ts):
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 */

import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const LOAD_TIMEOUT = 20_000;

// The breakpoint at which the page container's own horizontal padding steps up
// (px-5 -> md:px-8, see main-layout.component.html), used to derive the width-slack tolerance.
const MD_BREAKPOINT = 768;

// Sub-lg matrix: narrow phone, the mobile-chrome project's own size (Pixel 5), and both ends of
// the tablet band up to just under the lg breakpoint (1024px) the layout fix keys off.
const VIEWPORTS = [
  { name: 'mobile-narrow', width: 360, height: 640 },
  { name: 'mobile', width: 393, height: 727 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'tablet-lg', width: 1023, height: 768 },
] as const;

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
    await suppressCookieBanner(page);
  });

  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`content column reclaims full width and the panel renders inline @ ${vp.name} (${vp.width}px) ${route}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        skipWhenAuthMissing(page);

        const panel = page.getByTestId('profile-panel');
        const content = page.getByTestId('profile-content');
        const tabs = page.getByTestId('profile-tabs-desktop');

        await expect(panel, 'profile panel should render').toBeVisible({ timeout: LOAD_TIMEOUT });
        await expect(content, 'profile content column should render').toBeVisible({ timeout: LOAD_TIMEOUT });
        await expect(tabs, 'subtab nav should render').toBeVisible({ timeout: LOAD_TIMEOUT });

        // The content column must reclaim (close to) the full viewport width — not be squeezed by an
        // unconditional right gutter reserved for a rail that, below lg, no longer renders as a fixed
        // overlay. Page padding is px-5 (40px total) below md, md:px-8 (64px total) at md and up.
        const pagePadding = vp.width >= MD_BREAKPOINT ? 64 : 40;
        const contentBox = await content.boundingBox();
        expect(contentBox, 'content column should have a bounding box').not.toBeNull();
        expect(contentBox!.width, `content column width at ${vp.width}px viewport`).toBeGreaterThanOrEqual(vp.width - pagePadding - 8);

        // No horizontal page scroll — the classic symptom of a fixed-width element bleeding past the
        // viewport (1px fudge factor mirrors docs/responsive.spec.ts).
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(overflow.scrollWidth, `document scrollWidth at ${vp.width}px`).toBeLessThanOrEqual(overflow.clientWidth + 1);

        // Direct mechanism check: the element two levels up from the `profile-panel` testid (the
        // <aside>) is the wrapper <div> carrying `lg:fixed` in profile-layout.component.html. Below lg
        // it must NOT resolve to position: fixed — this is what actually distinguishes "inline in
        // normal flow" from "fixed overlay pinned to the viewport"; bounding-box comparisons alone
        // don't, since a fixed rail still sits above the nav and (once the content column is squeezed
        // thin enough) may not geometrically overlap it either.
        const wrapperPosition = await panel.evaluate((el) => getComputedStyle(el.parentElement!.parentElement!).position);
        expect(wrapperPosition, `profile panel wrapper position at ${vp.width}px should not be fixed`).not.toBe('fixed');

        // Inline placement: the panel should be left-aligned with the content column (both children of
        // the same padded container) rather than offset toward the right edge like a fixed rail would be.
        const panelBox = await panel.boundingBox();
        expect(panelBox, 'profile panel should have a bounding box').not.toBeNull();
        expect(Math.abs(panelBox!.x - contentBox!.x), `panel should be left-aligned with the content column at ${vp.width}px`).toBeLessThanOrEqual(1);

        // The panel should still render above the subtab nav in the content flow.
        const tabsBox = await tabs.boundingBox();
        expect(tabsBox, 'subtab nav should have a bounding box').not.toBeNull();
        expect(panelBox!.y, 'profile panel should render above the subtab nav').toBeLessThan(tabsBox!.y);

        // The panel should not overlap the content column — a true 2D bounding-box intersection
        // requires overlap on BOTH axes; checking each axis independently would misfire on any two
        // elements that merely share a vertical range while sitting side by side.
        const overlapsHorizontally = panelBox!.x < contentBox!.x + contentBox!.width && panelBox!.x + panelBox!.width > contentBox!.x;
        const overlapsVertically = panelBox!.y < contentBox!.y + contentBox!.height && panelBox!.y + panelBox!.height > contentBox!.y;
        expect(
          overlapsHorizontally && overlapsVertically,
          `profile panel (x:${panelBox!.x},y:${panelBox!.y},w:${panelBox!.width},h:${panelBox!.height}) should not overlap the content column ` +
            `(x:${contentBox!.x},y:${contentBox!.y},w:${contentBox!.width},h:${contentBox!.height}) at ${vp.width}px`
        ).toBe(false);
      });
    }
  }
});
