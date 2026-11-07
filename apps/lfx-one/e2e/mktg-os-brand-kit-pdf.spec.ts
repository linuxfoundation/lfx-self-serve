// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * The Brand Kit's PDF as the portrait book (#5341): the design mock's seventeen US Letter pages, drawn from the kit's
 * own record behind `mktg-os-pdf-download-enabled`. Content spec: what each page says and how it sits on its frame.
 * The structural pair (`mktg-os-brand-kit-pdf-robust.spec.ts`) pins the `data-testid` contract.
 */

import {
  BRAND_KIT_PRINT_BODY_CLASS,
  MKTG_OS_PDF_DOWNLOAD_ENABLED_FLAG,
  MKTG_PORTRAIT_PAGE_NUMBER_DIGITS,
  MKTG_PORTRAIT_PAPERS,
} from '@lfx-one/shared/constants';
import { MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { brandKitMinimalFixture, brandKitOverfullFixture, brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import type { BrandKitRevision } from '@lfx-one/shared/interfaces';
import { mktgPortraitAccentText } from '@lfx-one/shared/utils/mktg-portrait-print.utils';
import { expect, FrameLocator, Locator, Page, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { ASSET_PROJECT, columnAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { pinMktgOsFlags } from './helpers/mktg-os-flags.helper';
import {
  expectMktgPortraitPageSetup,
  expectMktgPrintFrame,
  finishMktgPrintFrame,
  layoutMktgPrintFrame,
  printMktgFrameWithChrome,
  stubMktgPrintFrame,
} from './helpers/mktg-print.helper';

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

/** The approved kit with a stacked lockup only: nothing the Colorways, Clear space, Partnership or Watchouts tiles draw. */
function stackedOnlyResponse(): MktgRevisionResponse {
  const base = columnAssetRevisionResponse('brand-kit');
  const sidecar = base.sidecar as { chapters: { logo: { files: Record<string, unknown> } } };
  const stacked = { ref: 'stacked.svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 4"/>' };
  const logo = { ...sidecar.chapters.logo, files: { primary: null, stacked, symbol: null, reversed: null } };
  return { ...base, sidecar: { ...sidecar, chapters: { ...sidecar.chapters, logo } } as MktgRevisionResponse['sidecar'] };
}

/** The approved kit with PNG uploads only (no SVG bytes): files the record holds and the print cannot draw. */
function pngOnlyResponse(): MktgRevisionResponse {
  const base = columnAssetRevisionResponse('brand-kit');
  const sidecar = base.sidecar as { chapters: { logo: { files: Record<string, unknown> } } };
  const files = {
    primary: { ref: 'asset-example-lockup.png', svg: null },
    stacked: null,
    symbol: { ref: 'asset-example-symbol.png', svg: null },
    reversed: null,
  };
  const logo = { ...sidecar.chapters.logo, files };
  return { ...base, sidecar: { ...sidecar, chapters: { ...sidecar.chapters, logo } } as MktgRevisionResponse['sidecar'] };
}

/** The approved kit without any logo file: the Logo chapter is one page saying so. */
function noLogoFilesResponse(): MktgRevisionResponse {
  const base = columnAssetRevisionResponse('brand-kit');
  const sidecar = base.sidecar as { chapters: { logo: { files: Record<string, unknown> } } };
  const logo = { ...sidecar.chapters.logo, files: { primary: null, stacked: null, symbol: null, reversed: null } };
  return { ...base, sidecar: { ...sidecar, chapters: { ...sidecar.chapters, logo } } as MktgRevisionResponse['sidecar'] };
}

/** The approved kit's response with another shared fixture's record in the sidecar (the overfull and the minimal records). */
function fixtureResponse(kit: BrandKitRevision): MktgRevisionResponse {
  const base = columnAssetRevisionResponse('brand-kit');
  const sidecar = base.sidecar as Record<string, unknown>;
  return { ...base, sidecar: { ...sidecar, kit: kit.kit, chapters: kit.chapters, report: kit.report } as MktgRevisionResponse['sidecar'] };
}

/** True when every box inside `root` ends at or above `bottom` px from the frame's top (nothing runs past the footer line). */
async function endsAbove(frame: Locator, root: Locator, bottom: number): Promise<boolean> {
  const outer = await frame.boundingBox();
  if (!outer) throw new Error('The frame must be laid out');
  const boxes = await root.locator('*').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().bottom));
  const top = await frame.evaluate((node) => node.getBoundingClientRect().top);
  return boxes.every((edge) => edge - top <= bottom + 0.5);
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
    // Every frame 816 × 1056 at the sheet's left edge, its own page, one page break before it and none after it (the
    // break model that cannot leave a trailing blank sheet: a forced break at the start of the print is suppressed).
    for (const node of await pages.all()) {
      const box = await node.boundingBox();
      if (!box) throw new Error('Every frame must be laid out');
      expect({ x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height) }).toEqual({ x: 0, width: 816, height: 1056 });
      await expect(node).toHaveCSS('page', 'mktg-portrait');
      await expect(node).toHaveCSS('break-before', 'page');
      await expect(node).toHaveCSS('break-after', 'auto');
    }
    // The band on each chapter's first page only; the running head's right text is the document's name; no version in the body.
    const banded = await pages.evaluateAll((nodes) =>
      nodes.filter((node) => node.querySelector('[data-testid="mktg-portrait-page-band"]')).map((node) => node.getAttribute('data-page-id'))
    );
    expect(banded).toEqual(['logo-system', 'color-palette', 'type', 'visual-iconography', 'usage', 'voice', 'sources']);
    // The running head's section label: the accent as TEXT under the band (p03: the kit's orange darkened until it reads
    // on white at WCAG AA, never the fill accent at 2.8:1), the kit's dark without it (p04).
    const kit = brandKitTestRevision();
    await expect(pages.nth(2).getByTestId('mktg-portrait-page-section')).toHaveCSS('color', rgb(mktgPortraitAccentText(kit.kit.accent)));
    await expect(pages.nth(3).getByTestId('mktg-portrait-page-section')).toHaveCSS('color', rgb(kit.kit.dark));
    const heads = pages.getByTestId('mktg-portrait-page-doc');
    await expect(heads).toHaveCount(14);
    await expect(heads.first()).toHaveText('Asset Example brand kit');
    // The version (the approved revision's number: V1.0 here) is on the cover and the back cover only: not on the contents
    // page, not in a running head.
    await expect(pages.nth(1)).not.toContainText('V1.0');
    await expect(pages.nth(3)).not.toContainText('V1.0');
    // The grammar prints the inner pages' numbers padded ("02"…"15"), the cover and back cover unnumbered.
    await expect(pages.getByTestId('mktg-portrait-page-number')).toHaveText(
      Array.from({ length: 14 }, (_, index) => String(index + 2).padStart(MKTG_PORTRAIT_PAGE_NUMBER_DIGITS, '0'))
    );
    await page.screenshot({ path: info.outputPath('book-frames.png'), fullPage: true });
  });

  test('opens on the cover with the kit’s lockup, title, brand line and the version strip, and closes on the dark back cover', async ({ page }, info) => {
    const kit = brandKitTestRevision();
    const { pages } = await openBook(page);
    const cover = pages.first();
    await expect(cover.getByTestId('mktg-portrait-cover-title')).toHaveText('Brand Kit');
    await expect(cover.getByTestId('mktg-portrait-cover-lede')).toContainText(`${kit.chapters.voice.line}.`);
    // The strip: the footer line (the project's name is the context's, not the fixture's sidecar), then host · version ·
    // month of the run.
    await expect(cover.getByTestId('mktg-portrait-cover-strip')).toContainText(`${ASSET_PROJECT.name} · a Linux Foundation project`);
    await expect(cover.getByTestId('mktg-portrait-cover-strip')).toContainText('one.example.org · V1.0 · October 2026');
    // Every text of the book is set in the kit's own face, the app's Inter nowhere: the lede, an intro, the back cover.
    const face = new RegExp(`^"?${kit.chapters.type.family}"?`);
    await expect(cover.getByTestId('mktg-portrait-cover-lede')).toHaveCSS('font-family', face);
    await expect(pages.nth(2).getByTestId('brand-kit-logo-system-intro')).toHaveCSS('font-family', face);
    await expect(pages.nth(3).getByTestId('brand-kit-colorways-intro')).toHaveCSS('font-family', face);
    await expect(cover.getByTestId('mktg-portrait-cover-logo')).toBeVisible();
    await expect(cover).toHaveCSS('background-color', rgb(kit.kit.dark));
    const back = pages.last();
    await expect(back).toHaveCSS('background-color', rgb(kit.kit.dark));
    await expect(back.getByTestId('mktg-portrait-back-cover-line')).toHaveText(kit.chapters.voice.line);
    await expect(back.getByTestId('mktg-portrait-back-cover-url')).toHaveText('one.example.org');
    await expect(back.getByTestId('mktg-portrait-back-cover-version')).toHaveText('V1.0 · October 2026');
    await expect(back.getByTestId('mktg-portrait-back-cover-notice')).toBeVisible();
    await expect(back.getByTestId('mktg-portrait-back-cover-line')).toHaveCSS('font-family', face);
    await expect(back.getByTestId('mktg-portrait-back-cover-notice')).toHaveCSS('font-family', face);
    await expect(back.getByTestId('mktg-portrait-page-foot')).toHaveCount(0);
    await back.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('back-cover.png'), fullPage: true });
  });

  test('numbers the content pages from the plan, once each, ending at Sources & decisions 15 (the back cover is not listed), and says what the kit is built from without a file name', async ({
    page,
  }, info) => {
    const { pages } = await openBook(page);
    const contents = pages.nth(1);
    const rows = contents.getByTestId('brand-kit-contents-row');
    await expect(rows).toHaveCount(13);
    await expect(rows.first()).toHaveText(/^Logo system\s*3$/);
    await expect(rows.last()).toHaveText(/^Sources & decisions\s*15$/);
    await expect(contents).not.toContainText('Back cover');
    // The At a glance card ends with its content: no fixed height on it.
    await expect(contents.getByTestId('brand-kit-contents-glance')).toHaveCSS('height', /^(?!270px).*/);
    await expect(contents.getByTestId('brand-kit-contents-built-from')).not.toContainText('.svg');
    // The approval line stays on the contents page (the ruling); the fixture's approval has a date and no approver.
    await expect(contents.getByTestId('brand-kit-contents-approval')).toHaveText('Approved 19 Oct 2026');
    await expect(contents).not.toContainText('Version');
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
    await expect(matrix.getByTestId('brand-kit-contrast-matrix-same')).toHaveCount(4);
    const charcoal = matrix.locator('tbody tr').first().getByTestId('brand-kit-contrast-matrix-cell');
    await expect(charcoal).toHaveCount(3);
    for (const cell of await charcoal.all()) {
      await expect(cell).toHaveAttribute('data-ratio', /^\d+\.\d$/);
    }
    // Charcoal on White, 8.35:1, is labelled to one decimal cut (8.3) and graded raw.
    await expect(charcoal.first()).toHaveAttribute('data-ratio', '8.3');
    await expect(charcoal.first().getByTestId('brand-kit-contrast-grade')).toHaveText('AAA');
    const pairs = contrast.getByTestId('brand-kit-contrast-pairs');
    expect(await placement(contrast, pairs)).toEqual({ x: 56, y: 610, width: 704 });
    // One pair, cell by cell (the cells abut in textContent).
    await expect(pairs.getByTestId('brand-kit-contrast-pair')).toHaveCount(1);
    await expect(pairs.getByTestId('brand-kit-contrast-pair-names')).toHaveText('Charcoal on White');
    await expect(pairs.getByTestId('brand-kit-contrast-pair-ratio')).toHaveText('8.3:1');
    await expect(pairs.getByTestId('brand-kit-contrast-pair').getByTestId('brand-kit-contrast-grade')).toHaveText('AAA');
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
    // The specimen is set at the mock's 48 px always; a line that would not fit the column is shortened to the words
    // that do, with an ellipsis (the editor: shorten, never shrink; never a bare cut): the fixture's line in Montserrat
    // loses its last word.
    await expect(h1).toHaveText('Open standards for one…');
    expect(kit.chapters.voice.line.startsWith('Open standards for one ')).toBe(true);
    await expect(h1).toHaveCSS('font-family', new RegExp(`^"?${kit.chapters.type.family}"?`));
    await expect(h1).toHaveCSS('font-size', '48px');
    expect(await h1.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect(await placement(type, type.getByTestId('brand-kit-type-specimen'))).toEqual({ x: 56, y: 212, width: 704 });
    expect(await placement(type, type.getByTestId('brand-kit-type-scale'))).toEqual({ x: 56, y: 436, width: 704 });
    const steps = type.getByTestId('brand-kit-type-scale').locator('[data-step]');
    await expect(steps).toHaveCount(kit.chapters.type.scale.length);
    // "At real size": every step's sample is set at the kit's own size and leading, and its spec column prints them
    // (`500 · 64/72`); a sample that would not fit its measure is shortened, never shrunk.
    for (const [index, step] of kit.chapters.type.scale.entries()) {
      await expect(steps.nth(index).getByTestId('brand-kit-type-scale-spec')).toHaveText(`${step.weight} · ${step.size}/${step.line_height}`);
      await expect(steps.nth(index).getByTestId('brand-kit-type-scale-sample')).toHaveCSS('font-size', `${step.size}px`);
      await expect(steps.nth(index).getByTestId('brand-kit-type-scale-sample')).toHaveCSS('line-height', `${step.line_height}px`);
    }
    // The lower blocks sit under the scale's real end, never on it: both at one y, at least 16 px below the last row.
    const scaleBox = await type.getByTestId('brand-kit-type-scale').boundingBox();
    const source = await placement(type, type.getByTestId('brand-kit-type-source'));
    const rules = await placement(type, type.getByTestId('brand-kit-type-rules'));
    const typeBox = await type.boundingBox();
    if (!scaleBox || !typeBox) throw new Error('The type page must be laid out');
    expect(source.y).toBeGreaterThanOrEqual(Math.round(scaleBox.y + scaleBox.height - typeBox.y) + 16);
    expect(source.y).toBe(rules.y);
    expect(source.y).toBeGreaterThanOrEqual(830);
    // The kit's own record names the project (the fixture's sidecar says Project One; the head carries the context's name).
    await expect(steps.first().getByTestId('brand-kit-type-scale-sample')).toHaveText(kit.projectName);
    await expect(steps.nth(4).getByTestId('brand-kit-type-scale-sample')).toHaveText(kit.chapters.voice.umbrella);
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
    await expect(imagery.getByTestId('brand-kit-imagery-elements').getByTestId('brand-kit-imagery-element')).toHaveCount(3);
    await expect(imagery.locator('[data-testid="brand-kit-imagery-element"][data-element="callout"]')).toHaveCSS('background-color', rgb(kit.kit.accent));
    await expect(imagery.locator('[data-testid="brand-kit-imagery-element"][data-element="callout"]')).toHaveCSS('color', rgb(kit.kit.dark));
    await expect(imagery.getByTestId('brand-kit-imagery-callout-caption')).toContainText('text in Charcoal (white on Orange fails AA, 2.8:1)');
    await expect(imagery.getByTestId('brand-kit-imagery-avoid').locator('li')).toHaveText(kit.chapters.visual.imagery.avoid);
    // On paper the ground's glow prints at the stronger alpha (the editor's p13): the print token, not the screen's.
    // (0x88 = 0.533 alpha on the kit's accent, as the engine serializes the gradient.)
    await expect(imagery.getByTestId('brand-kit-imagery-grid-ground')).toHaveCSS('background-image', /rgba\(243, 118, 37, 0\.53\d*\)/);
    const usage = pages.nth(12);
    const cards = usage.getByTestId('brand-kit-usage-cards').getByTestId('brand-kit-usage-card');
    await expect(cards).toHaveCount(4);
    for (const card of await cards.all()) {
      const box = await card.getByTestId('brand-kit-usage-frame').boundingBox();
      expect(box && { width: Math.round(box.width), height: Math.round(box.height) }).toEqual({ width: 344, height: 210 });
    }
    await expect(cards.nth(1).getByTestId('brand-kit-usage-frame')).toHaveCSS('background-color', rgb(kit.kit.accent));
    await expect(cards.nth(1).getByTestId('brand-kit-usage-frame')).toHaveCSS('color', rgb(kit.kit.dark));
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
    await expect(voice.getByTestId('brand-kit-voice-umbrella')).toHaveText(kit.chapters.voice.umbrella);
    await expect(voice.getByTestId('brand-kit-voice-line')).toHaveText(kit.chapters.voice.line);
    expect(await placement(voice, voice.getByTestId('brand-kit-voice-attributes'))).toEqual({ x: 56, y: 540, width: 704 });
    await expect(voice.getByTestId('brand-kit-voice-attribute-name')).toHaveText(kit.chapters.voice.attributes.map((attribute) => attribute.name));
    await expect(voice).not.toContainText('Avoid');
    const sources = pages.nth(14);
    await expect(sources.getByTestId('brand-kit-sources-read').locator('li')).toHaveText(['one.example.org']);
    await expect(sources.getByTestId('brand-kit-sources-failed')).toHaveCount(0);
    await expect(sources.getByTestId('brand-kit-sources-missing')).toHaveCount(0);
    await expect(sources.getByTestId('brand-kit-sources-conflicts')).toHaveCount(0);
    // The accepted box prints with any recorded approval (the ruling), the approver's name only when the store has one.
    await expect(sources.getByTestId('brand-kit-sources-accepted')).toContainText('Accepted when V1.0 was approved. Approved 19 Oct 2026.');
    await expect(sources.getByTestId('brand-kit-sources-accepted')).not.toContainText(' by ');
    await expect(sources).not.toContainText('https://');
    await sources.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('sources.png'), fullPage: false });
  });

  test('with a recorded approver, prints the approval line on the contents page and the accepted box on the Sources page', async ({ page }, info) => {
    const { pages } = await openBook(page, approvedByNameResponse());
    await expect(pages.nth(1).getByTestId('brand-kit-contents-approval')).toHaveText('Approved 6 Nov 2026 by Synthetic Approver');
    const accepted = pages.nth(14).getByTestId('brand-kit-sources-accepted');
    expect(await placement(pages.nth(14), accepted)).toEqual({ x: 56, y: 880, width: 704 });
    await expect(accepted).toContainText('Accepted when V1.0 was approved. Approved 6 Nov 2026 by Synthetic Approver. Every item above was shown at approval');
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
    await expect(pages.nth(1).getByTestId('brand-kit-contents-row')).toHaveCount(9);
    await pages.nth(2).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('logo-system-no-files.png'), fullPage: false });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });

  test('the print document is its frames and nothing else: the root as tall as its pages, no box after the last frame, no break after it', async ({
    page,
  }, info) => {
    const { book, pages } = await openBook(page);
    const count = await pages.count();
    // The root's height is exactly the frames' (17 × 1056): any extra px would be one more sheet in Chrome's Save as PDF.
    // Boxes are read with getBoundingClientRect: the print frame is hidden in the app (0 × 0), where the body's
    // scrollHeight reads 0 whatever it holds, while the laid-out boxes keep their size.
    const heights = await book.evaluate((root) => {
      // Every frame is the only one of its type inside its own host, so `:last-of-type` would match each of them (the
      // first in document order wins): the last frame is the last of the whole list.
      const frames = root.querySelectorAll('[data-testid="lfx-mktg-portrait-page"]');
      const last = frames[frames.length - 1];
      if (!last) throw new Error('The book must hold a frame');
      let after = 0;
      let node: Element | null = last;
      while (node && node !== root) {
        let sibling = node.nextElementSibling;
        while (sibling) {
          after += 1;
          sibling = sibling.nextElementSibling;
        }
        node = node.parentElement;
      }
      const top = root.getBoundingClientRect().top;
      const bottom = (element: Element) => Math.round(element.getBoundingClientRect().bottom - top);
      return { root: Math.round(root.getBoundingClientRect().height), lastFrame: bottom(last), body: bottom(root.ownerDocument.body), after };
    });
    expect(heights.root).toBe(count * 1056);
    expect(heights.lastFrame).toBe(count * 1056);
    // The body's box ends where the frames end: nothing under the root adds a sheet.
    expect(heights.body).toBeLessThanOrEqual(count * 1056);
    expect(heights.after).toBe(0);
    await expect(pages.last()).toHaveCSS('break-after', 'auto');
    // One named page in the print, the frames' own: the root and the body name none (a change of name forces a break).
    await expect(book).toHaveCSS('page', 'auto');
    await expect(book.locator('xpath=/ancestor::body')).toHaveCSS('page', 'auto');
    // Every host between the body and a frame is a block: Chrome 156 breaks a sheet at the anonymous-block boundary an
    // inline host puts around a frame (the blank sheet 18 the editor saw).
    const inlineHosts = await book.evaluate((root: HTMLElement) => {
      const hosts = [root, ...Array.from(root.querySelectorAll<HTMLElement>('[data-testid="lfx-mktg-portrait-page"]'))].flatMap((frame) => {
        const chain: HTMLElement[] = [];
        for (let node: HTMLElement | null = frame; node && node.tagName !== 'BODY'; node = node.parentElement) chain.push(node);
        return chain;
      });
      return Array.from(new Set(hosts))
        .filter((node) => getComputedStyle(node).display !== 'block')
        .map((node) => `${node.tagName.toLowerCase()}: ${getComputedStyle(node).display}`);
    });
    expect(inlineHosts).toEqual([]);
    await pages.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('last-frame.png'), fullPage: false });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });

  test('Google Chrome saves exactly the planned frames on Letter and on A4, none blank, no header or footer on the sheet, in every dialog variant', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'The proof is the Chrome engine; one run of it is enough');
    const { frame, pages } = await openBook(page);
    const planned = await pages.count();
    const prints = await printMktgFrameWithChrome(frame);
    test.skip(prints.length === 0, 'Google Chrome is not installed here; the bundled Chromium does not reproduce the blank sheet');
    expect(prints).toHaveLength(8);
    for (const print of prints) {
      const label = `${print.paper} headers ${print.headers} background ${print.background}`;
      // The paper is the page box (the grammar's `size: auto`), never a Letter box scaled onto A4.
      const paper = MKTG_PORTRAIT_PAPERS[print.paper === 'A4' ? 'a4' : 'letter'];
      expect(print.box.width, label).toBeCloseTo(paper.width, 0);
      expect(print.box.height, label).toBeCloseTo(paper.height, 0);
      expect(print.pages, label).toBe(planned);
      expect(print.blank, label).toEqual([]);
      // The browser's header (date · title) and footer (url · n/N) never reach the sheet: a page's text with them on is
      // its text with them off.
      const off = prints.find((other) => other.paper === print.paper && other.background === print.background && !other.headers);
      expect(print.text, label).toEqual(off?.text);
    }
    await finishMktgPrintFrame(page);
  });

  test('a kit with PNG uploads only lists them in the Logo system files table under a line saying the book draws SVG only, never "no logo files uploaded yet"', async ({
    page,
  }, info) => {
    const { pages, book } = await openBook(page, pngOnlyResponse());
    const ids = await pages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-id')));
    expect(ids).toEqual(PAGES.filter((id) => !id.startsWith('logo-') || id === 'logo-system'));
    const logoSystem = pages.nth(2);
    await expect(logoSystem.getByTestId('brand-kit-logo-system-none')).toHaveCount(0);
    await expect(logoSystem.getByTestId('brand-kit-logo-system-undrawable')).toHaveText(
      'This book draws inline SVG artwork only. The supplied horizontal lockup (PNG) and symbol (PNG) are listed below and not drawn here.'
    );
    const rows = logoSystem.getByTestId('brand-kit-logo-system-files').locator('tbody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText('PNG');
    await expect(rows.nth(0)).toContainText('Supplied');
    await expect(rows.nth(2)).toContainText('Supplied');
    await expect(book.locator('img')).toHaveCount(0);
    await expect(book).not.toContainText('.png');
    await logoSystem.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('logo-system-png-only.png'), fullPage: false });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });

  test('a kit with a stacked lockup only keeps the Logo chapter’s first page alone: no Colorways, Clear space, Partnership or Watchouts tiles it cannot draw', async ({
    page,
  }, info) => {
    const { pages, book } = await openBook(page, stackedOnlyResponse());
    const ids = await pages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-id')));
    expect(ids).toEqual(PAGES.filter((id) => !id.startsWith('logo-') || id === 'logo-system'));
    await expect(pages.nth(1).getByTestId('brand-kit-contents-row')).toHaveCount(ids.length - 3);
    // A negative check over the grammar's tile class (no element to name): no tile anywhere in the book is empty.
    await expect(book.locator('.pp-tile:empty')).toHaveCount(0);
    await pages.nth(2).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('logo-system-stacked-only.png'), fullPage: false });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });

  test('the overfull record (five colours, 300-character lines, twenty sources, six conflicts) prints every page bounded: nothing past the footer line, the rest counted in "+N more" lines', async ({
    page,
  }, info) => {
    const { pages } = await openBook(page, fixtureResponse(brandKitOverfullFixture()));
    await expect(pages).toHaveCount(PAGES.length);
    // Every content page's placed boxes end above the footer line (y 990 of 1056); the footer itself sits under it.
    for (const index of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      const frame = pages.nth(index);
      expect(await endsAbove(frame, frame.locator('[data-pp-rect]'), 1000), `page ${index + 1} runs past the footer`).toBe(true);
    }
    // The contrast page: a five-row matrix, the pairs in flow under it, the pairs the room cannot hold counted.
    const contrast = pages.nth(8);
    await expect(contrast.getByTestId('brand-kit-contrast-matrix').locator('tbody tr')).toHaveCount(5);
    await expect(contrast.getByTestId('brand-kit-contrast-pairs-more')).toHaveText(/^\+\d+ more pairs, in LFX One$/);
    // The voice page: the messages set smaller above the attributes, the attributes smaller in their grid.
    const voice = pages.nth(13);
    const fit = await voice.getByTestId('brand-kit-voice-messages').evaluate((node) => Number(node.style.getPropertyValue('--kp-fit')));
    expect(fit).toBeLessThan(1);
    // The Sources page: twenty sources read and six conflicts, listed or counted, with the accepted box in place.
    const sources = pages.nth(14);
    await expect(sources.getByTestId('brand-kit-sources-read').locator('li')).not.toHaveCount(0);
    await expect(sources.getByTestId('brand-kit-sources-conflicts').locator('table')).not.toHaveCount(0);
    // The conflicts' last row ends above the accepted box (the fit measures the rows as drawn); nothing runs under it.
    const acceptedTop = await sources.getByTestId('brand-kit-sources-accepted').evaluate((node) => node.getBoundingClientRect().top);
    const conflictsBottom = await sources.getByTestId('brand-kit-sources-conflicts').evaluate((node) => node.getBoundingClientRect().bottom);
    expect(conflictsBottom).toBeLessThanOrEqual(acceptedTop);
    await contrast.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('overfull-contrast.png'), fullPage: false });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });

  test('the minimal record (four colours, one logo, no pairs, no conflicts, an empty run record) prints the sixteen pages with its empty slots dropped and the Sources page saying the run recorded nothing', async ({
    page,
  }, info) => {
    const { pages, book } = await openBook(page, fixtureResponse(brandKitMinimalFixture()));
    await expect(pages).toHaveCount(PAGES.length);
    await expect(pages.nth(8).getByTestId('brand-kit-contrast-pairs')).toHaveCount(0);
    await expect(pages.nth(8).getByTestId('brand-kit-contrast-matrix').locator('tbody tr')).toHaveCount(4);
    const sources = pages.nth(14);
    await expect(sources.getByTestId('brand-kit-sources-empty')).toContainText('The run recorded no sources');
    await expect(sources.getByTestId('brand-kit-sources-read')).toHaveCount(0);
    await expect(sources.getByTestId('brand-kit-sources-conflicts')).toHaveCount(0);
    await expect(book).not.toContainText(/\[[^\]]+\]/);
    await sources.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('minimal-sources.png'), fullPage: false });
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
