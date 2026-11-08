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
import {
  BRAND_KIT_FIXTURE_LOCKUP_SVG,
  brandKitMinimalFixture,
  brandKitOverfullFixture,
  brandKitTestRevision,
} from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import type { BrandKitRevision } from '@lfx-one/shared/interfaces';
import { buildBrandKitBookView } from '@lfx-one/shared/utils/brand-kit-book.utils';
import { brandKitPortraitAccentMoment } from '@lfx-one/shared/utils/brand-kit-portrait.utils';
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

/** The approved kit with a three-colour symbol file beside its lockup: a Symbol page whose dark shapes cannot reverse the mark. */
function threeColourSymbolResponse(): MktgRevisionResponse {
  const base = columnAssetRevisionResponse('brand-kit');
  const sidecar = base.sidecar as { chapters: { logo: { files: Record<string, unknown> } } };
  const symbol = { ref: 'symbol.svg', svg: BRAND_KIT_FIXTURE_LOCKUP_SVG };
  const logo = { ...sidecar.chapters.logo, files: { ...sidecar.chapters.logo.files, symbol } };
  return { ...base, sidecar: { ...sidecar, chapters: { ...sidecar.chapters, logo } } as MktgRevisionResponse['sidecar'] };
}

/** The approved kit with a square-ish, one-ink symbol (a 60 × 60 disc, aspect 1): the four shapes as today, no wide note. */
function squareSymbolResponse(): MktgRevisionResponse {
  const base = columnAssetRevisionResponse('brand-kit');
  const sidecar = base.sidecar as { chapters: { logo: { files: Record<string, unknown> } } };
  const symbol = { ref: 'disc.svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60"><circle cx="30" cy="30" r="28" fill="#4D4E4E"/></svg>' };
  const logo = { ...sidecar.chapters.logo, files: { ...sidecar.chapters.logo.files, symbol } };
  return { ...base, sidecar: { ...sidecar, chapters: { ...sidecar.chapters, logo } } as MktgRevisionResponse['sidecar'] };
}

