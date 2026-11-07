// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { expectFamilyBookFrames, openFamilyExports } from './helpers/mktg-os-family-export.helper';
import { finishMktgPrintFrame, layoutMktgPrintFrame, stubMktgPrintFrame } from './helpers/mktg-print.helper';

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

test('Family PDF book structure: the portrait grammar’s frames with the family’s testid contract', async ({ page }, info) => {
  await stubMktgPrintFrame(page);
  const controls = await openFamilyExports(page, { allAssets: true, holdPrint: true });
  controls.releasePrint();
  const pdf = page.getByTestId('family-export-pdf').getByRole('button');
  await expect(pdf).toBeEnabled();
  await pdf.click();
  const printFrame = await layoutMktgPrintFrame(page);
  const book = printFrame.getByTestId('family-print-book');
  await expect(book).toHaveCount(1);
  const frames = await expectFamilyBookFrames(book);
  // The family's own pages carry their testids inside the grammar's frames.
  for (const testId of ['family-print-cover-title', 'family-print-cover-logo', 'family-print-cover-documents', 'family-print-cover-strip']) {
    await expect(frames.byId('cover').getByTestId(testId)).toHaveCount(1);
  }
  await expect(frames.byId('cover').getByTestId('family-print-cover-tagline')).toHaveCount(1);
  for (const testId of ['family-print-contents-intro', 'family-print-contents-sources']) {
    await expect(frames.byId('contents').getByTestId(testId)).toHaveCount(1);
  }
  await expect(frames.byId('contents').getByTestId('family-print-contents-chapter')).toHaveCount(4);
  await expect(frames.byId('contents').getByTestId('family-print-contents-opener-page')).toHaveCount(4);
  await expect(frames.byId('contents').getByTestId('family-print-contents-entry')).toHaveCount(frames.total - 8);
  await expect(book.locator('lfx-mktg-portrait-opener [data-testid="mktg-portrait-opener-number"]')).toHaveText(['01', '02', '03', '04']);
  await expect(frames.byId('boilerplates').getByTestId('family-print-boilerplate-cards')).toHaveCount(1);
  await expect(frames.byId('boilerplates').getByTestId('family-print-boilerplate-card')).toHaveCount(4);
  await expect(frames.byId('faq-1').getByTestId('family-print-faq-grid')).toHaveCount(1);
  await expect(frames.byId('faq-1').getByTestId('family-print-faq-grid').locator('> *')).toHaveCount(2);
  await expect(frames.byId('faq-1').getByTestId('family-print-faq-group')).toHaveCount(2);
  await expect(frames.byId('sources').getByTestId('family-print-sources-table')).toHaveCount(1);
  await expect(frames.byId('sources').getByTestId('family-print-sources-row')).toHaveCount(4);
  await expect(frames.byId('sources').getByTestId('family-print-sources-open')).toHaveCount(1);
  await expect(frames.byId('sources').getByTestId('family-print-sources-conflicts')).toHaveCount(0);
  // Every content frame has the grammar's head, title and numbered footer; the cover, openers and back cover none.
  const bare = ['cover', 'back-cover', ...frames.openers.map((opener) => opener.id)];
  const pages = book.locator('[data-testid="lfx-mktg-portrait-page"]');
  for (const [index, frame] of frames.frames.entries()) {
    const count = bare.includes(frame.id) ? 0 : 1;
    await expect(pages.nth(index).getByTestId('mktg-portrait-page-head')).toHaveCount(count);
    await expect(pages.nth(index).getByTestId('mktg-portrait-page-number')).toHaveCount(count);
  }
  await page.screenshot({ path: info.outputPath('family-book-structure.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});
