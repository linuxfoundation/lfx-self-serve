// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  BRAND_KIT_BOOK_PAGES,
  BRAND_KIT_ICON_SAMPLES,
  BRAND_KIT_PRINT_BODY_CLASS,
  MKTG_PRINT_LANDSCAPE_CLASS,
  MKTG_PRINT_PAGE_FRAME_PT,
} from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';
import { columnAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { expectMktgPrintFrame, layoutMktgPrintFrame, PRINT_FRAME_LANDSCAPE, stubMktgPrintFrame } from './helpers/mktg-print.helper';

/** The content pages: the contents page and BRAND_KIT_BOOK_PAGES without the back cover. */
const CONTENT_PAGE_COUNT = 1 + BRAND_KIT_BOOK_PAGES.filter((entry) => entry.id !== 'back-cover').length;

test.describe('Brand kit PDF structure', () => {
  test('the data-testid contract: the root with its page count, one cover, the content pages, one back cover, each a landscape page frame of the shell', async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await stubMktgPrintFrame(page);
    await openAssetDocument(page, 'brand-kit', 200, true, false, columnAssetRevisionResponse('brand-kit'));
    await page.getByTestId('brand-kit-web-view-download-pdf').getByRole('button').click();
    await expectMktgPrintFrame(page, BRAND_KIT_PRINT_BODY_CLASS, 'lfx-mktg-brand-kit-print');
    const frame = await layoutMktgPrintFrame(page, PRINT_FRAME_LANDSCAPE);
    const print = frame.getByTestId('mktg-brand-kit-print');
    await expect(print).toBeVisible();
    await expect(print).toHaveAttribute('data-pages', String(CONTENT_PAGE_COUNT + 2));
    await expect(print).toHaveAttribute('data-revision', 'V1.0');

    const cover = print.getByTestId('kit-print-cover');
    const pages = print.getByTestId('kit-print-page');
    const back = print.getByTestId('kit-print-back-cover');
    await expect(cover).toHaveCount(1);
    await expect(pages).toHaveCount(CONTENT_PAGE_COUNT);
    await expect(back).toHaveCount(1);
    // Every page is the shell's: one frame of MKTG_PRINT_PAGE_FRAME_PT (792 × 594 pt), a landscape page host, its slide
    // area, title and head/footer boxes in place; the content pages number themselves from 02.
    const frames = print.getByTestId('mktg-print-page');
    await expect(frames).toHaveCount(CONTENT_PAGE_COUNT + 2);
    const sizes = await frames.evaluateAll((nodes) =>
      nodes.map((node) => [Math.round(node.getBoundingClientRect().width), Math.round(node.getBoundingClientRect().height)])
    );
    expect(new Set(sizes.map((size) => size.join('x')))).toEqual(
      new Set([`${Math.round((MKTG_PRINT_PAGE_FRAME_PT.w * 96) / 72)}x${Math.round((MKTG_PRINT_PAGE_FRAME_PT.h * 96) / 72)}`])
    );
    await expect(print.locator(`lfx-mktg-print-page.${MKTG_PRINT_LANDSCAPE_CLASS}`)).toHaveCount(CONTENT_PAGE_COUNT + 2);
    await expect(frames.first()).toHaveAttribute('data-layout', 'cover');
    await expect(frames.last()).toHaveAttribute('data-layout', 'back');
    const numbers = await pages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page')));
    expect(numbers).toEqual(Array.from({ length: CONTENT_PAGE_COUNT }, (_, index) => String(index + 2).padStart(2, '0')));
    for (const index of [0, CONTENT_PAGE_COUNT - 1]) {
      const content = pages.nth(index);
      await expect(content.getByTestId('mktg-print-page')).toHaveAttribute('data-layout', 'content');
      await expect(content.getByTestId('mktg-print-page-slide')).toHaveCount(1);
      await expect(content.getByTestId('mktg-print-page-title')).toHaveCount(1);
      await expect(content.getByTestId('mktg-print-page-head')).toHaveCount(2);
      await expect(content.getByTestId('mktg-print-page-footer')).toHaveCount(2);
      await expect(content.getByTestId('mktg-print-page-logo')).toHaveCount(1);
    }
    // The Iconography page's icons, each in its own slot box of the plan.
    const iconography = print.locator('[data-testid="kit-print-page"]:has([data-title="Iconography"])');
    await expect(iconography.getByTestId('kit-print-icon')).toHaveCount(2 * BRAND_KIT_ICON_SAMPLES.length);
    const indexes = await iconography.getByTestId('kit-print-icon').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-index')));
    expect(indexes).toEqual([...BRAND_KIT_ICON_SAMPLES.keys(), ...BRAND_KIT_ICON_SAMPLES.keys()].map(String));
    // Nothing of the portrait sheet remains in the kit's print.
    await expect(print.locator('.kit-chapter')).toHaveCount(0);
    await expect(print.locator('lfx-mktg-print-running-head')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('kit-pdf-structure.png'), fullPage: true });
  });
});