/** The approved kit whose only lockup file is the reversed one (no primary): the dark tile draws it; the hero has nothing. */
function reversedOnlyResponse(): MktgRevisionResponse {
  const base = columnAssetRevisionResponse('brand-kit');
  const sidecar = base.sidecar as { chapters: { logo: { files: Record<string, unknown> } } };
  const files = { ...sidecar.chapters.logo.files, primary: null, reversed: { ref: 'reversed.svg', svg: BRAND_KIT_FIXTURE_LOCKUP_SVG } };
  const logo = { ...sidecar.chapters.logo, files };
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
function fixtureResponse(kit: BrandKitRevision, projectName = kit.projectName): MktgRevisionResponse {
  const base = columnAssetRevisionResponse('brand-kit');
  const sidecar = base.sidecar as Record<string, unknown>;
  return {
    ...base,
    sidecar: { ...sidecar, project_name: projectName, kit: kit.kit, chapters: kit.chapters, report: kit.report } as MktgRevisionResponse['sidecar'],
  };
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
async function openBook(
  page: Page,
  response = columnAssetRevisionResponse('brand-kit'),
  project = ASSET_PROJECT
): Promise<{ frame: FrameLocator; book: Locator; pages: Locator }> {
  await stubMktgPrintFrame(page);
  await openAssetDocument(page, 'brand-kit', 200, true, false, response, project);
  await page.getByTestId('brand-kit-web-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, BRAND_KIT_PRINT_BODY_CLASS, 'lfx-mktg-brand-kit-print');
  const frame = await layoutMktgPrintFrame(page);
  const book = frame.getByTestId('mktg-brand-kit-print');
  await expect(book).toBeVisible();
  return { frame, book, pages: book.getByTestId('lfx-mktg-portrait-page') };
}

/** The book's frame for a plan page, found by its `data-page-id` (never by index: the plan drops the pages a record has no facts for). */
function pageById(pages: Locator, id: (typeof PAGES)[number]): Locator {
  // `and` keeps the frame of its receiver, so the argument's own frame does not matter.
  return pages.and(pages.page().locator(`[data-page-id="${id}"]`));
}

/** The Watch-outs' tiles are three equal fixed columns: every tile the width of the first, within a pixel. */
async function expectEqualWatchoutColumns(watchouts: Locator): Promise<void> {
  const tiles = await watchouts.getByTestId('brand-kit-watchout').all();
  expect(tiles.length).toBeGreaterThanOrEqual(3);
  const widths = await Promise.all(tiles.map(async (tile) => (await tile.boundingBox())?.width ?? 0));
  for (const width of widths) expect(Math.abs(width - widths[0])).toBeLessThan(1);
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
    await expect(pageById(pages, 'logo-system').getByTestId('mktg-portrait-page-section')).toHaveCSS('color', rgb(mktgPortraitAccentText(kit.kit.accent)));
    await expect(pageById(pages, 'logo-colorways').getByTestId('mktg-portrait-page-section')).toHaveCSS('color', rgb(kit.kit.dark));
    const heads = pages.getByTestId('mktg-portrait-page-doc');
    await expect(heads).toHaveCount(14);
    await expect(heads.first()).toHaveText('Asset Example brand kit');
    // The version (the approved revision's number: V1.0 here) is on the cover and the back cover only: not on the contents
    // page, not in a running head.
    await expect(pageById(pages, 'contents')).not.toContainText('V1.0');
    await expect(pageById(pages, 'logo-colorways')).not.toContainText('V1.0');
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
    await expect(pageById(pages, 'logo-system').getByTestId('brand-kit-logo-system-intro')).toHaveCSS('font-family', face);
    await expect(pageById(pages, 'logo-colorways').getByTestId('brand-kit-colorways-intro')).toHaveCSS('font-family', face);
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
    // The Watch-outs' six tiles sit in three equal columns.
    await expectEqualWatchoutColumns(pageById(pages, 'logo-watchouts'));
    await back.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('back-cover.png'), fullPage: true });
  });

  test('numbers the content pages from the plan, once each, ending at Sources & decisions 15 (the back cover is not listed), and says what the kit is built from without a file name', async ({
    page,
  }, info) => {
    const { pages } = await openBook(page);
    const contents = pageById(pages, 'contents');
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
    const contrast = pageById(pages, 'color-contrast');
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
    const type = pageById(pages, 'type');
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
    const imagery = pageById(pages, 'visual-imagery');
    expect(await placement(imagery, imagery.getByTestId('brand-kit-imagery-ground'))).toEqual({ x: 56, y: 220, width: 704 });
    await expect(imagery.getByTestId('brand-kit-imagery-elements').getByTestId('brand-kit-imagery-element')).toHaveCount(3);
    // The call-out is inked by the shared rule: no palette colour reaches AA on this kit's Orange (Charcoal 2.9:1,
    // White 2.8:1, Mid gray 1.6:1), so the card keeps a white ground, Charcoal text and the accent as its 6 px top
    // rule, and the caption says why.
    const callout = imagery.locator('[data-testid="brand-kit-imagery-element"][data-element="callout"]');
    await expect(callout).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(callout).toHaveCSS('color', rgb(kit.kit.dark));
    await expect(callout).toHaveCSS('border-top-color', rgb(kit.kit.accent));
    await expect(callout).toHaveCSS('border-top-width', '6px');
    await expect(imagery.getByTestId('brand-kit-imagery-callout-caption')).toContainText(
      'the accent as a top rule; no palette color reaches AA on Orange (Charcoal 2.9:1 at best)'
    );
    await expect(imagery.getByTestId('brand-kit-imagery-avoid').locator('li')).toHaveText(kit.chapters.visual.imagery.avoid);
    // On paper the ground's glow prints at the stronger alpha (the editor's p13): the print token, not the screen's.
    // (0x88 = 0.533 alpha on the kit's accent, as the engine serializes the gradient.)
    await expect(imagery.getByTestId('brand-kit-imagery-grid-ground')).toHaveCSS('background-image', /rgba\(243, 118, 37, 0\.53\d*\)/);
    const usage = pageById(pages, 'usage');
    const cards = usage.getByTestId('brand-kit-usage-cards').getByTestId('brand-kit-usage-card');
    await expect(cards).toHaveCount(4);
    for (const card of await cards.all()) {
      const box = await card.getByTestId('brand-kit-usage-frame').boundingBox();
      expect(box && { width: Math.round(box.width), height: Math.round(box.height) }).toEqual({ width: 344, height: 210 });
    }
    // The social card is the kit's one accent moment, resolved by the shared rule from the kit's own contrast: this
    // kit's palette has no AA ink on Orange, so the card is white with the accent as a 6 px top rule, the text in the
    // dark, and the full-colour lockup sits on it as on any white ground (no "No logo on the accent" note).
    const moment = brandKitPortraitAccentMoment(buildBrandKitBookView(kit));
    expect(moment.ground).toBe('white');
    const social = cards.nth(1).getByTestId('brand-kit-usage-frame');
    await expect(social).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(social).toHaveCSS('color', rgb(moment.ink));
    await expect(social).toHaveCSS('border-top-color', rgb(kit.kit.accent));
    await expect(social).toHaveCSS('border-top-width', '6px');
    await expect(social.getByTestId('brand-kit-artwork-lockup')).toHaveCount(1);
    await expect(social.getByTestId('brand-kit-usage-social-note')).toHaveCount(0);
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
    const voice = pageById(pages, 'voice');
    await expect(voice.getByTestId('brand-kit-voice-intro')).toHaveText('From the messaging framework. As they are.');
    await expect(voice.getByTestId('brand-kit-voice-umbrella')).toHaveText(kit.chapters.voice.umbrella);
    await expect(voice.getByTestId('brand-kit-voice-line')).toHaveText(kit.chapters.voice.line);
    expect(await placement(voice, voice.getByTestId('brand-kit-voice-attributes'))).toEqual({ x: 56, y: 540, width: 704 });
    await expect(voice.getByTestId('brand-kit-voice-attribute-name')).toHaveText(kit.chapters.voice.attributes.map((attribute) => attribute.name));
    await expect(voice).not.toContainText('Avoid');
    const sources = pageById(pages, 'sources');
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
    await expect(pageById(pages, 'contents').getByTestId('brand-kit-contents-approval')).toHaveText('Approved 6 Nov 2026 by Synthetic Approver');
    const accepted = pageById(pages, 'sources').getByTestId('brand-kit-sources-accepted');
    expect(await placement(pageById(pages, 'sources'), accepted)).toEqual({ x: 56, y: 880, width: 704 });
    await expect(accepted).toContainText('Accepted when V1.0 was approved. Approved 6 Nov 2026 by Synthetic Approver. Every item above was shown at approval');
    await pageById(pages, 'sources').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('sources-accepted.png'), fullPage: false });
  });

  test('a kit without logo files keeps one Logo page saying no files were uploaded, drops the logo pages that need them, and prints no empty frame', async ({
    page,
  }, info) => {
    const { pages, book } = await openBook(page, noLogoFilesResponse());
    const ids = await pages.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-id')));
    expect(ids).toEqual(PAGES.filter((id) => !id.startsWith('logo-') || id === 'logo-system'));
    await expect(pageById(pages, 'logo-system').getByTestId('brand-kit-logo-system-none')).toHaveText('No logo files uploaded yet');
    await expect(pageById(pages, 'logo-system').getByTestId('brand-kit-logo-system-files')).toHaveCount(0);
    await expect(book.locator('img')).toHaveCount(0);
    await expect(book).not.toContainText('SVG supplied');
    await expect(pageById(pages, 'contents').getByTestId('brand-kit-contents-row')).toHaveCount(9);
    await pageById(pages, 'logo-system').scrollIntoViewIfNeeded();
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
      // Chrome reports its A4 page box as 794.56 × 1122.5 CSS px against 210 × 297 mm's 793.70 × 1122.52, and Letter
      // as 816 × 1056 exactly: within 2 px of the paper's own box on both axes; a Letter box scaled onto A4 would be
      // 22 px off in width and 70 px in height, so the tolerance still proves the paper.
      expect(Math.abs(print.box.width - paper.width), label).toBeLessThan(2);
      expect(Math.abs(print.box.height - paper.height), label).toBeLessThan(2);
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
    const logoSystem = pageById(pages, 'logo-system');
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
    await expect(pageById(pages, 'contents').getByTestId('brand-kit-contents-row')).toHaveCount(ids.length - 3);
    // A negative check over the grammar's tile class (no element to name): no tile anywhere in the book is empty.
    await expect(book.locator('.pp-tile:empty')).toHaveCount(0);
    await pageById(pages, 'logo-system').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('logo-system-stacked-only.png'), fullPage: false });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });

  test('a three-colour, wide symbol draws on the plate in rounded squares only, inside each shape, and says so', async ({ page }, info) => {
    // The 120 × 36 lockup as the symbol: three colours (so a plate on the dark ground, captioned "full color on a plate",
    // never "reversed") and wide (aspect 3.33), so the circle, which would cut it, is skipped and the note says so.
    const { pages } = await openBook(page, threeColourSymbolResponse());
    const symbol = pageById(pages, 'logo-symbol');
    const shapes = symbol.getByTestId('brand-kit-symbol-shapes').locator('> div');
    await expect(shapes).toHaveCount(3);
    await expect(shapes.nth(0).locator('.pp-cap')).toHaveText('Rounded square · full color on a plate');
    await expect(shapes.nth(1).locator('.pp-cap')).toHaveText('Rounded square · light tint');
    await expect(shapes.nth(2).locator('.pp-cap')).toHaveText('Rounded square · white');
    await expect(symbol.getByTestId('brand-kit-symbol-wide-note')).toHaveText('Wide symbol: shown in a rounded square only');
    await expect(shapes.nth(0).getByTestId('mktg-portrait-plate')).toHaveCount(1);
    await expect(symbol.getByTestId('mktg-portrait-plate')).toHaveCount(2);
    // The wide mark is sized down so its plate (dark square) and its bare mark (tint and white squares) sit INSIDE each
    // shape's inner box (the square less a fifth of its side each way), never a band cut by the shape or close to its
    // edge; in the padding demo, inside the dashed X box.
    const inside = (
      inner: { x: number; y: number; width: number; height: number } | null,
      outer: { x: number; y: number; width: number; height: number } | null
    ): boolean =>
      !!inner &&
      !!outer &&
      inner.x >= outer.x - 0.5 &&
      inner.y >= outer.y - 0.5 &&
      inner.x + inner.width <= outer.x + outer.width + 0.5 &&
      inner.y + inner.height <= outer.y + outer.height + 0.5;
    const innerBox = (shape: { x: number; y: number; width: number; height: number } | null): typeof shape =>
      shape && { x: shape.x + shape.width / 5, y: shape.y + shape.height / 5, width: (shape.width * 3) / 5, height: (shape.height * 3) / 5 };
    for (const index of [0, 1, 2]) {
      const shape = await shapes.nth(index).locator('.kp-shape').boundingBox();
      const drawn = await shapes
        .nth(index)
        .locator(index === 0 ? '[data-testid="mktg-portrait-plate"]' : 'img')
        .boundingBox();
      expect(inside(drawn, innerBox(shape))).toBe(true);
    }
    const demo = symbol.getByTestId('brand-kit-symbol-padding');
    expect(inside(await demo.getByTestId('mktg-portrait-plate').boundingBox(), await demo.locator('.kp-padding-demo-inset').boundingBox())).toBe(true);
    await expect(symbol.getByTestId('brand-kit-symbol-shapes')).not.toContainText('reversed');
    // The variant tiles stay honest too: "Not supplied" under the Reversed and One-color labels.
    await expect(symbol.getByTestId('brand-kit-symbol-variant-missing')).toHaveCount(2);
    await symbol.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('logo-symbol-plated-shapes.png'), fullPage: false });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });

  test('a square-ish symbol keeps the four shapes, the circle first, and no wide note', async ({ page }, info) => {
    const { pages } = await openBook(page, squareSymbolResponse());
    const symbol = pageById(pages, 'logo-symbol');
    const shapes = symbol.getByTestId('brand-kit-symbol-shapes').locator('> div');
    await expect(shapes).toHaveCount(4);
    await expect(shapes.nth(0).locator('.pp-cap')).toHaveText('Circle · reversed');
    await expect(symbol.getByTestId('brand-kit-symbol-wide-note')).toHaveCount(0);
    await expect(symbol.getByTestId('mktg-portrait-plate')).toHaveCount(0);
    await symbol.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('logo-symbol-square-shapes.png'), fullPage: false });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });

  test('a reversed-only kit (no primary file) draws its dark tile from the reversed file: no hero, no empty tiles row', async ({ page }, info) => {
    const { pages } = await openBook(page, reversedOnlyResponse());
    const system = pageById(pages, 'logo-system');
    await expect(system.getByTestId('brand-kit-logo-system-hero')).toHaveCount(0);
    const tiles = system.getByTestId('brand-kit-logo-system-tiles');
    await expect(tiles.locator('.pp-tile')).toHaveCount(1);
    await expect(tiles.locator('.pp-tile--dark img')).toHaveAttribute('alt', 'Reversed lockup');
    await expect(tiles.getByTestId('mktg-portrait-plate')).toHaveCount(0);
    await expect(tiles).toContainText('Reversed · supplied file');
    await expect(system.getByTestId('brand-kit-logo-system-undrawable')).toHaveCount(0);
    // The pages drawn from the primary file (Clear space, Partnership, Watch-outs) are dropped by the plan; the
    // Colorways page keeps its reversed tile; the covers draw the reversed file on the dark.
    await expect(pageById(pages, 'logo-clear-space')).toHaveCount(0);
    await expect(pageById(pages, 'logo-partnership')).toHaveCount(0);
    await expect(pageById(pages, 'logo-watchouts')).toHaveCount(0);
    const colorways = pageById(pages, 'logo-colorways').getByTestId('brand-kit-colorways-tiles');
    await expect(colorways.locator('img')).toHaveCount(1);
    await expect(colorways.getByTestId('brand-kit-colorway-missing')).toHaveCount(3);
    await expect(pageById(pages, 'cover').getByTestId('mktg-portrait-cover-logo')).toHaveCount(1);
    await expect(pageById(pages, 'cover').getByTestId('mktg-portrait-plate')).toHaveCount(0);
    await system.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('logo-system-reversed-only.png'), fullPage: false });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });

  test('the overfull record (five colours, 300-character lines, twenty sources, six conflicts) prints every page bounded: nothing past the footer line, the rest counted in "+N more" lines', async ({
    page,
  }, info) => {
    // The record's project carries a name long enough to overfill the cover strip (S8/K3) and to need the retyped
    // sample's size step (E3), in the kit's sidecar and the project context alike; the synthetic project is otherwise
    // `ASSET_PROJECT`.
    const overfullProject = { ...ASSET_PROJECT, name: 'Cloud Native Computing Foundation (CNCF)' };
    const { pages } = await openBook(page, fixtureResponse(brandKitOverfullFixture(), overfullProject.name), overfullProject);
    await expect(pages).toHaveCount(PAGES.length);
    // Every content page's placed boxes end above the footer line (y 990 of 1056); the footer itself sits under it.
    for (const id of PAGES.slice(2, -1)) {
      const frame = pageById(pages, id);
      expect(await endsAbove(frame, frame.locator('[data-pp-rect]'), 1000), `${id} runs past the footer`).toBe(true);
    }
    // The contrast page: a five-row matrix, the pairs in flow under it, the pairs the room cannot hold counted.
    const contrast = pageById(pages, 'color-contrast');
    await expect(contrast.getByTestId('brand-kit-contrast-matrix').locator('tbody tr')).toHaveCount(5);
    await expect(contrast.getByTestId('brand-kit-contrast-pairs-more')).toHaveText(/^\+\d+ more pairs, in LFX One$/);
    // The voice page: the messages set smaller above the attributes, the attributes smaller in their grid.
    const voice = pageById(pages, 'voice');
    const fit = await voice.getByTestId('brand-kit-voice-messages').evaluate((node) => Number(node.style.getPropertyValue('--kp-fit')));
    expect(fit).toBeLessThan(1);
    // The Sources page: twenty sources read and six conflicts, listed or counted, with the accepted box in place.
    const sources = pageById(pages, 'sources');
    await expect(sources.getByTestId('brand-kit-sources-read').locator('li')).not.toHaveCount(0);
    await expect(sources.getByTestId('brand-kit-sources-conflicts').locator('table')).not.toHaveCount(0);
    // The conflicts' last row ends above the accepted box (the fit measures the rows as drawn); nothing runs under it.
    const acceptedTop = await sources.getByTestId('brand-kit-sources-accepted').evaluate((node) => node.getBoundingClientRect().top);
    const conflictsBottom = await sources.getByTestId('brand-kit-sources-conflicts').evaluate((node) => node.getBoundingClientRect().bottom);
    expect(conflictsBottom).toBeLessThanOrEqual(acceptedTop);
    // The Colorways page: a caption prints its ground once (the record's names already hold it), and the fixture's
    // three-colour lockup is never flattened by a filter: the derived tiles say "Not supplied", the full-colour tiles
    // draw the lockup, and no tile prints an image under a filter.
    const colorways = pageById(pages, 'logo-colorways');
    const captions = await colorways.getByTestId('brand-kit-colorways-tiles').locator('.pp-cap').allTextContents();
    expect(captions).toEqual(['Full color · on white', 'Reversed · on Charcoal', 'Full color · on light tint', 'One-color black · print only']);
    for (const caption of captions) expect(caption).not.toMatch(/(on white|on Charcoal|print only).*\1/);
    await expect(colorways.getByTestId('brand-kit-colorway-missing')).toHaveCount(2);
    await expect(colorways.getByTestId('brand-kit-colorways-tiles').locator('img')).toHaveCount(2);
    expect(await colorways.getByTestId('brand-kit-colorways-tiles').locator('img[style*="filter"]').count()).toBe(0);
    // The dark grounds draw the lockup in full colour, unfiltered, on the white plate padded by half its drawn height:
    // the cover (84 px lockup, 42 px of white) and the back cover (72, 36), their blocks a padding higher so the lockup
    // stays where the design draws it; a tile's plate is fitted to the tile's box (the partnership tile's 64 px box:
    // 32 drawn, 16 of white), so no plate spills out of its container.
    for (const img of await pageById(pages, 'cover').locator('img').all()) await expect(img).toHaveCSS('filter', 'none');
    await expect(pageById(pages, 'cover').getByTestId('mktg-portrait-plate')).toHaveCSS('padding', '42px');
    await expect(pageById(pages, 'cover').getByTestId('mktg-portrait-plate')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    // The plate's corners are a sixth of its shorter side, as a slide's rounded rectangle (K5): read against the drawn box.
    const coverPlate = pageById(pages, 'cover').getByTestId('mktg-portrait-plate');
    const coverPlateBox = await coverPlate.boundingBox();
    const coverPlateRadius = parseFloat(await coverPlate.evaluate((node) => getComputedStyle(node).borderTopLeftRadius));
    expect(coverPlateBox && Math.abs(coverPlateRadius - Math.min(coverPlateBox.width, coverPlateBox.height) / 6) < 0.5).toBe(true);
    const partnershipDark = pageById(pages, 'logo-partnership').getByTestId('brand-kit-partnership-dark').locator('img');
    await expect(partnershipDark).toHaveCSS('filter', 'none');
    await expect(pageById(pages, 'logo-partnership').getByTestId('brand-kit-partnership-dark').getByTestId('mktg-portrait-plate')).toHaveCSS('padding', '16px');
    await expect(pageById(pages, 'back-cover').getByTestId('mktg-portrait-plate')).toHaveCSS('padding', '36px');
    // The back cover's plate ends above the brand line's block: no text is drawn over the white.
    const backPlate = await pageById(pages, 'back-cover').getByTestId('mktg-portrait-plate').boundingBox();
    const backLine = await pageById(pages, 'back-cover').getByTestId('mktg-portrait-back-cover-line').boundingBox();
    expect(backPlate && backLine && backPlate.y + backPlate.height <= backLine.y).toBe(true);
    // The Logo system's dark tile says what it draws.
    await expect(pageById(pages, 'logo-system').getByTestId('brand-kit-logo-system-tiles')).toContainText(
      'On the dark · full color on a white plate (no reversed file)'
    );
    // The cover strip's halves share one line: under the long name "· a Linux Foundation project" is given up before a
    // word of the name, the name whole, the host and version kept, never wrapped at 10 px (the short-named record's
    // strip keeps the tail: the main test's read).
    const strip = pageById(pages, 'cover').getByTestId('mktg-portrait-cover-strip');
    await expect(strip).toContainText(overfullProject.name);
    await expect(strip).not.toContainText('Linux Foundation project');
    await expect(strip).toContainText(buildBrandKitBookView(brandKitOverfullFixture()).host);
    const halves = await strip.locator('span').all();
    const boxes = await Promise.all(halves.map((half) => half.boundingBox()));
    expect(boxes.every((box) => box !== null && box.height < 20)).toBe(true);
    expect(await strip.evaluate((node) => node.classList.contains('pp-cover-strip--wrapped'))).toBe(false);
    // The Watch-outs' three columns stay equal, and the retyped sample prints the long name WHOLE, its size stepped down
    // from 30 px (to 20 at the least) before a word of the name is given up: a cut name on this tile reads as a defect.
    await expectEqualWatchoutColumns(pageById(pages, 'logo-watchouts'));
    const retyped = pageById(pages, 'logo-watchouts').getByTestId('brand-kit-watchout-retyped');
    await expect(retyped).toHaveText(overfullProject.name);
    const retypedSize = parseFloat(await retyped.evaluate((node) => getComputedStyle(node).fontSize));
    expect(retypedSize).toBeLessThan(30);
    expect(retypedSize).toBeGreaterThanOrEqual(20);
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
    await expect(pageById(pages, 'color-contrast').getByTestId('brand-kit-contrast-pairs')).toHaveCount(0);
    await expect(pageById(pages, 'color-contrast').getByTestId('brand-kit-contrast-matrix').locator('tbody tr')).toHaveCount(4);
    const sources = pageById(pages, 'sources');
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
