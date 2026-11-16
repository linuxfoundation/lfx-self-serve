// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { DATA_LOAD_TIMEOUT } from './helpers/mktg-os-assets.helper';
import { openDraftAssetRun } from './helpers/mktg-os-asset-views.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

test.afterEach(async ({ page }) => {
  await expect(page).not.toHaveURL(/auth0\.com/);
});

for (const width of [1440, 768, 390]) {
  test(`generating and ready asset remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await suppressCookieBanner(page);
    const fixture = await openDraftAssetRun(page);
    await expect(page.getByTestId('mktg-agent-run-status')).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('mktg-run-activity-title')).toContainText('Writing', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-page')).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/documents\//);
    fixture.finish();
    await expect(page).toHaveURL(new RegExp('revision=' + fixture.revisionId), { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-framework')).toBeVisible();
    const live = page.getByTestId('mktg-document-view-live-state');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveAttribute('aria-atomic', 'true');
    await expect(live).toContainText('Ready');
    await expect(page.getByTestId('mktg-document-view-run')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-run-again')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`asset-${width}.png`), fullPage: true });
  });
}
