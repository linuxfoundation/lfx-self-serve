// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_ICON_HIGHLIGHT_INDEX, BRAND_KIT_ICON_SAMPLES, BRAND_KIT_ICON_STRIP_INK, BRAND_KIT_PRINT_BODY_CLASS } from '@lfx-one/shared/constants';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
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
    // The strip: the kit's dark ground, white icons, the third one in the kit's spark.
    const strip = samples.getByTestId('brand-kit-icon-strip');
    await expect(strip).toHaveCSS('background-color', rgb(kit.kit.dark));
    const stripIcons = strip.getByTestId(/^brand-kit-icon-strip-/);
    await expect(stripIcons).toHaveCount(BRAND_KIT_ICON_SAMPLES.length);
    await expect(stripIcons.first()).toHaveCSS('color', rgb(BRAND_KIT_ICON_STRIP_INK));
    const highlighted = strip.getByTestId(`brand-kit-icon-strip-${BRAND_KIT_ICON_SAMPLES[BRAND_KIT_ICON_HIGHLIGHT_INDEX].id}`);
    await expect(highlighted).toHaveAttribute('data-highlight', 'true');
    await expect(highlighted).toHaveCSS('color', rgb(kit.kit.spark));
    // The rules and the recommended set stay, under the samples.
    await expect(card).toContainText(kit.chapters.visual.icons.rules[0]);
    await expect(card).toContainText(`Recommended set: ${kit.chapters.visual.icons.recommended}`);
    const order = await card.evaluate((node) => Array.from(node.children, (child) => child.tagName.toLowerCase()));
    expect(order.indexOf('lfx-mktg-brand-kit-icon-samples')).toBeLessThan(order.indexOf('ul'));
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('visual-iconography.png'), fullPage: true });
  });

  test('the PDF’s Visual chapter prints the same samples, compact, inside the Iconography block', async ({ page }, info) => {
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
      rgb(kit.kit.spark)
    );
    // The block holds together on one page, and the samples are the compact rows (shorter tiles than the web card).
    await expect(samples).toHaveCSS('break-inside', 'avoid');
    const tile = await samples.getByTestId('brand-kit-icon-tile-documents').boundingBox();
    if (!tile) throw new Error('The print tile must be laid out');
    expect(tile.height).toBeLessThanOrEqual(90);
    await samples.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('print-iconography.png'), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });
});
