// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { openFamilyExports } from './helpers/mktg-os-family-export.helper';

test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ page }) => suppressCookieBanner(page));
for (const width of [1440, 1280, 390]) {
  test(`Family export structure at ${width}px`, async ({ page }, info) => {
    await openFamilyExports(page, { existing: true, stale: true });
    await page.setViewportSize({ width, height: 1000 });
    const slot = page.getByTestId('family-export-actions');
    await expect(slot).toBeVisible();
    await expect(page.locator('lfx-mktg-family-export-actions')).toHaveAttribute('data-family-id', 'positioning-brand');
    for (const action of ['pdf', 'slides']) {
      await expect(slot.getByTestId(`family-export-${action}`)).toHaveCount(1);
      await expect(slot.getByTestId(`family-export-${action}`).getByRole('button')).toBeEnabled();
    }
    await expect(slot.locator('[aria-live="polite"]')).toHaveCount(1);
    await expect(page.getByTestId('family-export-print-document')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const assets = await page.getByTestId('mktg-family-assets').boundingBox();
    const exports = await page.getByTestId('mktg-family-exports').boundingBox();
    expect(assets).not.toBeNull();
    expect(exports).not.toBeNull();
    if (assets && exports) {
      if (width === 390) expect(exports.y).toBeGreaterThanOrEqual(assets.y + assets.height);
      else expect(exports.x).toBeGreaterThanOrEqual(assets.x + assets.width);
    }
    await page.screenshot({ path: info.outputPath(`family-exports-${width}.png`), fullPage: true });
  });
}
