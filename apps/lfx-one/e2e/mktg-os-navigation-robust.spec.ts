// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DOCUMENTS_URL, DOCUMENT_VIEW_URL, fulfillDocumentJson, openDocuments, setupDocuments } from './helpers/mktg-os-documents.helper';

test.describe('Marketing OS breadcrumb structure', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('navigation-structure.png'), fullPage: true });
  });

  for (const width of [390, 768, 1440]) {
    test(`fixed parents remain accessible and fit the page at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await setupDocuments(page);
      await openDocuments(page, DOCUMENT_VIEW_URL);
      const crumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
      await expect(crumb.locator('ol > li')).toHaveCount(3);
      await expect(crumb.getByRole('link')).toHaveCount(2);
      await expect(crumb.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(crumb.locator('[aria-current="page"] a')).toHaveCount(0);
      await expect(page.getByTestId('mktg-document-view-back-link')).toHaveCount(0);
      await crumb.getByTestId('mktg-breadcrumb-link-1').focus();
      await expect(crumb.getByTestId('mktg-breadcrumb-link-1')).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(page.getByTestId('mktg-document-view-document')).toBeVisible();
    });
  }

  test('All documents has a distinct empty state', async ({ page }) => {
    await setupDocuments(page, { empty: true });
    await openDocuments(page, DOCUMENTS_URL.replace(/&type=[^&]+/, ''));
    await expect(page.getByTestId('mktg-documents-empty-all')).toBeVisible();
    await expect(page.getByTestId('mktg-breadcrumb-current')).toHaveText('Documents');
    await expect(page.getByTestId('mktg-kit-tab-documents')).toHaveAttribute('aria-current', 'page');
  });

  for (const status of [403, 503]) {
    test(`a ${status} list failure keeps navigation and never claims an empty collection`, async ({ page }) => {
      await setupDocuments(page, { status, writer: status !== 403 });
      await openDocuments(page, DOCUMENTS_URL.replace(/&type=[^&]+/, ''));
      await expect(page.getByTestId('mktg-documents-error')).toBeVisible();
      await expect(page.getByTestId('mktg-documents-empty-all')).toHaveCount(0);
      await expect(page.getByTestId('mktg-breadcrumb-link-0')).toBeVisible();
      await expect(page.getByTestId('mktg-kit-tabs').getByRole('link')).toHaveCount(4);
    });
  }

  test('loading retains its parents without asserting an empty collection', async ({ page }) => {
    await setupDocuments(page);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/api\/mktg-agents\/documents\?/, async (route) => {
      await gate;
      await fulfillDocumentJson(route, { project: 'synthetic', groups: [] });
    });
    await openDocuments(page, DOCUMENTS_URL.replace(/&type=[^&]+/, ''));
    try {
      await expect(page.getByTestId('mktg-documents-loading')).toBeVisible();
      await expect(page.getByTestId('mktg-documents-empty-all')).toHaveCount(0);
      await expect(page.getByTestId('mktg-breadcrumb-link-0')).toBeVisible();
    } finally {
      release?.();
    }
    await expect(page.getByTestId('mktg-documents-empty-all')).toBeVisible();
  });
});
