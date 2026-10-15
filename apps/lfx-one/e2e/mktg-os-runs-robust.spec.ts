// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, fillRunIntake, runRevision, setupRunPage } from './helpers/mktg-os-runs.helper';

test.describe('Marketing OS run/document structure and access states', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(() => test.skip(!process.env['TEST_USERNAME'] || !process.env['TEST_PASSWORD'], 'Test session credentials are not configured.'));

  test('intake only, required fields, and responsive layout', async ({ page }, testInfo) => {
    expect(() => runRevision('unregistered-fixture-type')).toThrow('Unknown Marketing OS document type in run fixture: unregistered-fixture-type');
    const run = await setupRunPage(page);
    await run.open();
    await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
    await expect(page.getByTestId('mktg-agent-run-submit-button').locator('button')).toBeDisabled();
    await expect(page.getByTestId('mktg-agent-run-result')).toHaveCount(0);
    await expect(page.getByText('Request changes', { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await testInfo.attach('mobile-intake', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('sidebar stays top-right while generating and after, and stacks only on phones', async ({ page }, testInfo) => {
    const run = await setupRunPage(page, { existing: true });
    await run.open();
    await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
    await fillRunIntake(page);
    await page.getByTestId('mktg-agent-run-submit-button').click();
    await expect(page.getByTestId('mktg-document-view-generating')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-sidebar')).toBeVisible();

    const expectColumns = async (stacked: boolean): Promise<void> => {
      await expect
        .poll(async () => {
          const document = await page.getByTestId('mktg-document-view-main').boundingBox();
          const sidebar = await page.getByTestId('mktg-document-view-sidebar').boundingBox();
          if (!document || !sidebar) {
            return false;
          }
          if (stacked) {
            return sidebar.y >= document.y + document.height && Math.abs(sidebar.x - document.x) < 2;
          }
          return sidebar.x >= document.x + document.width && Math.abs(sidebar.y - document.y) < 2;
        })
        .toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const revisionLabel = page.getByTestId(/^mktg-document-view-revision-label-/).first();
      await expect(revisionLabel).toHaveCSS('text-align', 'left');
      await expect(revisionLabel).toHaveCSS('white-space', 'normal');
      const provenance = page.getByTestId(/^mktg-document-view-revision-how-/).first();
      await expect(provenance).toHaveText('Generated from the form');
      await expect(provenance).toHaveCSS('display', 'block');
      await expect(provenance).toHaveCSS('white-space', 'normal');
      await expect(provenance).toHaveCSS('text-overflow', 'clip');
    };

    for (const width of [1440, 1280, 1100, 1024, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await expectColumns(false);
      const progress = await page.getByTestId('mktg-document-view-generating').boundingBox();
      const document = await page.getByTestId('mktg-document-view-main').boundingBox();
      expect(progress && document && progress.y + progress.height <= document.y).toBe(true);
      if (width === 1280) {
        await testInfo.attach('desktop-generating-sidebar', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expectColumns(true);
    await testInfo.attach('phone-generating-sidebar', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

    run.finish();
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Synthetic revision 2', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-generating')).toHaveCount(0);
    await expectColumns(true);
    await testInfo.attach('phone-loaded-sidebar', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    for (const width of [768, 1024, 1100, 1440, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expectColumns(false);
    }
    await testInfo.attach('desktop-loaded-sidebar', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('loading and empty document states are distinct', async ({ page }, testInfo) => {
    const run = await setupRunPage(page, { holdRead: true });
    await run.open('documents/brand-kit/living');
    await expect(page.getByRole('status').filter({ hasText: 'Loading the document' })).toBeVisible();
    run.releaseRead();
    await expect(page.getByTestId('mktg-document-view-error')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-generating')).toHaveCount(0);
    await testInfo.attach('not-generated', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('non-writer sees the access message, never a document or generation promise', async ({ page }, testInfo) => {
    const run = await setupRunPage(page, { writer: false });
    await run.open('documents/brand-kit/living');
    await expect(page.getByTestId('mktg-document-view-error')).toContainText('write access');
    await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-generating')).toHaveCount(0);
    await testInfo.attach('document-no-access', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
});
