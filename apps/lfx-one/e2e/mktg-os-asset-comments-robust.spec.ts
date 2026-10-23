// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { setupComments } from './helpers/mktg-os-comments.helper';
import { setupAsset } from './helpers/mktg-os-assets.helper';
import { redraftFixture } from './helpers/mktg-os-redraft.helper';
import { structuredCommentAsset } from './helpers/mktg-os-structured-comments.helper';
import { setupStructuredComments } from './helpers/mktg-os-kit-comments.helper';
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

  test('mobile redraft controls keep a persistent live region, gated Release and keyboard re-observe Retry', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { fixture, state } = await redraftFixture(page);
    state.fail = true;
    await fixture.open();
    const panel = page.getByTestId('mktg-comments-panel');
    const message = panel.getByTestId('mktg-comments-run-message');
    await expect(message).toHaveAttribute('role', 'status');
    await expect(message).toHaveAttribute('aria-live', 'polite');
    await expect(message).toBeEmpty();
    await panel.getByTestId('mktg-comments-send').getByRole('button').click();
    const release = panel.getByTestId('mktg-comments-release').getByRole('button');
    await expect(release).toBeVisible();
    await release.focus();
    await expect(release).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(message).toContainText('Still starting — retry shortly.');
    await page.screenshot({ path: test.info().outputPath('mobile-release-live-region.png'), fullPage: true });
    state.fail = false;
    const retry = panel.getByTestId('mktg-comments-send').getByRole('button', { name: 'Retry the same redraft' });
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByTestId('mktg-comments-feed')).toBeVisible();
    await expect(panel.getByTestId('mktg-comments-release')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('mobile-accepted-feed-no-release.png'), fullPage: true });
  });

  for (const agentKey of ['brand-kit', 'boilerplates'] as const) {
    for (const width of [1280, 1440]) {
      test(`${agentKey}: Comments, Revisions and About stay in the right column at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        const fixture = await setupStructuredComments(page, agentKey);
        await fixture.open();
        await expect(page.getByTestId('mktg-comments-empty')).toBeVisible();
        const asset = await page.getByTestId(agentKey === 'brand-kit' ? 'brand-kit-web-view' : 'mktg-boilerplates-view').boundingBox();
        expect(asset).not.toBeNull();
        for (const id of ['mktg-comments-panel', 'mktg-document-view-revisions', 'mktg-document-view-about']) {
          const card = await page.getByTestId(id).boundingBox();
          expect(card).not.toBeNull();
          if (asset && card) expect(card.x).toBeGreaterThanOrEqual(asset.x + asset.width);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`${agentKey}-comments-sidebar-${width}.png`), fullPage: true });
      });
    }
    test(`${agentKey}: mobile field pins isolate hover and use app typography outside sample chips`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const { base } = await structuredCommentAsset(page, agentKey);
      const fixture = await setupAsset(page, { mode: 'ready', asset: base });
      await fixture.open(agentKey === 'brand-kit' ? '&tab=visual' : '');
      await expect(page.getByTestId('mktg-comments-empty')).toBeVisible();
      const asset = await page.getByTestId(agentKey === 'brand-kit' ? 'brand-kit-web-view' : 'mktg-boilerplates-view').boundingBox();
      const panel = await page.getByTestId('mktg-comments-panel').boundingBox();
      expect(asset && panel && panel.y >= asset.y + asset.height).toBe(true);
      const key = agentKey === 'brand-kit' ? 'chapters.visual.imagery.avoid[0]' : 'bp[1].t';
      const field = page.getByTestId(`mktg-field-comments-${key}`);
      const button = field.getByRole('button', { name: /^Comment on/ });
      if (agentKey === 'brand-kit') {
        await page
          .getByTestId('mktg-field-comments-chapters.visual.imagery.rule')
          .getByRole('button', { name: /^Comment on/ })
          .focus();
        await page.keyboard.press('Tab');
        await expect(button).toBeFocused();
      } else await button.focus();
      await page.keyboard.press('Enter');
      await expect(field.getByRole('textbox')).toBeVisible();
      if (agentKey === 'brand-kit') {
        await page.keyboard.press('Tab');
        await expect(field.getByRole('textbox')).toBeFocused();
      }
      const typography = (element: HTMLElement | SVGElement) => ({ fontFamily: getComputedStyle(element).fontFamily, color: getComputedStyle(element).color });
      const appTypography = await page.getByTestId('mktg-comments-panel').getByRole('heading', { name: 'Comments', exact: true }).evaluate(typography);
      expect(appTypography.fontFamily).not.toBe('');
      expect(await field.evaluate(typography)).toEqual(appTypography);
      expect(await field.evaluate((element) => element.closest('[data-mktg-comment-group]')?.querySelectorAll('[data-mktg-comment-field]').length)).toBe(1);
      if (agentKey === 'brand-kit') {
        await expect(page.getByTestId('brand-kit-web-view-imagery-avoid-0')).toBeVisible();
        expect(await field.evaluate((element) => element.closest('[data-testid^="brand-kit-web-view-imagery-avoid-"]'))).toBeNull();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`${agentKey}-mobile-field-pin.png`), fullPage: true });
    });
  }

  test('brand-kit uncertain send keeps the same Retry intent and Release never starts another generation', async ({ page }) => {
    const fixture = await setupStructuredComments(page, 'brand-kit');
    fixture.state.uncertain = true;
    await fixture.open();
    const panel = page.getByTestId('mktg-comments-panel');
    await expect(panel.getByTestId('mktg-comments-empty')).toBeVisible();
    const field = page.getByTestId(`mktg-field-comments-${fixture.key}`);
    await field.getByRole('button', { name: /^Comment on/ }).focus();
    await page.keyboard.press('Enter');
    await expect(field.getByRole('textbox')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(field.getByRole('textbox')).toBeFocused();
    await page.keyboard.type('Use a shorter synthetic Voice line.');
    await page.keyboard.press('Tab');
    await expect(field.getByRole('button', { name: 'Add comment', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(panel).toContainText('Use a shorter synthetic Voice line.');
    await panel.getByTestId('mktg-comments-send').getByRole('button').click();
    await expect(panel.getByTestId('mktg-comments-run-message')).toContainText('Try the same send again, or release it');
    await expect(panel.getByTestId('mktg-comments-feed')).toHaveCount(0);
    expect(fixture.state.sends).toHaveLength(1);
    const original = fixture.state.sends[0];
    await panel.getByRole('button', { name: 'Retry the same redraft', exact: true }).click();
    await expect.poll(() => fixture.state.sends.length).toBe(2);
    expect(fixture.state.sends[1]).toEqual(original);
    await panel.getByTestId('mktg-comments-release').getByRole('button').click();
    await expect(panel.getByTestId('mktg-comments-run-message')).toContainText('Still starting — retry shortly');
    fixture.state.releaseBusy = false;
    await panel.getByTestId('mktg-comments-release').getByRole('button').click();
    await expect(panel.getByTestId('mktg-comments-run-message')).toContainText('Send released');
    await expect(panel.getByTestId('mktg-comments-release')).toHaveCount(0);
    expect(fixture.state.releases).toBe(2);
    expect(fixture.state.sends).toHaveLength(2);
    await page.screenshot({ path: test.info().outputPath('brand-kit-uncertain-retry-released.png'), fullPage: true });
  });

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
