// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { MEMBER_360_DOCUMENT_ID, openMember360, setupMember360 } from './helpers/member-360.helper';
import { columnAssetRevisionResponse, openAssetDocument, openDraftAssetRun } from './helpers/mktg-os-asset-views.helper';
import { DOCUMENT_VIEW_URL, openDocuments, setupDocuments } from './helpers/mktg-os-documents.helper';

for (const key of ['foundation-message', 'brand-kit', 'boilerplates', 'faq'] as const) {
  for (const width of [1440, 1280, 1024, 390]) {
    test(`${key} keeps revision details beside the content only at laptop widths (${width}px)`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await openAssetDocument(page, key, 200, true, false, columnAssetRevisionResponse(key));
      const root = page.getByTestId('mktg-document-view-page');
      const content = root.getByRole('region', { name: 'Document content' });
      const details = root.getByRole('region', { name: 'Revision details' });
      await expect(content.getByRole('tablist')).toBeVisible();
      await expect(details.getByTestId('mktg-document-view-about')).toBeVisible();
      const tabs = content.getByRole('tab');
      for (const tab of await tabs.all()) {
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expect(content.getByRole('tabpanel')).toBeVisible();
        const main = await content.boundingBox();
        const side = await details.boundingBox();
        if (!main || !side) throw new Error('Both document columns must be rendered');
        const host = await page.getByTestId('mktg-document-view-width').evaluate((element) => element.clientWidth);
        const diagnostic = `${key}, viewport ${width}px, host ${host}px, tab ${await tab.textContent()}`;
        if (width >= 1280) {
          expect(side.x, diagnostic).toBeGreaterThanOrEqual(main.x + main.width);
          expect(Math.abs(side.y - main.y), diagnostic).toBeLessThan(2);
        } else {
          expect(side.y, diagnostic).toBeGreaterThanOrEqual(main.y + main.height);
        }
        expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)), diagnostic).toBeLessThanOrEqual(width);
        const panel = await content.getByRole('tabpanel').boundingBox();
        if (!panel) throw new Error('The selected asset panel must be rendered');
        expect(panel.x + panel.width, diagnostic).toBeLessThanOrEqual(main.x + main.width + 1);
      }
      await tabs.first().click();
      await page.screenshot({ path: info.outputPath(`${key}-columns-${width}.png`), fullPage: true });
    });
  }
}

for (const width of [1280, 390]) {
  test(`plain Markdown keeps revision details beside the content only at laptop widths (${width}px)`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await setupDocuments(page); // Calls suppressCookieBanner(page) before navigation.
    await openDocuments(page, DOCUMENT_VIEW_URL);
    const root = page.getByTestId('mktg-document-view-page');
    const content = root.getByRole('region', { name: 'Document content' });
    const details = root.getByRole('region', { name: 'Revision details' });
    await expect(content.getByTestId('mktg-document-view-document')).toContainText('Revision 2');
    await expect(details.getByTestId('mktg-document-view-revisions')).toBeVisible();
    await expect(details.getByTestId('mktg-document-view-about')).toBeVisible();
    const main = await content.boundingBox();
    const side = await details.boundingBox();
    if (!main || !side) throw new Error('Markdown content and revision details must be rendered');
    if (width === 1280) {
      expect(side.x).toBeGreaterThanOrEqual(main.x + main.width);
      expect(Math.abs(side.y - main.y)).toBeLessThan(2);
    } else {
      expect(side.y).toBeGreaterThanOrEqual(main.y + main.height);
    }
    await page.screenshot({ path: info.outputPath(`markdown-columns-${width}.png`), fullPage: true });
  });
}

test('Member 360 Run history stays in the right-hand result column at 1280px', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await setupMember360(page, { stored: true }); // Calls suppressCookieBanner(page) before navigation.
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  const result = page.getByTestId('member-360-result');
  const history = result.getByTestId('member-360-result-history');
  const aside = result.getByRole('complementary');
  await expect(history.getByRole('heading', { name: 'Run history', exact: true })).toBeVisible();
  const main = await result.getByTestId('member-360-actions').boundingBox();
  const side = await aside.boundingBox();
  const historyBox = await history.boundingBox();
  if (!main || !side || !historyBox) throw new Error('Member 360 actions and Run history columns must be rendered');
  expect(side.x).toBeGreaterThanOrEqual(main.x + main.width);
  expect(Math.abs(side.y - main.y)).toBeLessThan(2);
  expect(historyBox.x).toBeGreaterThanOrEqual(main.x + main.width);
  await page.screenshot({ path: info.outputPath('member-360-history-columns-1280.png'), fullPage: true });
});

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
    await expect(page.getByTestId('mktg-document-view-page').getByRole('region', { name: 'Document content' })).not.toHaveClass(/col-span-2/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`structure-${width}.png`), fullPage: true });
  });

  test(`a Draft lands in the document frame at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const fixture = await openDraftAssetRun(page);
    await expect(page.getByTestId('mktg-agent-run-status')).toContainText('You can leave');
    await expect(page.getByTestId('mktg-document-view-page')).toHaveCount(0);
    fixture.finish();
    await expect(page).toHaveURL(new RegExp('revision=' + fixture.revisionId), { timeout: 20_000 });
    await expect(page.getByTestId('mktg-document-view-framework')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-metadata')).toHaveCount(1);
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Draft');
    await expect(page.getByTestId('mktg-document-view-meta')).toContainText('v1');
    await expect(page.getByTestId('mktg-framework-view-metadata')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open in Documents', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-approve')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`draft-structure-${width}.png`), fullPage: true });
  });
}
