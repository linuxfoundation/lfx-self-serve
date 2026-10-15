// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

import { runRevision, setupRunPage } from './helpers/mktg-os-runs.helper';

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
