// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { openStaleness, setupStaleness, STALENESS_ASSET_URL } from './helpers/mktg-os-staleness.helper';

test.describe('Marketing OS staleness structure', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('final-state.png'), fullPage: true });
  });

  test('framework Downstream stays below Revisions in the right column at laptop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await setupStaleness(page);
    await openStaleness(page, STALENESS_ASSET_URL);
    const card = page.getByTestId('mktg-downstream-card');
    await expect(card).toBeVisible();
    const bounds = await card.boundingBox();
    const revisions = await page.getByTestId('mktg-document-view-revisions').boundingBox();
    const content = await page.getByRole('region', { name: 'Document content' }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(revisions).not.toBeNull();
    expect(content).not.toBeNull();
    if (!bounds || !revisions || !content) throw new Error('Expected visible synthetic asset regions');
    expect(bounds.y).toBeGreaterThanOrEqual(revisions.y + revisions.height);
    expect(bounds.x).toBeGreaterThan(content.x + content.width - 1);
    await expect(card.getByRole('button', { name: 'Rebuild both' })).toBeEnabled();
  });

  test('mobile Family questions remain in place and do not overflow the routed host', async ({ page }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await setupStaleness(page, { questions: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await openStaleness(page);
    await page.getByTestId('mktg-family-rebuild').getByRole('button').click();
    const questions = page.getByTestId('mktg-run-questions');
    await expect(questions).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('mktg-run-questions-send').getByRole('button')).toBeEnabled();
    await expect(page.getByTestId('mktg-rebuild-state-faq')).toContainText('Waiting');
    const bounds = await questions.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error('Expected visible synthetic questions');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
