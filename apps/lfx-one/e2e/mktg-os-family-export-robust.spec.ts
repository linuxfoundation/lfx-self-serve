// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { openFamilyExports } from './helpers/mktg-os-family-export.helper';
import { expectMktgPrintFrame, finishMktgPrintFrame, layoutMktgPrintFrame, PRINT_FRAME_LANDSCAPE, stubMktgPrintFrame } from './helpers/mktg-print.helper';
import { MKTG_FAMILY_PRINT_BODY_CLASS } from '../../../packages/shared/src/constants';

test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ page }) => suppressCookieBanner(page));
for (const width of [1440, 1280, 390]) {
  test(`Family export structure at ${width}px`, async ({ page }, info) => {
    await openFamilyExports(page, { existing: true, stale: true });
    await page.setViewportSize({ width, height: 1000 });
    if (width === 390) {
      // #4443: wait for the non-touch shell's rail transition, not the pre-resize desktop gutter.
      await expect(page.getByTestId('main-content')).toHaveCSS('margin-left', '56px');
    }
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

test('Family PDF structure: the landscape pages carry their data-testid contract', async ({ page }, info) => {
  await stubMktgPrintFrame(page);
  await openFamilyExports(page, { allAssets: true });
  await page.getByTestId('family-export-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, MKTG_FAMILY_PRINT_BODY_CLASS, '[data-testid="family-export-print-document"]');
  const printFrame = await layoutMktgPrintFrame(page, PRINT_FRAME_LANDSCAPE);
  const printDocument = printFrame.getByTestId('family-export-print-document');
  // The cover, two dividers, one page each of cards and of the grid, and the back cover: six landscape frames, each a page.
  await expect(printDocument.getByTestId('mktg-print-page')).toHaveCount(6);
  await expect(printDocument.getByTestId('mktg-print-page-slide')).toHaveCount(6);
  await expect(printDocument.getByTestId('mktg-print-page-area')).toHaveCount(6);
  await expect(printDocument.getByTestId('mktg-print-page-title')).toHaveCount(6);
  // The cover: the mounted generic cover, its five elements (the eyebrow, the month, the footer pair, the lockup) and the subtitle.
  const cover = printDocument.getByTestId('family-export-print-cover');
  await expect(cover.getByTestId('mktg-print-cover')).toHaveCount(1);
  await expect(cover.getByTestId('mktg-print-page-subtitle')).toHaveCount(1);
  await expect(cover.getByTestId('mktg-print-page-el')).toHaveCount(5);
  // The dividers: four elements each (the eyebrow, the title, the count line, the lockup).
  await expect(printDocument.getByTestId('mktg-print-divider')).toHaveCount(2);
  await expect(printDocument.getByTestId('mktg-print-divider').getByTestId('mktg-print-page-el')).toHaveCount(8);
  await expect(printDocument.getByTestId('mktg-boilerplates-print-page')).toHaveCount(1);
  await expect(printDocument.getByTestId('mktg-boilerplates-print-grid')).toHaveCount(1);
  await expect(printDocument.getByTestId('mktg-boilerplates-print-card')).toHaveCount(4);
  await expect(printDocument.getByTestId('mktg-boilerplates-print-card-head')).toHaveCount(4);
  await expect(printDocument.getByTestId('mktg-boilerplates-print-card-body')).toHaveCount(4);
  await expect(printDocument.getByTestId('mktg-faq-print-page')).toHaveCount(1);
  await expect(printDocument.getByTestId('mktg-faq-print-grid')).toHaveCount(1);
  await expect(printDocument.getByTestId('mktg-faq-print-pair')).toHaveCount(4);
  await expect(printDocument.getByTestId('mktg-faq-print-answer')).toHaveCount(3);
  await expect(printDocument.getByTestId('mktg-faq-print-source')).toHaveCount(3);
  // The content pages' chrome: two head lines, two footer boxes and a logo on each of the two; the covers and dividers carry none.
  await expect(printDocument.getByTestId('mktg-print-page-head')).toHaveCount(4);
  await expect(printDocument.getByTestId('mktg-print-page-footer')).toHaveCount(4);
  await expect(printDocument.getByTestId('mktg-print-page-logo')).toHaveCount(2);
  // The back cover: the mounted generic back cover, its host and notice lines.
  const back = printDocument.getByTestId('family-export-print-back-cover');
  await expect(back.getByTestId('mktg-print-page')).toHaveCount(1);
  await expect(back.getByTestId('mktg-print-page-el')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('family-pdf-structure.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});
