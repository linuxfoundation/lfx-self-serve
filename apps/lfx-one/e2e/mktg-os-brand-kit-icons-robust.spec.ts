// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_ICON_HIGHLIGHT_INDEX, BRAND_KIT_ICON_SAMPLES, BRAND_KIT_ICON_STRIP_ONE_ROW_MIN_PX } from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { columnAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';

const TAB_TIMEOUT = 10_000;

test.describe('Brand kit iconography samples structure', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.beforeEach(async ({ page }) => suppressCookieBanner(page));

  test('the data-testid contract: the card, eight tiles and eight strip icons by id, one highlight, four tiles to a row', async ({ page }, info) => {
    await openAssetDocument(page, 'brand-kit', 200, true, false, columnAssetRevisionResponse('brand-kit'));
    await page.getByTestId('brand-kit-web-view-tab-visual').click();
    await expect(page.getByTestId('brand-kit-web-view-panel-visual')).toBeVisible({ timeout: TAB_TIMEOUT });

    const samples = page.getByTestId('brand-kit-web-view-icons').getByTestId('brand-kit-icon-samples');
    await expect(samples).toBeVisible();
    await expect(samples.getByTestId('brand-kit-icon-tiles')).toBeVisible();
    await expect(samples.getByTestId('brand-kit-icon-strip')).toBeVisible();
    for (const icon of BRAND_KIT_ICON_SAMPLES) {
      await expect(samples.getByTestId(`brand-kit-icon-tile-${icon.id}`)).toBeVisible();
      await expect(samples.getByTestId(`brand-kit-icon-strip-${icon.id}`)).toBeVisible();
    }
    await expect(samples.locator('[data-highlight="true"]')).toHaveCount(1);
    await expect(samples.locator('[data-highlight="true"]')).toHaveAttribute(
      'data-testid',
      `brand-kit-icon-strip-${BRAND_KIT_ICON_SAMPLES[BRAND_KIT_ICON_HIGHLIGHT_INDEX].id}`
    );
    // Four tiles to a row, as the board draws them: the first four share a top edge, the fifth starts the next row.
    const tops = await samples.getByTestId(/^brand-kit-icon-tile-/).evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(tops.slice(0, 4)).size).toBe(1);
    expect(tops[4]).toBeGreaterThan(tops[0]);
    expect(new Set(tops.slice(4)).size).toBe(1);
    // The strip's eight icons sit in ONE row in the half-width card (spread evenly, 12 px minimum gap), inside the strip,
    // and nothing overflows the card.
    const strip = await samples.getByTestId('brand-kit-icon-strip').boundingBox();
    const stripIconTops = await samples
      .getByTestId(/^brand-kit-icon-strip-/)
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(stripIconTops).size).toBe(1);
    const card = await page.getByTestId('brand-kit-web-view-icons').boundingBox();
    if (!strip || !card) throw new Error('The card and the strip must be laid out');
    expect(strip.x).toBeGreaterThanOrEqual(card.x - 1);
    expect(strip.x + strip.width).toBeLessThanOrEqual(card.x + card.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await samples.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('iconography-structure.png'), fullPage: true });
  });

  test('on a 390 px screen the tiles go two to a row with whole labels, and the strip holds one row of eight or 4 + 4', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openAssetDocument(page, 'brand-kit', 200, true, false, columnAssetRevisionResponse('brand-kit'));
    await page.getByTestId('brand-kit-web-view-tab-visual').click();
    await expect(page.getByTestId('brand-kit-web-view-panel-visual')).toBeVisible({ timeout: TAB_TIMEOUT });

    const samples = page.getByTestId('brand-kit-web-view-icons').getByTestId('brand-kit-icon-samples');
    await samples.scrollIntoViewIfNeeded();
    // Two tiles to a row, so the first two share a top edge and the third starts the next row.
    const tops = await samples.getByTestId(/^brand-kit-icon-tile-/).evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    expect(new Set(tops.slice(0, 2)).size).toBe(1);
    expect(tops[2]).toBeGreaterThan(tops[0]);
    expect(new Set(tops).size).toBe(4);
    // No label breaks mid-word: each label is one line of its own text.
    const labelLines = await samples
      .getByTestId(/^brand-kit-icon-tile-/)
      .locator('span')
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight))));
    expect(labelLines).toEqual(BRAND_KIT_ICON_SAMPLES.map(() => 1));
    // The strip: one row of eight from a 272 px strip up, else 4 + 4 (never 7 + 1 or 5 + 3), every icon inside the strip's box.
    const strip = await samples.getByTestId('brand-kit-icon-strip').boundingBox();
    if (!strip) throw new Error('The strip must be laid out');
    const stripTops = await samples
      .getByTestId(/^brand-kit-icon-strip-/)
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
    const rows = new Set(stripTops);
    expect(rows.size).toBe(strip.width >= BRAND_KIT_ICON_STRIP_ONE_ROW_MIN_PX ? 1 : 2);
    if (rows.size === 2) {
      expect(new Set(stripTops.slice(0, 4)).size).toBe(1);
      expect(new Set(stripTops.slice(4)).size).toBe(1);
    }
    for (const icon of await samples.getByTestId(/^brand-kit-icon-strip-/).all()) {
      const box = await icon.boundingBox();
      if (!box) throw new Error('The strip icon must be laid out');
      expect(box.x).toBeGreaterThanOrEqual(strip.x - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(strip.x + strip.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(strip.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(strip.y + strip.height + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('iconography-structure-390.png'), fullPage: true });
  });
});
