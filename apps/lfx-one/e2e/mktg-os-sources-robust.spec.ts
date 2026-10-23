// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { setupFreshSources } from './helpers/mktg-os-sources.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DATA_LOAD_TIMEOUT } from './helpers/mktg-os-assets.helper';

test.describe('Marketing OS Sources structure', () => {
  test.beforeEach(async ({ page }) => suppressCookieBanner(page));
  for (const width of [1440, 1280, 390]) {
    test(`${width}px: Sources stays above live work with no second edit-inputs path`, async ({ page }) => {
      const sources = await setupFreshSources(page);
      await sources.open();
      await expect(page.getByTestId('mktg-run-source-website_url')).toContainText(sources.answers.website_url);
      await page.setViewportSize({ width, height: 900 });
      const start = page.getByTestId('mktg-run-start').getByRole('button');
      await expect(start).toBeEnabled();
      await start.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('mktg-agent-run-live')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      const summary = await page.getByTestId('mktg-run-sources').boundingBox();
      const feed = await page.getByTestId('mktg-agent-run-live').boundingBox();
      expect(summary).not.toBeNull();
      expect(feed).not.toBeNull();
      if (summary && feed) expect(summary.y + summary.height).toBeLessThanOrEqual(feed.y);
      await expect(page.getByRole('button', { name: 'Edit inputs', exact: true })).toHaveCount(0);
      await expect(page.getByTestId('mktg-run-sources-edit')).toHaveCount(0);
      expect(sources.generated).toHaveLength(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`sources-before-feed-${width}.png`), fullPage: true });
    });
  }
});
