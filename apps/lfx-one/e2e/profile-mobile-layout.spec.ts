// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Profile & Account hub — mobile/tablet/laptop layout E2E — LFXV2-3285.
 *
 * Regression coverage for the profile-hub layout fix: below the `2xl` breakpoint (1440px) the
 * profile rail's wrapper must resolve to a non-`fixed` CSS position (in normal document flow,
 * left-aligned with the content column) instead of a `position: fixed` 300px overlay, and the
 * content column must reclaim the available width instead of reserving a gutter for a rail that no
 * longer floats there. The pre-fix bug left a 390px viewport with ~50px of usable content width
 * (390 - 300px gutter - 40px page padding).
 *
 * The breakpoint moved from `lg` (1024px) to `2xl` (1440px) in a LFXV2-3285 follow-up: the hub
 * spends 712px on fixed chrome before any content — 348px left sidebar (lg:ml-[348px] on <main>,
 * unrelated and unchanged by this follow-up) + 300px rail + 64px page padding (md:px-8). At `lg`
 * that left a 312px content column, narrower than the rail beside it; at `2xl` it leaves 728px.
 * Keeping the inline card until `2xl` also covers iPad landscape and split-screen laptop windows.
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
 * Drives an explicit viewport matrix (mirrors e2e/docs/responsive.spec.ts) covering mobile, tablet,
 * and laptop widths up to just under the `2xl` breakpoint, rather than relying on whichever project
 * happens to run it — so the tablet-landscape/laptop-split/desktop-narrow bands are exercised too,
 * not just mobile-chrome's fixed 393px. This spec runs under all three playwright.config.ts projects
 * (chromium, firefox, mobile-chrome — none scope out e2e/**); because the matrix forces its own
 * viewport per test, the desktop projects exercise the sub-2xl bands too, so width comparisons read
 * document.documentElement.clientWidth rather than the device viewport width, since desktop
 * projects render a classic scrollbar that mobile-emulated overlay scrollbars don't.
 *
 * The content-width expectation has to account for two more things once the viewport crosses `lg`
 * (1024px, the *sidebar's own*, unrelated breakpoint): the 348px left sidebar starts reserving space
 * via <main>'s lg:ml-[348px], and the content column itself is capped at max-w-[1024px] on the inner
 * wrapper in profile-layout.component.html, so it stops growing well before `2xl`.
 *
 * A separate desktop-control test above 2xl (TWO_XL_BREAKPOINT + 40, not exactly 1440px — see the
 * DESKTOP_VIEWPORT comment for why) asserts the OPPOSITE of the main matrix — the rail wrapper IS
 * `position: fixed` and IS 300px wide — as a regression guard for the rail disappearing entirely
 * if the breakpoint or its classes ever get dropped instead of moved.
 *
 * The rail wrapper carries its own `profile-panel-rail` testid (added alongside the original spec)
 * specifically so the CSS-position mechanism check below doesn't rely on a DOM-position hop off
 * `profile-panel` that would silently break if a wrapper element is ever inserted between them.
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

// The sidebar's own breakpoint (unrelated to the profile-rail breakpoint this follow-up moves) —
// <main> picks up lg:ml-[348px] here, which the content-width expectation below must account for.
const LG_BREAKPOINT = 1024;
const SIDEBAR_WIDTH = 348;

// The profile-panel-rail breakpoint this follow-up moves from lg (1024px) to 2xl (1440px, per
// apps/lfx-one/tailwind.config.js). Below this, the rail renders inline; at and above it, fixed.
const TWO_XL_BREAKPOINT = 1440;

// max-w-[1024px] on the inner content wrapper in profile-layout.component.html — the content
// column stops growing here even once the sidebar's 348px and the page padding are accounted for.
const CONTENT_MAX = 1024;

// Sub-2xl matrix: narrow phone, the mobile-chrome project's own size (Pixel 5), the tablet band,
// iPad landscape, a split-screen laptop window, and just under the 2xl breakpoint itself — every
// band the inline-card layout now needs to hold up across.
const VIEWPORTS = [
  { name: 'mobile-narrow', width: 360, height: 640 },
  { name: 'mobile', width: 393, height: 727 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'tablet-lg', width: 1023, height: 768 },
  { name: 'tablet-landscape', width: 1194, height: 834 },
  { name: 'laptop-split', width: 1280, height: 800 },
  { name: 'desktop-narrow', width: 1439, height: 900 },
] as const;

// Desktop control: at and above 2xl, the rail must be the fixed overlay again — the regression
// guard for the rail disappearing entirely rather than just moving breakpoints. Requested a margin
// above TWO_XL_BREAKPOINT (not exactly 1440) — desktop projects (chromium/firefox) render a classic
// scrollbar, and CSS min-width media queries evaluate against the layout viewport (clientWidth),
// which that scrollbar shrinks below the requested device width. Right at 1440 that can drop below
// the breakpoint and make the 2xl: styles never apply. The test also asserts this precondition
// explicitly below rather than assuming the margin is always enough.
const DESKTOP_VIEWPORT = { name: 'desktop-2xl', width: TWO_XL_BREAKPOINT + 40, height: 900 } as const;

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

test.describe('Profile & Account hub — mobile/tablet/laptop layout (LFXV2-3285)', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });

  for (const vp of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`content column reclaims available width and the panel renders inline @ ${vp.name} (${vp.width}px) ${route}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        skipWhenAuthMissing(page);

        const panel = page.getByTestId('profile-panel');
        const panelRail = page.getByTestId('profile-panel-rail');
        const content = page.getByTestId('profile-content');
        const tabs = page.getByTestId('profile-tabs-desktop');

        await expect(panel, 'profile panel should render').toBeVisible({ timeout: LOAD_TIMEOUT });
        await expect(content, 'profile content column should render').toBeVisible({ timeout: LOAD_TIMEOUT });
        await expect(tabs, 'subtab nav should render').toBeVisible({ timeout: LOAD_TIMEOUT });

        // Read the layout viewport (clientWidth), not the device viewport (vp.width) — desktop
        // projects (chromium/firefox) render a classic ~15px scrollbar that a mobile-emulated overlay
        // scrollbar doesn't, so comparing against vp.width directly is scrollbar-blind and would false-
        // fail there. No horizontal page scroll either (1px fudge factor mirrors docs/responsive.spec.ts).
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(overflow.scrollWidth, `document scrollWidth at ${vp.width}px`).toBeLessThanOrEqual(overflow.clientWidth + 1);

        // The content column must reclaim (close to) the available layout width — not be squeezed by
        // an unconditional right gutter reserved for a rail that, below 2xl, no longer renders as a
        // fixed overlay. Page padding is px-5 (40px total) below md, md:px-8 (64px total) at md and up.
        // Once the viewport crosses lg (the sidebar's own, unrelated breakpoint), the 348px sidebar
        // also reserves space, and the content column stops growing past max-w-[1024px] regardless.
        // Both breakpoint checks key off clientWidth, not vp.width — the media queries the app
        // actually evaluates run against the layout viewport, which a classic desktop scrollbar
        // shrinks below the requested device width (same reasoning as the scrollWidth check above).
        const pagePadding = overflow.clientWidth >= MD_BREAKPOINT ? 64 : 40;
        const sidebar = overflow.clientWidth >= LG_BREAKPOINT ? SIDEBAR_WIDTH : 0;
        const expectedContentWidth = Math.min(CONTENT_MAX, overflow.clientWidth - sidebar - pagePadding);
        const contentBox = await content.boundingBox();
        expect(contentBox, 'content column should have a bounding box').not.toBeNull();
        expect(contentBox!.width, `content column width at ${vp.width}px viewport`).toBeGreaterThanOrEqual(expectedContentWidth - 8);

        // Direct mechanism check on the dedicated profile-panel-rail testid (not a DOM-position hop
        // off profile-panel, which would silently start reading the wrong ancestor and pass vacuously
        // if a wrapper element is ever inserted between them): below 2xl it must NOT resolve to
        // position: fixed — this is what actually distinguishes "inline in normal flow" from "fixed
        // overlay pinned to the viewport"; bounding-box comparisons alone don't, since a fixed rail
        // still sits above the nav and (once the content column is squeezed thin enough) may not
        // geometrically overlap it either.
        await expect(panelRail, 'profile panel rail wrapper should render').toBeVisible({ timeout: LOAD_TIMEOUT });
        const wrapperPosition = await panelRail.evaluate((el) => getComputedStyle(el).position);
        expect(wrapperPosition, `profile panel rail position at ${vp.width}px should not be fixed`).not.toBe('fixed');

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

  for (const route of ROUTES) {
    test(`desktop control: rail is a fixed 300px overlay at 2xl and up @ ${DESKTOP_VIEWPORT.name} (${DESKTOP_VIEWPORT.width}px) ${route}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: DESKTOP_VIEWPORT.width, height: DESKTOP_VIEWPORT.height });
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      const panelRail = page.getByTestId('profile-panel-rail');
      await expect(panelRail, 'profile panel rail wrapper should render').toBeVisible({ timeout: LOAD_TIMEOUT });

      // Precondition: confirm the layout viewport actually cleared the 2xl breakpoint before
      // asserting on it — a classic desktop scrollbar can shrink clientWidth below the requested
      // device width, and DESKTOP_VIEWPORT's margin over TWO_XL_BREAKPOINT is only a heuristic.
      // Failing loudly here beats a confusing "position should be fixed but got static" failure
      // that actually means the viewport never cleared the breakpoint at all.
      const layoutWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(layoutWidth, 'layout viewport must clear the 2xl breakpoint for this control to be meaningful').toBeGreaterThanOrEqual(TWO_XL_BREAKPOINT);

      // Regression guard for the rail disappearing entirely (as opposed to the breakpoint just
      // moving) — the opposite assertion from the main matrix above.
      const wrapperPosition = await panelRail.evaluate((el) => getComputedStyle(el).position);
      expect(wrapperPosition, `profile panel rail position at ${DESKTOP_VIEWPORT.width}px should be fixed`).toBe('fixed');

      const railBox = await panelRail.boundingBox();
      expect(railBox, 'profile panel rail should have a bounding box').not.toBeNull();
      expect(Math.abs(railBox!.width - 300), `profile panel rail width at ${DESKTOP_VIEWPORT.width}px should be 300px`).toBeLessThanOrEqual(1);
    });
  }
});
