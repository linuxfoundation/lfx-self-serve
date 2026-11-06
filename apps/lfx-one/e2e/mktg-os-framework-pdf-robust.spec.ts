// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FOUNDATION_MESSAGE_PRINT_BODY_CLASS, MKTG_PRINT_LANDSCAPE_CLASS, MKTG_PRINT_PAGE_FRAME_PT } from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';
import { columnAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { expectMktgPrintFrame, layoutMktgPrintFrame, PRINT_FRAME_LANDSCAPE, stubMktgPrintFrame } from './helpers/mktg-print.helper';

/** The content pages of the synthetic draft framework: one page per deck slide after the cover. */
const CONTENT_PAGE_COUNT = 8;
const SECTIONS = ['framework', 'framework', 'framework', 'framework', 'icps', 'message-house', 'message-house', 'numbers'];

test.describe('Messaging framework PDF structure', () => {
  test('the data-testid contract: the root with its page count, one cover, the content pages with their section and number, each a landscape page frame of the shell, no back cover', async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await stubMktgPrintFrame(page);
    await openAssetDocument(page, 'foundation-message', 200, true, false, columnAssetRevisionResponse('foundation-message'));
    await page.getByTestId('mktg-framework-view-download-pdf').getByRole('button').click();
    await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
    const frame = await layoutMktgPrintFrame(page, PRINT_FRAME_LANDSCAPE);
    const print = frame.getByTestId('mktg-framework-print');
    await expect(print).toBeVisible();
    await expect(print).toHaveAttribute('data-pages', String(CONTENT_PAGE_COUNT + 1));
    await expect(print).toHaveAttribute('data-brand', 'lf');

    const cover = print.getByTestId('framework-print-cover');
    const pages = print.getByTestId('framework-print-page');
    await expect(cover).toHaveCount(1);
    await expect(pages).toHaveCount(CONTENT_PAGE_COUNT);
    await expect(print.locator('lfx-mktg-print-back-cover')).toHaveCount(0);
    // Every page is the shell's: one frame of MKTG_PRINT_PAGE_FRAME_PT (792 × 594 pt), a landscape page host, its slide
    // area, title and head/footer boxes in place; the frames are block children of the root, outside `.lfx-framework-print`.
    const frames = print.getByTestId('mktg-print-page');
    await expect(frames).toHaveCount(CONTENT_PAGE_COUNT + 1);
    const sizes = await frames.evaluateAll((nodes) =>
      nodes.map((node) => [Math.round(node.getBoundingClientRect().width), Math.round(node.getBoundingClientRect().height)])
    );
    expect(new Set(sizes.map((size) => size.join('x')))).toEqual(
      new Set([`${Math.round((MKTG_PRINT_PAGE_FRAME_PT.w * 96) / 72)}x${Math.round((MKTG_PRINT_PAGE_FRAME_PT.h * 96) / 72)}`])
    );
    await expect(print.locator(`lfx-mktg-print-page.${MKTG_PRINT_LANDSCAPE_CLASS}`)).toHaveCount(CONTENT_PAGE_COUNT + 1);
    // The legacy portrait print's testids are gone from the framework's print: every frame is the shell's.
    await expect(print.locator('[data-testid^="mktg-framework-print-"]')).toHaveCount(0);
    const children = await print.evaluateAll((nodes) =>
      nodes.flatMap((node) => Array.from(node.children, (child) => [child.tagName.toLowerCase(), getComputedStyle(child).display]))
    );
    expect(children).toEqual([['lfx-mktg-print-cover', 'block'], ...Array.from({ length: CONTENT_PAGE_COUNT }, () => ['lfx-mktg-print-page', 'block'])]);
    const left = await frames.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
    expect(new Set(left)).toEqual(new Set([0]));
    await expect(frames.first()).toHaveAttribute('data-layout', 'cover');
    const numbers = await pages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page')));
    expect(numbers).toEqual(Array.from({ length: CONTENT_PAGE_COUNT }, (_, index) => String(index + 2)));
    const sections = await pages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-section')));
    expect(sections).toEqual(SECTIONS);
    for (const index of [0, CONTENT_PAGE_COUNT - 1]) {
      const content = pages.nth(index);
      await expect(content.getByTestId('mktg-print-page')).toHaveAttribute('data-layout', 'content');
      await expect(content.getByTestId('mktg-print-page-slide')).toHaveCount(1);
      await expect(content.getByTestId('mktg-print-page-title')).toHaveCount(1);
      await expect(content.getByTestId('mktg-print-page-head')).toHaveCount(2);
      await expect(content.getByTestId('mktg-print-page-footer')).toHaveCount(2);
      await expect(content.getByTestId('mktg-print-page-logo')).toHaveCount(1);
    }
    // Nothing of the portrait document remains in the framework's print.
    await expect(print.locator('lfx-mktg-print-sheet')).toHaveCount(0);
    await expect(print.locator('lfx-mktg-print-running-head')).toHaveCount(0);
    await expect(print.locator('table')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('framework-pdf-structure.png'), fullPage: true });
  });
});
