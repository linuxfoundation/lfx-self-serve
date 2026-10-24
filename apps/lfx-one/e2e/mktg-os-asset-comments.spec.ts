// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { ASSET_PROJECT } from './helpers/mktg-os-assets.helper';
import { setupComments } from './helpers/mktg-os-comments.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

test.describe('asset field comments', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test('adds a pinned comment to the selected field and lists its author/date in the panel', async ({ page }) => {
    const fixture = await setupComments(page);
    await fixture.open();
    const panel = page.getByTestId('mktg-comments-panel');
    await expect(panel.getByTestId('mktg-comments-empty')).toBeVisible();
    const field = page.getByTestId('mktg-field-comments-mf.positioning');
    await field.hover();
    await field.getByRole('button', { name: 'Comment on Positioning', exact: true }).click();
    await field.getByRole('textbox', { name: 'Comment on Positioning', exact: true }).fill('Make it one clause about the neutral foundation.');
    await field.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(field.getByTestId('mktg-comment-thread')).toContainText('Make it one clause');
    await expect(panel).toContainText('Make it one clause');
    await expect(panel).toContainText('Project writer');
    await expect(panel).toContainText('21 Oct');
    expect(fixture.state.posts).toHaveLength(1);
    expect(fixture.state.posts[0]).toMatchObject({ project: ASSET_PROJECT.uid, anchor: { kind: 'field', key: 'mf.positioning' } });
    await expect(page.getByTestId('mktg-framework-view-positioning')).toHaveText('For platform teams, the project is the open release toolkit.');
    await page.screenshot({ path: test.info().outputPath('field-comment-pinned-and-listed.png'), fullPage: true });
  });
  test('keeps the failed composer and retries the same opaque request explicitly', async ({ page }) => {
    const fixture = await setupComments(page);
    fixture.state.failSave = true;
    await fixture.open();
    const field = page.getByTestId('mktg-field-comments-mf.tagline');
    await field.hover();
    await field.getByRole('button', { name: 'Comment on Tagline', exact: true }).click();
    await field.getByRole('textbox', { name: 'Comment on Tagline', exact: true }).fill('Use a shorter synthetic tagline.');
    await field.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(field.getByRole('alert')).toBeVisible();
    await expect(field.getByRole('textbox', { name: 'Comment on Tagline', exact: true })).toHaveValue('Use a shorter synthetic tagline.');
    fixture.state.failSave = false;
    await field.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(page.getByTestId('mktg-comments-panel')).toContainText('Use a shorter synthetic tagline.');
    expect(fixture.state.posts).toHaveLength(2);
    expect(fixture.state.posts[0]['clientRequestId']).toBe(fixture.state.posts[1]['clientRequestId']);
    await page.screenshot({ path: test.info().outputPath('field-comment-recovered.png'), fullPage: true });
  });
  test('keeps loading distinct from measured empty', async ({ page }) => {
    const fixture = await setupComments(page, true);
    try {
      await fixture.open();
      await expect(page.getByTestId('mktg-comments-loading')).toContainText('Loading');
      expect(await page.getByTestId('mktg-field-comments-mf.vision').boundingBox()).toBeNull();
    } finally {
      fixture.release();
    }
    await expect(page.getByTestId('mktg-comments-empty')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('comments-empty.png'), fullPage: true });
  });
  test('shows a read failure without inventing an empty list and recovers on Retry', async ({ page }) => {
    const fixture = await setupComments(page);
    fixture.state.failRead = true;
    await fixture.open();
    const panel = page.getByTestId('mktg-comments-panel');
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByTestId('mktg-comments-empty')).toHaveCount(0);
    fixture.state.failRead = false;
    await panel.getByRole('button', { name: 'Retry comments' }).click();
    await expect(panel.getByTestId('mktg-comments-empty')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('comments-read-recovered.png'), fullPage: true });
  });
});
