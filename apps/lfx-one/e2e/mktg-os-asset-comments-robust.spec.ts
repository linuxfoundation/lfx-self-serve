// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { setupComments } from './helpers/mktg-os-comments.helper';
import { setupAsset } from './helpers/mktg-os-assets.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

test.describe('asset comments structure', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test('mobile keyboard access opens the pinned composer without a horizontal overflow or hand-edit surface', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await setupComments(page);
    await fixture.open();
    await expect(page.getByTestId('mktg-comments-empty')).toBeVisible();
    const asset = await page.getByTestId('mktg-framework-view').boundingBox();
    const panel = await page.getByTestId('mktg-comments-panel').boundingBox();
    expect(asset && panel && panel.y >= asset.y + asset.height).toBe(true);
    const field = page.getByTestId('mktg-field-comments-mf.vision');
    const button = field.getByRole('button', { name: 'Comment on Vision', exact: true });
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(field.getByRole('textbox', { name: 'Comment on Vision', exact: true })).toBeVisible();
    await expect(page.getByTestId('mktg-framework-view').locator('[contenteditable="true"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('mobile-field-composer.png'), fullPage: true });
  });
  for (const width of [1280, 1440]) {
    test(`comments sit to the right of the framework at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const fixture = await setupComments(page);
      await fixture.open();
      await expect(page.getByTestId('mktg-comments-empty')).toBeVisible();
      const asset = await page.getByTestId('mktg-framework-view').boundingBox();
      expect(asset).not.toBeNull();
      for (const id of ['mktg-comments-panel', 'mktg-document-view-revisions', 'mktg-document-view-about']) {
        const card = await page.getByTestId(id).boundingBox();
        expect(card).not.toBeNull();
        if (asset && card) expect(card.x).toBeGreaterThanOrEqual(asset.x + asset.width);
      }
      await expect(page.getByTestId('mktg-framework-view')).toHaveClass(/\[@media_screen\]:@container\/asset/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`comments-sidebar-${width}.png`), fullPage: true });
    });
  }

  test('a denied save shows access Retry and restores the same viewer draft after a successful read', async ({ page }) => {
    const fixture = await setupComments(page);
    await fixture.open();
    const field = page.getByTestId('mktg-field-comments-mf.positioning');
    await expect(page.getByTestId('mktg-comments-empty')).toBeVisible();
    await field.hover();
    await field.getByRole('button', { name: 'Comment on Positioning', exact: true }).click();
    await field.getByRole('textbox').fill('Keep this synthetic draft.');
    fixture.state.deny = true;
    await field.getByRole('button', { name: 'Add comment', exact: true }).click();
    const panel = page.getByTestId('mktg-comments-panel');
    await expect(panel.getByRole('alert')).toContainText('write access');
    await expect(field.getByRole('textbox')).toHaveCount(0);
    expect(fixture.state.posts).toHaveLength(1);
    await page.screenshot({ path: test.info().outputPath('comment-save-denied.png'), fullPage: true });
    fixture.state.deny = false;
    await panel.getByRole('button', { name: 'Retry comments' }).click();
    await expect(field.getByRole('textbox')).toHaveValue('Keep this synthetic draft.');
    expect(fixture.state.posts).toHaveLength(1);
    await field.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(panel).toContainText('Keep this synthetic draft.');
    expect(fixture.state.posts[0]['clientRequestId']).toBe(fixture.state.posts[1]['clientRequestId']);
    await page.screenshot({ path: test.info().outputPath('comment-save-restored.png'), fullPage: true });
  });

  test('project non-writers see the access message, never a comments composer', async ({ page }) => {
    const fixture = await setupAsset(page, { mode: 'ready', writer: false });
    await fixture.open();
    await expect(page.getByTestId('mktg-document-view-error')).toContainText('write access');
    await expect(page.getByTestId('mktg-comments-panel')).toHaveCount(0);
    await expect(page.getByTestId('mktg-field-comment-open')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('project-no-access.png'), fullPage: true });
  });

  test('a comments permission failure does not claim an empty list or expose a composer', async ({ page }) => {
    const fixture = await setupComments(page);
    fixture.state.deny = true;
    await fixture.open();
    const panel = page.getByTestId('mktg-comments-panel');
    await expect(panel.getByRole('alert')).toContainText('write access');
    await expect(page.getByTestId('mktg-framework-view-vision')).toBeVisible();
    await expect(page.getByTestId('mktg-field-comment-open')).toHaveCount(0);
    await expect(panel.getByTestId('mktg-comments-empty')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('comments-no-access.png'), fullPage: true });
  });
});
