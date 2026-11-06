// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_ICON_HIGHLIGHT_INDEX, BRAND_KIT_ICON_SAMPLES, BRAND_KIT_ICON_STRIP_INK, BRAND_KIT_PRINT_BODY_CLASS } from '@lfx-one/shared/constants';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { brandKitIconColours } from '@lfx-one/shared/utils/brand-kit-icons.utils';
import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { columnAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { expectMktgPrintFrame, finishMktgPrintFrame, layoutMktgPrintFrame, PRINT_FRAME_LANDSCAPE, stubMktgPrintFrame } from './helpers/mktg-print.helper';

const TAB_TIMEOUT = 10_000;

/** A `#RRGGBB` as the browser reports it on a computed style. */
function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

test.describe('Brand kit iconography samples: the board’s icons in the kit’s colours', () => {
  test.beforeEach(async ({ page }) => suppressCookieBanner(page));

  test('the Visual tab card shows the eight labelled tiles in the kit’s dark and the strip with Global highlighted, above the rules', async ({
    page,
  }, info) => {
    const kit = brandKitTestRevision();
    await openAssetDocument(page, 'brand-kit', 200, true, false, columnAssetRevisionResponse('brand-kit'));
    await page.getByTestId('brand-kit-web-view-tab-visual').click();
    await expect(page.getByTestId('brand-kit-web-view-panel-visual')).toBeVisible({ timeout: TAB_TIMEOUT });

    const card = page.getByTestId('brand-kit-web-view-icons');
    await expect(card.getByRole('heading', { name: 'Iconography', exact: true })).toBeVisible();
    const samples = card.getByTestId('brand-kit-icon-samples');
    await expect(samples).toBeVisible();
    // The tiles, in the board's order, each with its label as text and its icon drawn in the kit's dark.
    const tiles = samples.getByTestId(/^brand-kit-icon-tile-/);
    await expect(tiles).toHaveText(BRAND_KIT_ICON_SAMPLES.map((icon) => icon.label));
    await expect(tiles.first()).toHaveCSS('color', rgb(kit.kit.dark));
    await expect(tiles.first().locator('svg')).toBeVisible();
    // The strip: the kit's dark ground, white icons, the third one in the kit's highlight (the colour its Iconography rule
    // names, else its spark: this fixture's rules name none).
    const strip = samples.getByTestId('brand-kit-icon-strip');
    await expect(strip).toHaveCSS('background-color', rgb(kit.kit.dark));
    const stripIcons = strip.getByTestId(/^brand-kit-icon-strip-/);
    await expect(stripIcons).toHaveCount(BRAND_KIT_ICON_SAMPLES.length);
    await expect(stripIcons.first()).toHaveCSS('color', rgb(BRAND_KIT_ICON_STRIP_INK));
    const highlighted = strip.getByTestId(`brand-kit-icon-strip-${BRAND_KIT_ICON_SAMPLES[BRAND_KIT_ICON_HIGHLIGHT_INDEX].id}`);
    await expect(highlighted).toHaveAttribute('data-highlight', 'true');
    await expect(highlighted).toHaveCSS('color', rgb(brandKitIconColours(kit).highlight));
    // The rules and the recommended set stay, under the samples.
    await expect(card).toContainText(kit.chapters.visual.icons.rules[0]);
    await expect(card).toContainText(`Recommended set: ${kit.chapters.visual.icons.recommended}`);
    const order = await card.evaluate((node) => Array.from(node.children, (child) => child.tagName.toLowerCase()));
    expect(order.indexOf('lfx-mktg-brand-kit-icon-samples')).toBeLessThan(order.indexOf('ul'));
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('visual-iconography.png'), fullPage: true });
  });

  test('the PDF gives Iconography its own landscape page of the deck: the rules in the text column, the eight tiles and the strip at the deck’s geometry in the visual column, the recommended set under them', async ({
    page,
  }, info) => {
    const kit = brandKitTestRevision();
    const colours = brandKitIconColours(kit);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await stubMktgPrintFrame(page);
    await openAssetDocument(page, 'brand-kit', 200, true, false, columnAssetRevisionResponse('brand-kit'));
    await page.getByTestId('brand-kit-web-view-download-pdf').getByRole('button').click();
    await expectMktgPrintFrame(page, BRAND_KIT_PRINT_BODY_CLASS, 'lfx-mktg-brand-kit-print');
    const frame = await layoutMktgPrintFrame(page, PRINT_FRAME_LANDSCAPE);
    const print = frame.getByTestId('mktg-brand-kit-print');
    const iconography = print.getByTestId('kit-print-page').filter({ has: print.locator('[data-title="Iconography"]') });
    await expect(iconography).toHaveCount(1);
    await expect(iconography.getByTestId('mktg-print-page-head').first()).toHaveText('04 Visual');
    await expect(iconography).toContainText(`Recommended set: ${kit.chapters.visual.icons.recommended}`);
    for (const rule of kit.chapters.visual.icons.rules) {
      await expect(iconography).toContainText(rule);
    }
    // The icons: the same shared shapes the web card draws, each in its own slot box of the page plan; the first eight on
    // the white tiles in the kit's dark, the eight of the strip in white, the third in the highlight.
    const icons = iconography.getByTestId('kit-print-icon');
    await expect(icons).toHaveCount(2 * BRAND_KIT_ICON_SAMPLES.length);
    for (let index = 0; index < BRAND_KIT_ICON_SAMPLES.length; index++) {
      await expect(icons.nth(index)).toHaveCSS('color', rgb(colours.tileInk));
      await expect(icons.nth(index).locator('svg')).toHaveAttribute('viewBox', '0 0 24 24');
      await expect(icons.nth(BRAND_KIT_ICON_SAMPLES.length + index)).toHaveCSS(
        'color',
        index === BRAND_KIT_ICON_HIGHLIGHT_INDEX ? rgb(colours.highlight) : rgb(BRAND_KIT_ICON_STRIP_INK)
      );
    }
    for (const sample of BRAND_KIT_ICON_SAMPLES) {
      await expect(iconography).toContainText(sample.label);
    }
    // The geometry: four tiles to a row, two rows, each tile's icon above its label; the strip below the tiles across
    // the visual column; every icon inside the slide area; the text column to the left of the tiles.
    const boxes = await icons.evaluateAll((nodes) =>
      nodes
        .map((node) => node.getBoundingClientRect())
        .map(({ left, top, width }) => ({ left: Math.round(left), top: Math.round(top), width: Math.round(width) }))
    );
    const tiles = boxes.slice(0, 8);
    const strip = boxes.slice(8);
    expect(new Set(tiles.slice(0, 4).map((box) => box.top)).size).toBe(1);
    expect(new Set(tiles.slice(4).map((box) => box.top)).size).toBe(1);
    expect(tiles[4].top).toBeGreaterThan(tiles[0].top);
    expect(new Set(strip.map((box) => box.top)).size).toBe(1);
    expect(strip[0].top).toBeGreaterThan(tiles[4].top);
    const steps = strip.slice(1).map((box, index) => box.left - strip[index].left);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThanOrEqual(1);
    const slide = await iconography.getByTestId('mktg-print-page-slide').boundingBox();
    if (!slide) throw new Error('The slide area must be laid out');
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(slide.x);
      expect(box.left + box.width).toBeLessThanOrEqual(slide.x + slide.width);
    }
    const rules = await iconography.getByTestId('mktg-print-page-el').filter({ hasText: kit.chapters.visual.icons.rules[0] }).first().boundingBox();
    if (!rules) throw new Error('The rules column must be laid out');
    expect(rules.x + rules.width).toBeLessThanOrEqual(tiles[0].left);
    await iconography.scrollIntoViewIfNeeded();
    await iconography.screenshot({ path: info.outputPath('print-iconography.png') });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });
});
