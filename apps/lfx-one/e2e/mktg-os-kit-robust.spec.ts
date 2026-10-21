// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_KIT_FILTERS } from '@lfx-one/shared/constants';
import { expect } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { kitTest as test, openKit, setupKit } from './helpers/mktg-kit.helper';

test.describe('Marketing kit responsive structure', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test('captures every filter state at 1440px for the design check', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await setupKit(page, { loaded: true });
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(9);
    for (const filter of MKTG_KIT_FILTERS) {
      const pill = page.getByTestId(`filter-pill-${filter.id}`);
      await pill.click();
      await expect(pill).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(9);
      const path = testInfo.outputPath(`kit-filter-${filter.id}-1440.png`);
      await page.screenshot({ path, fullPage: true });
      await testInfo.attach(`Kit ${filter.label} at 1440px`, { path, contentType: 'image/png' });
    }
  });
  for (const width of [1440, 1280, 390]) {
    test(`kit structure at ${width}px retains nine cards and usable tabs`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await setupKit(page, { loaded: true });
      await openKit(page);
      await expect(page.getByTestId('mktg-kit-title')).toBeVisible();
      const title = await page.getByTestId('mktg-kit-title-block').boundingBox();
      const tiles = await page.getByTestId('mktg-kit-summary').boundingBox();
      expect(title).not.toBeNull();
      expect(tiles).not.toBeNull();
      if (title && tiles) {
        if (width >= 1280) expect(tiles.x).toBeGreaterThanOrEqual(title.x + title.width);
        else expect(tiles.y).toBeGreaterThanOrEqual(title.y + title.height);
      }
      await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(9);
      await expect(page.getByTestId('mktg-kit-tab-kit')).toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId('mktg-kit-tabs').getByRole('link')).toHaveCount(5);
      const overflowing = await page.getByTestId('mktg-kit-page').evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      expect(overflowing).toBe(false);
      await expect(page.getByTestId('filter-pill-all')).toHaveAttribute('aria-pressed', 'true');
    });
  }
});
