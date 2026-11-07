// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The Brand Kit's PDF as the portrait book (#5341): the design mock's seventeen US Letter pages, drawn from the kit's
 * own record behind `mktg-os-pdf-download-enabled`. Content spec: what each page says and how it sits on its frame.
 * The structural pair (`mktg-os-brand-kit-pdf-robust.spec.ts`) pins the `data-testid` contract.
 */

import { BRAND_KIT_PRINT_BODY_CLASS, MKTG_OS_PDF_DOWNLOAD_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { expect, FrameLocator, Locator, Page, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { columnAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { pinMktgOsFlags } from './helpers/mktg-os-flags.helper';
import { expectMktgPortraitPageSetup, expectMktgPrintFrame, finishMktgPrintFrame, layoutMktgPrintFrame, stubMktgPrintFrame } from './helpers/mktg-print.helper';

/** The synthetic kit's plan: no symbol file, so no symbol page; sixteen frames. */
const PAGES = [
  'cover',
  'contents',
  'logo-system',
  'logo-colorways',
  'logo-clear-space',
  'logo-partnership',
  'logo-watchouts',
  'color-palette',
  'color-contrast',
  'type',
  'visual-iconography',
  'visual-imagery',
  'usage',
  'voice',
  'sources',
  'back-cover',
];

/** A `#RRGGBB` as the browser reports it on a computed style. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** The approved kit with a recorded approver, for the contents line and the Sources page's accepted box. */
function approvedByNameResponse(): MktgRevisionResponse {
  const base = columnAssetRevisionResponse('brand-kit');
  const approval = { approvedAt: '2026-11-06T10:00:00Z', approvedBy: { name: 'Synthetic Approver' } };
  const revision = { ...base.revision, approval };
  return { ...base, approval, revision, revisions: [revision] };
}

/** The approved kit without any logo file: the Logo chapter is one page saying so. */
function noLogoFilesResponse(): MktgRevisionResponse {
  const base = columnAssetRevisionResponse('brand-kit');
  const sidecar = base.sidecar as { chapters: { logo: { files: Record<string, unknown> } } };
  const logo = { ...sidecar.chapters.logo, files: { primary: null, stacked: null, symbol: null, reversed: null } };
  return { ...base, sidecar: { ...sidecar, chapters: { ...sidecar.chapters, logo } } as MktgRevisionResponse['sidecar'] };
}

/** Opens the approved kit, clicks Download PDF and returns the print frame's book. */
async function openBook(page: Page, response = columnAssetRevisionResponse('brand-kit')): Promise<{ frame: FrameLocator; book: Locator; pages: Locator }> {
  await stubMktgPrintFrame(page);
  await openAssetDocument(page, 'brand-kit', 200, true, false, response);
  await page.getByTestId('brand-kit-web-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, BRAND_KIT_PRINT_BODY_CLASS, 'lfx-mktg-brand-kit-print');
  const frame = await layoutMktgPrintFrame(page);
  const book = frame.getByTestId('mktg-brand-kit-print');
  await expect(book).toBeVisible();
  return { frame, book, pages: book.getByTestId('lfx-mktg-portrait-page') };
}

/** A frame's child placed on it: its offset from the frame's top-left corner and its width, rounded. */
async function placement(frame: Locator, child: Locator): Promise<{ x: number; y: number; width: number }> {
  const [outer, inner] = await Promise.all([frame.boundingBox(), child.boundingBox()]);
  if (!outer || !inner) throw new Error('The frame and its child must be laid out');
  return { x: Math.round(inner.x - outer.x), y: Math.round(inner.y - outer.y), width: Math.round(inner.width) };
}

test.describe('Brand kit PDF: the portrait book', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await suppressCookieBanner(page);
  });

  test('prints the sixteen US Letter frames in the mock’s order, each a whole page with the band on its chapter’s first page and the document name in the head', async ({
    page,
  }, info) => {
    const { frame, pages } = await openBook(page);
    await expectMktgPortraitPageSetup(frame);
    await expect(pages).toHaveCount(PAGES.length);
    const ids = await pages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-id')));
    expect(ids).toEqual(PAGES);
    const numbers = await pages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page')));
    expect(numbers).toEqual(PAGES.map((_, index) => String(index + 1)));
    const sections = await pages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-section')));
    expect(sections.slice(2, 8)).toEqual(['01 Logo', '01 Logo', '01 Logo', '01 Logo', '01 Logo', '02 Color']);
    expect(sections.slice(8)).toEqual(['02 Color', '03 Type', '04 Visual', '04 Visual', '05 Usage', '06 Voice', '07 Sources', 'Back cover']);
    // Every frame 816 × 1056 at the sheet's left edge, its own page, a page break after it.
    for (const node of await pages.all()) {
      const box = await node.boundingBox();
      if (!box) throw new Error('Every frame must be laid out');
      expect({ x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height) }).toEqual({ x: 0, width: 816, height: 1056 });
      await expect(node).toHaveCSS('page', 'mktg-portrait');
      await expect(node).toHaveCSS('break-after', 'page');
    }
    // The band on each chapter's first page only; the running head's right text is the document's name; no version in the body.
    const banded = await pages.evaluateAll((nodes) =>
      nodes.filter((node) => node.querySelector('[data-testid="mktg-portrait-page-band"]')).map((node) => node.getAttribute('data-page-id'))
    );
    expect(banded).toEqual(['logo-system', 'color-palette', 'type', 'visual-iconography', 'usage', 'voice', 'sources']);
    const heads = pages.getByTestId('mktg-portrait-page-doc');
    await expect(heads).toHaveCount(14);
    await expect(heads.first()).toHaveText('Asset Example brand kit');
    // The version is on the cover and the back cover only: not on the contents page, not in a running head.
    await expect(pages.nth(1)).not.toContainText('V3.0');
    await expect(pages.nth(3)).not.toContainText('V3.0');
    await expect(pages.getByTestId('mktg-portrait-page-number')).toHaveText(Array.from({ length: 14 }, (_, index) => String(index + 2)));
    await page.screenshot({ path: info.outputPath('book-frames.png'), fullPage: true });
  });

  test('opens on the cover with the kit’s lockup, title, brand line and the version strip, and closes on the dark back cover', async ({ page }, info) => {
    const kit = brandKitTestRevision();
    const { pages } = await openBook(page);
    const cover = pages.first();
    await expect(cover.getByTestId('mktg-portrait-cover-title')).toHaveText('Brand Kit');
    await expect(cover.getByTestId('mktg-portrait-cover-lede')).toContainText(`${kit.chapters.voice.line}.`);
    await expect(cover.getByTestId('mktg-portrait-cover-strip')).toContainText('one.example.org · V3.0 · October 2026');
    await expect(cover.getByTestId('mktg-portrait-cover-logo')).toBeVisible();
    await expect(cover).toHaveCSS('background-color', rgb(kit.kit.dark));
    const back = pages.last();
    await expect(back).toHaveCSS('background-color', rgb(kit.kit.dark));
    await expect(back.getByTestId('mktg-portrait-back-cover-line')).toHaveText(kit.chapters.voice.line);
    await expect(back.getByTestId('mktg-portrait-back-cover-url')).toHaveText('one.example.org');
    await expect(back.getByTestId('mktg-portrait-back-cover-version')).toHaveText('V3.0 · October 2026');
    await expect(back.getByTestId('mktg-portrait-back-cover-notice')).toBeVisible();
    await expect(back.getByTestId('mktg-portrait-page-foot')).toHaveCount(0);
    await back.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('back-cover.png'), fullPage: true });
  });

  test('numbers the contents from the plan, with the Sources page at 15 and the back cover at 16, and says what the kit is built from without a file name', async ({
    page,
  }, info) => {
    const { pages } = await openBook(page);
    const contents = pages.nth(1);
    const rows = contents.locator('.kp-contents-row');
    await expect(rows).toHaveCount(14);
    await expect(rows.last()).toContainText('Back cover');
    await expect(rows.last()).toContainText('16');
    await expect(rows.nth(12)).toContainText('Sources & decisions');
    await expect(rows.nth(12)).toContainText('15');
    await expect(contents.getByTestId('brand-kit-contents-built-from')).not.toContainText('.svg');
    await expect(contents.getByTestId('brand-kit-contents-approval')).toHaveCount(0);
    await contents.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('contents.png'), fullPage: false });
  });

  test('grades every palette pairing in the contrast matrix from the hex values and repeats the kit’s own pairs', async ({ page }, info) => {
    const { pages } = await openBook(page);
    const contrast = pages.nth(8);
    const matrix = contrast.getByTestId('brand-kit-contrast-matrix');
    expect(await placement(contrast, matrix)).toEqual({ x: 56, y: 220, width: 704 });
    await expect(matrix.locator('thead th')).toHaveText(['', 'on Charcoal', 'on White', 'on Orange', 'on Mid gray']);
    await expect(matrix.locator('tbody tr')).toHaveCount(4);
    await expect(matrix.locator('.kp-matrix-same')).toHaveCount(4);
    const charcoal = matrix.locator('tbody tr').first().locator('.kp-matrix-cell');
    await expect(charcoal).toHaveAttribute('data-ratio', /^\d+\.\d$/);
    await expect(charcoal.first().locator('.kp-pill')).toHaveText('AAA');
    const pairs = contrast.getByTestId('brand-kit-contrast-pairs');
    expect(await placement(contrast, pairs)).toEqual({ x: 56, y: 610, width: 704 });
    await expect(pairs.locator('.kp-pair')).toHaveText([/Charcoal on White\s+8\.3:1\s+AAA/]);
    await contrast.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('color-contrast.png'), fullPage: false });
  });

  test('shows the type specimen in the kit’s family, the scale at real size with the kit’s own words, and names the font source by its host', async ({
    page,
  }, info) => {
    const kit = brandKitTestRevision();
    const { pages } = await openBook(page);
    const type = pages.nth(9);
    const h1 = type.getByTestId('brand-kit-type-h1');
    await expect(h1).toHaveText(kit.chapters.voice.line);
    await expect(h1).toHaveCSS('font-size', '48px');
    expect(await placement(type, type.getByTestId('brand-kit-type-specimen'))).toEqual({ x: 56, y: 212, width: 704 });
    expect(await placement(type, type.getByTestId('brand-kit-type-scale'))).toEqual({ x: 56, y: 436, width: 704 });
    const steps = type.getByTestId('brand-kit-type-scale').locator('[data-step]');
    await expect(steps).toHaveCount(kit.chapters.type.scale.length);
    await expect(steps.first().locator('.kp-scale-sample')).toHaveCSS('font-size', '64px');
    // The kit's own record names the project (the fixture's sidecar says Project One; the head carries the context's name).
    await expect(steps.first().locator('.kp-scale-sample')).toHaveText(kit.projectName);
    await expect(steps.nth(4).locator('.kp-scale-sample')).toHaveText(kit.chapters.voice.umbrella);
    await expect(type.getByTestId('brand-kit-type-source')).toContainText('Montserrat · Google Fonts · weights 400, 700');
    await expect(type.getByTestId('brand-kit-type-source')).toContainText('Named on one.example.org');
    await expect(type.getByTestId('brand-kit-type-source')).not.toContainText('https://');
    await expect(type.getByTestId('brand-kit-type-rules').locator('li')).toHaveText(kit.chapters.type.rules);
    await type.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('type.png'), fullPage: false });
  });

  test('draws the imagery page’s ground and element cards with the call-out inked by the shared rule, then the usage cards with the kit’s lines', async ({
    page,
  }, info) => {
    const kit = brandKitTestRevision();
    const { pages } = await openBook(page);
    const imagery = pages.nth(11);
    expect(await placement(imagery, imagery.getByTestId('brand-kit-imagery-ground'))).toEqual({ x: 56, y: 220, width: 704 });
    await expect(imagery.getByTestId('brand-kit-imagery-elements').locator('.kp-element')).toHaveCount(3);
    await expect(imagery.locator('.kp-element--callout')).toHaveCSS('background-color', rgb(kit.kit.accent));
    await expect(imagery.locator('.kp-element--callout')).toHaveCSS('color', rgb(kit.kit.dark));
    await expect(imagery.getByTestId('brand-kit-imagery-callout-caption')).toContainText('text in Charcoal (white on Orange fails AA, 2.8:1)');
    await expect(imagery.getByTestId('brand-kit-imagery-avoid').locator('li')).toHaveText(kit.chapters.visual.imagery.avoid);
    const usage = pages.nth(12);
    const cards = usage.getByTestId('brand-kit-usage-cards').locator('.kp-usage-card');
    await expect(cards).toHaveCount(4);
    for (const card of await cards.all()) {
      const box = await card.locator('.kp-usage-frame').boundingBox();
      expect(box && { width: Math.round(box.width), height: Math.round(box.height) }).toEqual({ width: 344, height: 210 });
    }
    await expect(cards.nth(1).locator('.kp-usage-frame')).toHaveCSS('background-color', rgb(kit.kit.accent));
    await expect(cards.nth(1).locator('.kp-usage-frame')).toHaveCSS('color', rgb(kit.kit.dark));
    await expect(cards.nth(0)).toContainText(kit.chapters.voice.line);
    await expect(cards.nth(2)).toContainText(`${kit.projectName} annual report 2026`);
    await expect(cards.nth(3)).toContainText(`New members join ${kit.projectName}`);
    await expect(usage.getByTestId('brand-kit-usage-table').locator('tbody tr')).toHaveCount(4);
    await usage.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('usage.png'), fullPage: false });
  });

  test('prints the voice page from the kit’s messages and attributes and the Sources page from the run record, in words, without a Say/Avoid block', async ({
    page,
  }, info) => {
    const kit = brandKitTestRevision();
    const { pages } = await openBook(page);
    const voice = pages.nth(13);
    await expect(voice.getByTestId('brand-kit-voice-intro')).toHaveText('From the messaging framework. As they are.');
    await expect(voice.locator('.kp-voice-umbrella')).toHaveText(kit.chapters.voice.umbrella);
    await expect(voice.locator('.kp-voice-line')).toHaveText(kit.chapters.voice.line);
    expect(await placement(voice, voice.getByTestId('brand-kit-voice-attributes'))).toEqual({ x: 56, y: 540, width: 704 });
    await expect(voice.locator('.kp-attribute-name')).toHaveText(kit.chapters.voice.attributes.map((attribute) => attribute.name));
    await expect(voice).not.toContainText('Avoid');
    const sources = pages.nth(14);
    await expect(sources.getByTestId('brand-kit-sources-read').locator('li')).toHaveText(['one.example.org']);
    await expect(sources.getByTestId('brand-kit-sources-failed')).toHaveCount(0);
    await expect(sources.getByTestId('brand-kit-sources-missing')).toHaveCount(0);
    await expect(sources.getByTestId('brand-kit-sources-conflicts')).toHaveCount(0);
    await expect(sources.getByTestId('brand-kit-sources-accepted')).toHaveCount(0);
    await expect(sources).not.toContainText('https://');
    await sources.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('sources.png'), fullPage: false });
  });

  test('with a recorded approver, prints the approval line on the contents page and the accepted box on the Sources page', async ({ page }, info) => {
    const { pages } = await openBook(page, approvedByNameResponse());
    await expect(pages.nth(1).getByTestId('brand-kit-contents-approval')).toHaveText('Approved 6 Nov 2026 by Synthetic Approver');
    const accepted = pages.nth(14).getByTestId('brand-kit-sources-accepted');
    expect(await placement(pages.nth(14), accepted)).toEqual({ x: 56, y: 880, width: 704 });
    await expect(accepted).toContainText('Accepted when V3.0 was approved. Approved 6 Nov 2026 by Synthetic Approver.');
    await pages.nth(14).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('sources-accepted.png'), fullPage: false });
  });

  test('a kit without logo files keeps one Logo page saying no files were uploaded, drops the logo pages that need them, and prints no empty frame', async ({
    page,
  }, info) => {
    const { pages, book } = await openBook(page, noLogoFilesResponse());
    const ids = await pages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-id')));
    expect(ids).toEqual(PAGES.filter((id) => !id.startsWith('logo-') || id === 'logo-system'));
    await expect(pages.nth(2).getByTestId('brand-kit-logo-system-none')).toHaveText('No logo files uploaded yet');
    await expect(pages.nth(2).getByTestId('brand-kit-logo-system-files')).toHaveCount(0);
    await expect(book.locator('img')).toHaveCount(0);
    await expect(book).not.toContainText('SVG supplied');
    await expect(pages.nth(1).locator('.kp-contents-row')).toHaveCount(10);
    await pages.nth(2).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('logo-system-no-files.png'), fullPage: false });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });

  test('with the PDF flag off there is no Download PDF and no book in the page', async ({ page }, info) => {
    await pinMktgOsFlags(page, { [MKTG_OS_PDF_DOWNLOAD_ENABLED_FLAG]: false });
    await openAssetDocument(page, 'brand-kit', 200, true, false, columnAssetRevisionResponse('brand-kit'));
    await expect(page.getByTestId('brand-kit-web-view')).toBeVisible();
    await expect(page.getByTestId('brand-kit-web-view-download-pdf')).toHaveCount(0);
    await expect(page.getByTestId('lfx-mktg-portrait-page')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('flag-off.png'), fullPage: true });
  });
});
