// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_SOURCES_GROUPS } from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { openBrandKitSources } from './helpers/mktg-os-brand-kit-sources.helper';

const RAIL_TIMEOUT = 10_000;
const GROUP_TESTIDS: Record<(typeof BRAND_KIT_SOURCES_GROUPS)[number], string> = {
  failed: 'brand-kit-web-view-sources-failed',
  missing: 'brand-kit-web-view-missing-assets',
  warnings: 'brand-kit-web-view-warnings',
  conflicts: 'brand-kit-web-view-color-conflicts',
};

test.describe('Brand kit Sources tab structure', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.beforeEach(async ({ page }) => suppressCookieBanner(page));

  for (const width of [1440, 1280, 390]) {
    test(`the four groups and the approved markers fit at ${width}px`, async ({ page, isMobile }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await openBrandKitSources(page, { approval: 'snapshot' });
      if (width === 390 && !isMobile) {
        // The collapsed rail settles before any geometry is read; a touch shell has no rail, only the hamburger.
        await expect(page.getByTestId('main-content')).toHaveCSS('margin-left', '56px', { timeout: RAIL_TIMEOUT });
      }
      const panel = page.getByTestId('brand-kit-web-view-panel-sources');
      const panelBox = await panel.boundingBox();
      expect(panelBox).not.toBeNull();
      for (const group of BRAND_KIT_SOURCES_GROUPS) {
        const list = page.getByTestId(GROUP_TESTIDS[group]);
        await expect(list).toBeVisible();
        const box = await list.boundingBox();
        expect(box).not.toBeNull();
        if (box && panelBox) {
          expect(box.x).toBeGreaterThanOrEqual(panelBox.x - 1);
          expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
        }
      }
      // Every swatch card is filled and the same size as its neighbours.
      const swatches = page.getByTestId(GROUP_TESTIDS.conflicts).getByTestId(/^brand-kit-web-view-swatch-/);
      expect(await swatches.count()).toBeGreaterThan(0);
      const sizes = new Set(
        await swatches.evaluateAll((nodes) => nodes.map((node) => `${node.getBoundingClientRect().width}x${node.getBoundingClientRect().height}`))
      );
      expect(sizes.size).toBe(1);
      await expect(page.getByTestId('brand-kit-web-view-accepted').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`sources-structure-${width}.png`), fullPage: true });
    });

    test(`the empty lines fit at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await openBrandKitSources(page, { report: 'v1' });
      for (const group of ['missing', 'warnings', 'conflicts'] as const) await expect(page.getByTestId(`${GROUP_TESTIDS[group]}-empty`)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`sources-empty-${width}.png`), fullPage: true });
    });
  }
});
