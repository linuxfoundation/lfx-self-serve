// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The Brand Kit PDF's `data-testid` contract (#5341): the frame contract every portrait page carries, the book's own
 * ids, and each page's named blocks, present whatever the kit says. The content pair is `mktg-os-brand-kit-pdf.spec.ts`.
 */

import { BRAND_KIT_PRINT_BODY_CLASS } from '@lfx-one/shared/constants';
import { expect, Locator, Page, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { columnAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { expectMktgPrintFrame, layoutMktgPrintFrame, stubMktgPrintFrame } from './helpers/mktg-print.helper';

/** The named blocks of each page, by plan id: the contract the content spec and the design check read. */
const PAGE_TESTIDS: Record<string, string[]> = {
  cover: ['mktg-portrait-cover-logo', 'mktg-portrait-cover-title', 'mktg-portrait-cover-lede', 'mktg-portrait-cover-strip'],
  contents: ['brand-kit-contents-list', 'brand-kit-contents-built-from', 'brand-kit-contents-glance', 'brand-kit-contents-version'],
  'logo-system': ['brand-kit-logo-system-intro', 'brand-kit-logo-system-hero', 'brand-kit-logo-system-tiles', 'brand-kit-logo-system-files'],
  'logo-colorways': ['brand-kit-colorways-intro', 'brand-kit-colorways-tiles', 'brand-kit-colorways-rules'],
  'logo-clear-space': ['brand-kit-clear-space-intro', 'brand-kit-clear-space-stage', 'brand-kit-clear-space-cards', 'brand-kit-clear-space-scaling'],
  'logo-partnership': ['brand-kit-partnership-light', 'brand-kit-partnership-dark', 'brand-kit-partnership-rules'],
  'logo-watchouts': ['brand-kit-watchouts-intro', 'brand-kit-watchouts-default', 'brand-kit-watchouts-tiles'],
  'color-palette': ['brand-kit-palette-intro', 'brand-kit-palette-swatches', 'brand-kit-palette-proportion'],
  'color-contrast': ['brand-kit-contrast-intro', 'brand-kit-contrast-matrix', 'brand-kit-contrast-pairs'],
  type: ['brand-kit-type-intro', 'brand-kit-type-specimen', 'brand-kit-type-h1', 'brand-kit-type-scale', 'brand-kit-type-source', 'brand-kit-type-rules'],
  'visual-iconography': [
    'brand-kit-iconography-samples',
    'brand-kit-icon-samples',
    'brand-kit-icon-tiles',
    'brand-kit-icon-strip',
    'brand-kit-iconography-strip-caption',
    'brand-kit-iconography-rules',
    'brand-kit-iconography-set',
    'brand-kit-iconography-sizes',
  ],
  'visual-imagery': [
    'brand-kit-imagery-intro',
    'brand-kit-imagery-ground',
    'brand-kit-imagery-elements',
    'brand-kit-imagery-callout-caption',
    'brand-kit-imagery-avoid',
  ],
  usage: ['brand-kit-usage-intro', 'brand-kit-usage-cards', 'brand-kit-usage-table'],
  voice: ['brand-kit-voice-intro', 'brand-kit-voice-messages', 'brand-kit-voice-attributes'],
  sources: ['brand-kit-sources-intro', 'brand-kit-sources-read'],
  'back-cover': ['mktg-portrait-back-cover-logo', 'mktg-portrait-back-cover-line', 'mktg-portrait-back-cover-url', 'mktg-portrait-back-cover-notice'],
};

async function openBook(page: Page): Promise<Locator> {
  await stubMktgPrintFrame(page);
  await openAssetDocument(page, 'brand-kit', 200, true, false, columnAssetRevisionResponse('brand-kit'));
  await page.getByTestId('brand-kit-web-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, BRAND_KIT_PRINT_BODY_CLASS, 'lfx-mktg-brand-kit-print');
  const frame = await layoutMktgPrintFrame(page);
  const book = frame.getByTestId('mktg-brand-kit-print');
  await expect(book).toBeVisible();
  return book;
}

test.describe('Brand kit PDF: the data-testid contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await suppressCookieBanner(page);
  });

  test('every frame carries the frame contract: lfx-mktg-portrait-page with data-page-id, data-page and data-section, and the head, title, foot and number on the inner pages', async ({
    page,
  }, info) => {
    const book = await openBook(page);
    await expect(book).toHaveAttribute('data-revision', /^V\d+\.\d+$/);
    const pages = book.getByTestId('lfx-mktg-portrait-page');
    await expect(pages).toHaveCount(Object.keys(PAGE_TESTIDS).length);
    for (const frame of await pages.all()) {
      await expect(frame).toHaveAttribute('data-page-id', /^[a-z-]+$/);
      await expect(frame).toHaveAttribute('data-page', /^\d+$/);
      await expect(frame).toHaveAttribute('data-section', /.+/);
    }
    const inner = pages.filter({ hasNot: page.locator('[data-testid^="mktg-portrait-cover-"], [data-testid^="mktg-portrait-back-cover-"]') });
    await expect(inner).toHaveCount(14);
    for (const testid of [
      'mktg-portrait-page-head',
      'mktg-portrait-page-section',
      'mktg-portrait-page-doc',
      'mktg-portrait-page-title',
      'mktg-portrait-page-foot',
      'mktg-portrait-page-number',
    ]) {
      await expect(pages.getByTestId(testid)).toHaveCount(14);
    }
    await expect(pages.first().getByTestId('mktg-portrait-page-head')).toHaveCount(0);
    await expect(pages.last().getByTestId('mktg-portrait-page-foot')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('frame-contract.png'), fullPage: true });
  });

  test('each page has its named blocks, once, inside its own frame', async ({ page }, info) => {
    const book = await openBook(page);
    for (const [id, testids] of Object.entries(PAGE_TESTIDS)) {
      const frame = book.locator(`[data-testid="lfx-mktg-portrait-page"][data-page-id="${id}"]`);
      await expect(frame, id).toHaveCount(1);
      for (const testid of testids) {
        await expect(frame.getByTestId(testid), `${id} › ${testid}`).toHaveCount(1);
        await expect(book.getByTestId(testid), `${testid} on one page only`).toHaveCount(1);
      }
    }
    const last = book.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id="sources"]');
    await last.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('page-blocks.png'), fullPage: false });
  });
});
