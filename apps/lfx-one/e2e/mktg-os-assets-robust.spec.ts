// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { ASSET_PROJECT, DATA_LOAD_TIMEOUT, setupAsset } from './helpers/mktg-os-assets.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

test.afterEach(async ({ page }) => {
  await expect(page).not.toHaveURL(/auth0\.com/);
});

for (const width of [1440, 768, 390]) {
  test(`generating and ready asset remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await suppressCookieBanner(page);
    const fixture = await setupAsset(page);
    await fixture.open();
    const live = page.getByTestId('mktg-document-view-live-state');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveAttribute('aria-atomic', 'true');
    await expect(page.getByTestId('mktg-document-view-run')).toBeVisible();
    fixture.finish();
    await expect(page.getByTestId('mktg-document-view-framework')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(live).toContainText('ready');
    await expect(page.getByTestId('mktg-document-view-run-again')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`asset-${width}.png`), fullPage: true });
  });
}
