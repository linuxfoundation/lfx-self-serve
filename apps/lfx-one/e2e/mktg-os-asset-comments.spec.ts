// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { ASSET_PROJECT, ASSET_REVISION } from './helpers/mktg-os-assets.helper';
import { setupComments } from './helpers/mktg-os-comments.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

test.describe('asset field comments', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test('eight threads stay compact with separate preview lines until their own keyboard disclosure is opened', async ({ page }) => {
    const fixture = await setupComments(page);
    fixture.state.rows = Array.from({ length: 8 }, (_, index) => ({
      id: `synthetic-compact-${index}`,
      revisionId: ASSET_REVISION,
      anchor: { kind: 'field', key: 'mf.positioning' },
      author: { name: 'Project writer' },
      text: `Synthetic preview ${index} with a deliberately long first line to exercise truncation.\nFull explanation ${index}.`,
      createdAt: '2026-10-21T10:00:00Z',
      status: 'resolved',
      sentInRun: null,
      resultRevisionId: null,
      resolution: `Synthetic agent explanation ${index}.`,
    }));
    await fixture.open();
    const panel = page.getByTestId('mktg-comments-panel');
    const rows = panel.getByTestId('mktg-comment-thread');
    await expect(rows).toHaveCount(8);
    await expect(panel.getByTestId('mktg-comment-body')).toHaveCount(0);
    await expect(panel.getByTestId('mktg-comment-resolution')).toHaveCount(0);
    for (const row of await rows.all()) {
      await expect(row.getByRole('button', { name: 'Details', exact: true })).toHaveAttribute('aria-expanded', 'false');
      await expect(row.getByTestId('mktg-comment-preview')).toHaveCSS('white-space', 'nowrap');
      await expect(row.getByTestId('mktg-comment-preview')).toHaveCSS('text-overflow', 'ellipsis');
      await expect(row.getByText('Resolved by the agent', { exact: true })).toBeVisible();
    }
    await page.screenshot({ path: test.info().outputPath('eight-compact-comment-rows.png'), fullPage: true });
    const first = rows.nth(0).getByRole('button', { name: 'Details', exact: true });
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(first).toBeFocused();
    await expect(rows.nth(0).getByTestId('mktg-comment-body')).toContainText('Full explanation 0.');
    await expect(rows.nth(0).getByTestId('mktg-comment-resolution')).toHaveText('Synthetic agent explanation 0.');
    await expect(panel.getByTestId('mktg-comment-body')).toHaveCount(1);
    await page.keyboard.press('Space');
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await expect(first).toBeFocused();
    for (let index = 1; index < 8; index++) {
      await page.keyboard.press('Tab');
      await expect(rows.nth(index).getByRole('button', { name: 'Details', exact: true })).toBeFocused();
    }
    await page.keyboard.press('Enter');
    await expect(rows.nth(7).getByTestId('mktg-comment-body')).toContainText('Full explanation 7.');
    await expect(panel.getByTestId('mktg-comment-body')).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('one-comment-expanded-in-place.png'), fullPage: true });
  });

  test('adds a pinned comment to the selected field and lists its author/date in the panel', async ({ page }) => {
    const fixture = await setupComments(page);
    await fixture.open();
    const panel = page.getByTestId('mktg-comments-panel');
    await expect(panel.getByTestId('mktg-comments-empty')).toBeVisible();
    const field = page.getByTestId('mktg-field-comments-mf.positioning');
    await field.hover();
    await field.getByRole('button', { name: 'Comment on Positioning', exact: true }).click();
    await expect(field.getByRole('button', { name: 'Comment on Positioning', exact: true })).toBeFocused();
    await field.getByRole('textbox', { name: 'Comment on Positioning', exact: true }).fill('Make it one clause about the neutral foundation.');
    await field.getByRole('button', { name: 'Add comment', exact: true }).click();
    await expect(field.getByRole('button', { name: 'Comment on Positioning', exact: true })).toBeFocused();
    await field.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(field.getByTestId('mktg-comment-body')).toContainText('Make it one clause');
    const status = field.getByTestId('mktg-comment-thread').getByText('Open', { exact: true });
    await expect(status).toHaveClass('inline-flex w-fit items-center rounded-full bg-gray-100 px-2 py-px text-xs font-medium text-gray-700');
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
    const panel = page.getByTestId('mktg-comments-panel');
    await panel.getByRole('button', { name: 'Details', exact: true }).click();
    await expect(panel.getByTestId('mktg-comment-body')).toHaveText('Use a shorter synthetic tagline.');
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
