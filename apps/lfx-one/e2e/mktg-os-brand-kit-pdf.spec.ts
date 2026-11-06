// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_BOOK_PAGES, BRAND_KIT_ICON_HIGHLIGHT_INDEX, BRAND_KIT_ICON_SAMPLES, BRAND_KIT_PRINT_BODY_CLASS } from '@lfx-one/shared/constants';
import { brandKitIconColours } from '@lfx-one/shared/utils/brand-kit-icons.utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { expect, FrameLocator, Page, test } from '@playwright/test';
import { columnAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import {
  expectMktgPrintFrame,
  expectMktgPrintLandscapePageSetup,
  layoutMktgPrintFrame,
  PRINT_FRAME_LANDSCAPE,
  stubMktgPrintFrame,
} from './helpers/mktg-print.helper';

/** The content pages in the deck's order: the contents page, then BRAND_KIT_BOOK_PAGES without the back cover (a page of its own). */
const CONTENT_TITLES = ['What’s inside', ...BRAND_KIT_BOOK_PAGES.filter((entry) => entry.id !== 'back-cover').map((entry) => entry.title)];

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Open the approved kit, click Download PDF and lay the landscape print frame out; the kit print's root inside it. */
async function openKitPdf(page: Page): Promise<{ frame: FrameLocator; print: ReturnType<FrameLocator['getByTestId']> }> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  await openAssetDocument(page, 'brand-kit', 200, true, false, columnAssetRevisionResponse('brand-kit'));
  await page.getByTestId('brand-kit-web-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, BRAND_KIT_PRINT_BODY_CLASS, 'lfx-mktg-brand-kit-print');
  const frame = await layoutMktgPrintFrame(page, PRINT_FRAME_LANDSCAPE);
  const print = frame.getByTestId('mktg-brand-kit-print');
  await expect(print).toBeVisible();
  return { frame, print };
}

test.describe('Brand kit PDF: the deck’s pages', () => {
  test('Download PDF prints the kit as the deck’s sixteen landscape pages, in its order, with its headings and page numbers, and no version on an inner page', async ({
    page,
  }, info) => {
    const kit = brandKitTestRevision();
    const { frame, print } = await openKitPdf(page);
    await expectMktgPrintLandscapePageSetup(frame);
    // The cover, the contents and the thirteen chapter pages, then the back cover: the deck's slide count for this kit.
    await expect(print).toHaveAttribute('data-pages', '16');
    await expect(print.getByTestId('kit-print-cover')).toHaveCount(1);
    await expect(print.getByTestId('kit-print-back-cover')).toHaveCount(1);
    const pages = print.getByTestId('kit-print-page');
    await expect(pages).toHaveCount(CONTENT_TITLES.length);
    const titles = await pages.evaluateAll((nodes) => nodes.map((node) => node.querySelector('[data-testid="mktg-print-page"]')?.getAttribute('data-title')));
    expect(titles).toEqual(CONTENT_TITLES);
    // The running head: the chapter left, the document right; the footer: the project's line left, the page number right.
    const contents = pages.first();
    await expect(contents.getByTestId('mktg-print-page-head')).toHaveText(['Contents', `${kit.projectName} Brand Kit`]);
    await expect(pages.nth(1).getByTestId('mktg-print-page-head').first()).toHaveText('01 Logo');
    await expect(contents.getByTestId('mktg-print-page-footer')).toHaveText([`${kit.projectName} · a Linux Foundation project`, '02']);
    await expect(pages.last().getByTestId('mktg-print-page-footer').last()).toHaveText('15');
    // The contents list the page each chapter page starts on.
    await expect(contents).toContainText('03   Logo system');
    await expect(contents).toContainText('15   Voice in brief');
    await expect(contents).toContainText('16   Back cover');
    // No inner page shows the version (#5224): the cover does, the file name does.
    for (let index = 0; index < CONTENT_TITLES.length; index++) {
      await expect(pages.nth(index)).not.toContainText('V1.0');
    }
    await page.screenshot({ path: info.outputPath('kit-pdf-pages.png'), fullPage: true });
  });

  test('the cover is the deck’s: Brand Kit over the brand line, the project’s eyebrow, the version top right, host · version · month in the footer', async ({
    page,
  }, info) => {
    const kit = brandKitTestRevision();
    const { print } = await openKitPdf(page);
    const cover = print.getByTestId('kit-print-cover');
    await expect(cover.getByTestId('mktg-print-page')).toHaveAttribute('data-layout', 'cover');
    await expect(cover.getByTestId('mktg-print-page-title')).toHaveText('Brand Kit');
    await expect(cover.getByTestId('mktg-print-page-subtitle')).toHaveText(
      'Open standards for one computing. Logos, color, type and usage on one reference, for members, partners and the press.'
    );
    await expect(cover).toContainText(`${kit.projectName} · A Linux Foundation project`);
    await expect(cover).toContainText('V1.0');
    await expect(cover).toContainText('one.example.org · V1.0 · October 2026');
    // The slide area is the kit's dark; the bands around it stay white (the deck's cover).
    await expect(cover.getByTestId('mktg-print-page-slide')).toHaveCSS('background-color', rgb(kit.kit.dark));
    await cover.screenshot({ path: info.outputPath('kit-pdf-cover.png') });
  });

  test('the Iconography page draws the eight tiles and the strip in the kit’s colours, the third strip icon in the highlight, with the recommended set under them', async ({
    page,
  }, info) => {
    const kit = brandKitTestRevision();
    const colours = brandKitIconColours(kit);
    const { print } = await openKitPdf(page);
    const iconography = print.locator('[data-testid="kit-print-page"]:has([data-title="Iconography"])');
    await expect(iconography).toHaveCount(1);
    const icons = iconography.getByTestId('kit-print-icon');
    await expect(icons).toHaveCount(2 * BRAND_KIT_ICON_SAMPLES.length);
    await expect(icons.first()).toHaveCSS('color', rgb(colours.tileInk));
    await expect(icons.first().locator('svg')).toBeVisible();
    await expect(icons.nth(BRAND_KIT_ICON_SAMPLES.length)).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(icons.nth(BRAND_KIT_ICON_SAMPLES.length + BRAND_KIT_ICON_HIGHLIGHT_INDEX)).toHaveCSS('color', rgb(colours.highlight));
    for (const sample of BRAND_KIT_ICON_SAMPLES) {
      await expect(iconography).toContainText(sample.label);
    }
    await expect(iconography).toContainText(`Recommended set: ${kit.chapters.visual.icons.recommended}`);
    await expect(iconography).toContainText(kit.chapters.visual.icons.rules[0]);
    await iconography.screenshot({ path: info.outputPath('kit-pdf-iconography.png') });
  });

  test('a kit with no symbol artwork drops the Symbol page’s tiles and shapes, never labelling an empty slot, while the logo pages draw the lockup', async ({
    page,
  }, info) => {
    const { print } = await openKitPdf(page);
    const symbol = print.locator('[data-testid="kit-print-page"]:has([data-title="Symbol & symbol in shape"])');
    await expect(symbol).toContainText('The symbol.');
    await expect(symbol).not.toContainText('Variants');
    await expect(symbol).not.toContainText('In shape');
    await expect(symbol.locator('img')).toHaveCount(1); // the footer's lockup alone
    const system = print.locator('[data-testid="kit-print-page"]:has([data-title="Logo system"])');
    await expect(system).toContainText('Primary · horizontal lockup');
    await expect(system.getByTestId('mktg-print-page-el').locator('img')).toHaveCount(1);
    await expect(system).not.toContainText('stacked');
    await symbol.screenshot({ path: info.outputPath('kit-pdf-symbol.png') });
  });

  test('the back cover sets the brand line in capitals on the kit’s dark, with the host and the trademark notice for the project', async ({ page }, info) => {
    const kit = brandKitTestRevision();
    const { print } = await openKitPdf(page);
    const back = print.getByTestId('kit-print-back-cover');
    await expect(back.getByTestId('mktg-print-page')).toHaveAttribute('data-layout', 'back');
    await expect(back.getByTestId('mktg-print-page-title')).toHaveText(kit.chapters.voice.line);
    await expect(back.getByTestId('mktg-print-page-title').locator('p')).toHaveCSS('text-transform', 'uppercase');
    await expect(back).toContainText('one.example.org');
    await expect(back).toContainText(`${kit.projectName} and its logo are trademarks of the Linux Foundation`);
    await back.screenshot({ path: info.outputPath('kit-pdf-back-cover.png') });
  });
});
