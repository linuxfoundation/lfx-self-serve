// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_ICON_HIGHLIGHT_INDEX, BRAND_KIT_ICON_SAMPLES, BRAND_KIT_ICON_STRIP_INK, BRAND_KIT_PRINT_BODY_CLASS } from '@lfx-one/shared/constants';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { brandKitIconColours } from '@lfx-one/shared/utils/brand-kit-icons.utils';
import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { columnAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { expectMktgPrintFrame, finishMktgPrintFrame, layoutMktgPrintFrame, stubMktgPrintFrame } from './helpers/mktg-print.helper';

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

  test('the PDF gives Iconography its own portrait page: the tiles at the mock’s size, the strip on the kit’s dark 36 px under them, the rules, the set and the sizes', async ({
    page,
  }, info) => {
    const kit = brandKitTestRevision();
    await page.setViewportSize({ width: 1280, height: 1000 });
    await stubMktgPrintFrame(page);
    await openAssetDocument(page, 'brand-kit', 200, true, false, columnAssetRevisionResponse('brand-kit'));
    await page.getByTestId('brand-kit-web-view-download-pdf').getByRole('button').click();
    await expectMktgPrintFrame(page, BRAND_KIT_PRINT_BODY_CLASS, 'lfx-mktg-brand-kit-print');
    const frame = await layoutMktgPrintFrame(page);
    const visual = frame.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id="visual-iconography"]');
    await expect(visual).toHaveAttribute('data-section', '04 Visual');
    await expect(visual.getByTestId('mktg-portrait-page-band')).toBeVisible();
    await expect(visual.getByTestId('brand-kit-iconography-set')).toContainText(kit.chapters.visual.icons.recommended);
    await expect(visual.getByTestId('brand-kit-iconography-rules').locator('li')).toHaveText(kit.chapters.visual.icons.rules);
    const samples = visual.getByTestId('brand-kit-icon-samples');
    await expect(samples).toBeVisible();
    await expect(samples.getByTestId(/^brand-kit-icon-tile-/)).toHaveText(BRAND_KIT_ICON_SAMPLES.map((icon) => icon.label));
    await expect(samples.getByTestId('brand-kit-icon-strip')).toHaveCSS('background-color', rgb(kit.kit.dark));
    await expect(samples.getByTestId(`brand-kit-icon-strip-${BRAND_KIT_ICON_SAMPLES[BRAND_KIT_ICON_HIGHLIGHT_INDEX].id}`)).toHaveCSS(
      'color',
      rgb(brandKitIconColours(kit).highlight)
    );
    // The page's geometry (the mock's): the samples across the 704 px column from y 148; 150 px tiles, four to a row
    // with 16 px gaps, the 36 px icon above the label inside the border; the 120 px strip 36 px below the tiles.
    const pageBox = await visual.boundingBox();
    const samplesBox = await samples.boundingBox();
    if (!pageBox || !samplesBox) throw new Error('The page and the samples must be laid out');
    expect(Math.round(samplesBox.x - pageBox.x)).toBe(56);
    expect(Math.round(samplesBox.y - pageBox.y)).toBe(148);
    expect(Math.round(samplesBox.width)).toBe(704);
    const tiles = samples.getByTestId(/^brand-kit-icon-tile-/);
    await expect(samples.getByTestId('brand-kit-icon-tiles')).toHaveCSS('display', 'table');
    for (const tile of await tiles.all()) {
      const box = await tile.boundingBox();
      const icon = await tile.locator('svg').boundingBox();
      const label = await tile.locator('span').boundingBox();
      if (!box || !icon || !label) throw new Error('The print tile must be laid out');
      expect(Math.round(box.height)).toBe(150);
      expect(Math.round(icon.height)).toBe(36);
      expect(icon.y).toBeGreaterThanOrEqual(box.y);
      expect(label.y).toBeGreaterThanOrEqual(icon.y + icon.height);
      expect(label.y + label.height).toBeLessThanOrEqual(box.y + box.height);
    }
    const tileBoxes = await tiles.evaluateAll((nodes) =>
      nodes
        .map((node) => node.getBoundingClientRect())
        .map(({ top, left, right }) => ({ top: Math.round(top), left: Math.round(left), right: Math.round(right) }))
    );
    expect(new Set(tileBoxes.slice(0, 4).map((box) => box.top)).size).toBe(1);
    expect(new Set(tileBoxes.slice(4).map((box) => box.top)).size).toBe(1);
    expect(tileBoxes[4].top - tileBoxes[0].top).toBe(150 + 16);
    expect(tileBoxes[1].left - tileBoxes[0].right).toBe(16);
    // The outer tiles sit flush with the column's edges, and the four tiles of a row are the same width.
    expect(Math.abs(tileBoxes[0].left - samplesBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(tileBoxes[3].right - (samplesBox.x + samplesBox.width))).toBeLessThanOrEqual(1);
    const widths = tileBoxes.slice(0, 4).map((box) => box.right - box.left);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    const strip = samples.getByTestId('brand-kit-icon-strip');
    await expect(strip).toHaveCSS('display', 'table');
    const stripBox = await strip.boundingBox();
    const lastTile = await tiles.last().boundingBox();
    if (!stripBox || !lastTile) throw new Error('The strip must be laid out');
    expect(Math.round(stripBox.height)).toBe(120);
    expect(Math.round(stripBox.y - (lastTile.y + lastTile.height))).toBe(36);
    expect(Math.round(stripBox.width)).toBe(Math.round(samplesBox.width));
    await expect(visual.getByTestId('brand-kit-iconography-strip-caption')).toContainText('On dark grounds: white, one active state in');
    await expect(visual.getByTestId('brand-kit-iconography-sizes').locator('svg')).toHaveCount(4);
    const stripIcons = await samples
      .getByTestId(/^brand-kit-icon-strip-/)
      .locator('svg')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()).map(({ left, top }) => ({ left: Math.round(left), top: Math.round(top) })));
    expect(new Set(stripIcons.map((icon) => icon.top)).size).toBe(1);
    const steps = stripIcons.slice(1).map((icon, index) => icon.left - stripIcons[index].left);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThanOrEqual(1);
    expect(stripIcons[0].left - stripBox.x).toBeGreaterThanOrEqual(24);
    expect(stripBox.x + stripBox.width - (stripIcons[7].left + 32)).toBeGreaterThanOrEqual(24);
    await samples.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('print-iconography.png'), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });
});
