// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { setupFreshSources } from './helpers/mktg-os-sources.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DATA_LOAD_TIMEOUT } from './helpers/mktg-os-assets.helper';

test.describe('Marketing OS Sources structure', () => {
  test.beforeEach(async ({ page }) => suppressCookieBanner(page));
  for (const width of [1440, 1280, 390]) {
    test(`${width}px: Sources belongs to the form with no second edit-inputs path during live work`, async ({ page }) => {
      const sources = await setupFreshSources(page);
      await sources.open();
      await expect(page.getByTestId('mktg-run-source-website_url')).toContainText(sources.answers.website_url);
      await page.setViewportSize({ width, height: 900 });
      if (width === 390) {
        // #4443: wait for the non-touch shell's rail transition, not the pre-resize desktop gutter.
        await expect(page.getByTestId('main-content')).toHaveCSS('margin-left', '56px');
      }
      const start = page.getByTestId('mktg-run-start').getByRole('button');
      await expect(start).toBeEnabled();
      await expect(page.getByTestId('mktg-run-sources')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await start.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('mktg-agent-run-live')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('mktg-run-sources')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Edit inputs', exact: true })).toHaveCount(0);
      await expect(page.getByTestId('mktg-run-sources-edit')).toHaveCount(0);
      expect(sources.generated).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`sources-before-feed-${width}.png`), fullPage: true });
    });
  }
});
