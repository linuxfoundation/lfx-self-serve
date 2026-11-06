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

  test('the PDF’s Visual chapter prints the same samples, compact, beside the rules in the Iconography block', async ({ page }, info) => {
    const kit = brandKitTestRevision();
    await page.setViewportSize({ width: 1280, height: 1000 });
    await stubMktgPrintFrame(page);
    await openAssetDocument(page, 'brand-kit', 200, true, false, columnAssetRevisionResponse('brand-kit'));
    await page.getByTestId('brand-kit-web-view-download-pdf').getByRole('button').click();
    await expectMktgPrintFrame(page, BRAND_KIT_PRINT_BODY_CLASS, 'lfx-mktg-brand-kit-print');
    const frame = await layoutMktgPrintFrame(page);
    const visual = frame.getByTestId('kit-print-visual');
    await expect(visual).toContainText(kit.chapters.visual.icons.recommended);
    const samples = visual.getByTestId('brand-kit-icon-samples');
    await expect(samples).toBeVisible();
    await expect(samples.getByTestId(/^brand-kit-icon-tile-/)).toHaveText(BRAND_KIT_ICON_SAMPLES.map((icon) => icon.label));
    await expect(samples.getByTestId('brand-kit-icon-strip')).toHaveCSS('background-color', rgb(kit.kit.dark));
    await expect(samples.getByTestId(`brand-kit-icon-strip-${BRAND_KIT_ICON_SAMPLES[BRAND_KIT_ICON_HIGHLIGHT_INDEX].id}`)).toHaveCSS(
      'color',
      rgb(brandKitIconColours(kit).highlight)
    );
    // The board's print layout: the rules at the left, the samples beside them in one table row, so the Iconography row
    // stays as short as the rules and the chapter keeps its page; the row and the samples hold together.
    const row = visual.getByTestId('kit-print-icon-row');
    await expect(row).toHaveCSS('display', 'table');
    await expect(row).toHaveCSS('break-inside', 'avoid');
    await expect(samples).toHaveCSS('break-inside', 'avoid');
    const rules = await row.locator('.kit-icon-rules').boundingBox();
    const samplesBox = await samples.boundingBox();
    if (!rules || !samplesBox) throw new Error('The rules and the samples must be laid out');
    expect(samplesBox.x).toBeGreaterThanOrEqual(rules.x + rules.width - 1);
    expect(Math.abs(samplesBox.y - rules.y)).toBeLessThanOrEqual(4);
    expect(samplesBox.height).toBeLessThanOrEqual(102);
    // Every tile printed whole: its icon and its label inside its own border, four to a line.
    const tiles = samples.getByTestId(/^brand-kit-icon-tile-/);
    for (const tile of await tiles.all()) {
      const box = await tile.boundingBox();
      const icon = await tile.locator('svg').boundingBox();
      const label = await tile.locator('span').boundingBox();
      if (!box || !icon || !label) throw new Error('The print tile must be laid out');
      expect(box.height).toBeLessThanOrEqual(32);
      expect(icon.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(label.y + label.height).toBeLessThanOrEqual(box.y + box.height + 1);
    }
    const tops = await tiles.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(tops.slice(0, 4)).size).toBe(1);
    expect(new Set(tops.slice(4)).size).toBe(1);
    expect(tops[4]).toBeGreaterThan(tops[0]);
    await samples.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('print-iconography.png'), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });
});
