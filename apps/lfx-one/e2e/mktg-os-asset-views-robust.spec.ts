// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { openAssetDocument, openDraftAssetRun } from './helpers/mktg-os-asset-views.helper';

for (const width of [1440, 1280, 390]) {
  test(`FAQ structure at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openAssetDocument(page, 'faq');
    const view = page.getByTestId('mktg-faq-view');
    await expect(view).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-metadata')).toHaveCount(1);
    await expect(page.getByTestId('mktg-document-view-saving-status')).toHaveAttribute('role', 'status');
    await expect(page.getByTestId('mktg-document-view-saving-status')).toHaveAttribute('aria-live', 'polite');
    await expect(view.getByTestId('mktg-faq-view-title')).toHaveCount(0);
    await expect(view.getByTestId('mktg-faq-view-tabs')).toHaveCount(1);
    await expect(view.getByRole('button', { name: /Download PDF|Export to Google Slides/ })).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-revisions')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-page').getByRole('region', { name: 'Document content' })).toHaveClass(/col-span-2/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`structure-${width}.png`), fullPage: true });
  });

  test(`standalone Draft structure at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openDraftAssetRun(page);
    await expect(page.getByTestId('mktg-framework-view-metadata')).toHaveCount(1);
    await expect(page.getByTestId('mktg-framework-view-approval-state')).toHaveText('Draft');
    await expect(page.getByTestId('mktg-framework-view-meta')).toContainText('v1');
    await expect(page.getByRole('button', { name: 'Open in Documents', exact: true })).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-approve')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`draft-structure-${width}.png`), fullPage: true });
  });
}
