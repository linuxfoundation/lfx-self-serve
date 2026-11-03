// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { AUDIT_MARKDOWN, PAGE_LOAD_TIMEOUT, setupAudit } from './helpers/mktg-os-aeo-geo.helper';
import { MKTG_POLL_RETRYING_TEXT } from '@lfx-one/shared/constants';

test('the Kit Website & web family opens the audit form from Create', async ({ page }, testInfo) => {
  const app = await setupAudit(page, { previous: true });
  await app.go('');
  const family = page.getByTestId('mktg-kit-family-link-website-web');
  await expect(family).toHaveText('Website & web');
  await family.click();
  await expect(page).toHaveURL(/\/families\/website-web\?project=/);
  const run = page.getByTestId('mktg-family-run').getByRole('link');
  await expect(run).toHaveText('Create AEO/GEO scorecard');
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.getByTestId('mktg-aeo-run-form')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-page')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('family-run-intake.png'), fullPage: true });
});

for (const width of [390, 768, 1440]) {
  test(`audit form and the one Document report stay usable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const app = await setupAudit(page, { previous: true });
    await app.go('/aeo-geo');
    const form = page.getByTestId('mktg-aeo-run-form');
    await expect(form).toBeVisible();
    await expect(form.getByLabel('The website to audit', { exact: false })).toBeVisible();
    await page.getByTestId('mktg-aeo-run-add-page').click();
    await page.getByTestId('mktg-aeo-run-add-page').click();
    await expect(form.getByRole('textbox', { name: /^Key page/ })).toHaveCount(5);
    await expect(page.getByTestId('mktg-aeo-run-add-page')).toHaveCount(0);
    await expect(page.getByTestId('mktg-breadcrumb-link-0')).toBeVisible();
    await expect(page.getByTestId('mktg-aeo-run-all-reports-link')).toBeVisible();
    const open = page.locator('[data-testid^="mktg-aeo-run-open-"]');
    await expect(open).toHaveCount(1);
    await open.click();
    const documentView = page.getByTestId('mktg-document-view-page');
    await expect(documentView.getByTestId('mktg-document-view-report-summary')).toBeVisible();
    const scorecard = documentView.getByTestId('mktg-document-view-scorecard');
    await expect(scorecard.locator('[data-testid^="mktg-document-view-score-"]')).toHaveCount(6);
    await expect(scorecard.getByTestId('mktg-document-view-score-ai_crawler_access')).toContainText('9/10');
    await expect(scorecard.getByTestId('mktg-document-view-score-llms_txt')).toContainText('3/10');
    await expect(documentView.getByTestId('mktg-document-view-revisions')).toBeVisible();
    await expect(documentView.getByRole('button', { name: /Restore|Revise/ })).toHaveCount(0);
    await expect(documentView.getByTestId('mktg-document-view-download')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`report-${width}.png`), fullPage: true });
  });
}

test('a new audit uses the Document generating state while no report is stored', async ({ page }, testInfo) => {
  const app = await setupAudit(page);
  app.state.reportReady = true;
  await app.go('/aeo-geo');
  await page.getByTestId('mktg-aeo-run-submit').click();
  await expect(page.getByTestId('mktg-document-view-generating')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId('mktg-document-view-scorecard')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('generating-document.png'), fullPage: true });
});

test('a missing document is an explicit error, not an invented scorecard', async ({ page }, testInfo) => {
  const app = await setupAudit(page);
  await app.go('/documents/aeo-geo/run-000000000000000000000099');
  await expect(page.getByTestId('mktg-document-view-error')).toContainText('no such revision');
  await expect(page.getByTestId('mktg-document-view-scorecard')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-retry')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('missing-document.png'), fullPage: true });
});

test('a stored revision read outage shows the one plain line with no Check again button, then reopens the report on its own', async ({ page }, testInfo) => {
  const app = await setupAudit(page);
  app.state.reportReady = true;
  await app.go('/aeo-geo');
  await page.getByTestId('mktg-aeo-run-submit').click();
  await expect(page).toHaveURL(/\/documents\/aeo-geo\/run-/, { timeout: PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId('mktg-document-view-generating')).toBeVisible();
  app.state.revisionReadError = true;
  app.state.persisted = true;
  // The outage is one quiet status line beside the page, never the error box; no Check again button.
  await expect(page.getByTestId('mktg-document-view-refresh-warning')).toContainText(MKTG_POLL_RETRYING_TEXT, { timeout: PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId('mktg-document-view-refresh-warning')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('mktg-document-view-error')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-retry')).toHaveCount(0);
  expect(app.state.revisionReadFailures).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('stored-revision-read-outage.png'), fullPage: true });
  app.state.revisionReadError = false;
  await expect(page.getByTestId('mktg-document-view-verdict')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId('mktg-document-view-retry')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('stored-revision-read-recovered.png'), fullPage: true });
});

test('a permanent document-side polling error offers Run again, not Check again', async ({ page }, testInfo) => {
  const app = await setupAudit(page);
  let polls = 0;
  await page.route('**/api/mktg-agents/aeo-geo/result', (route) => {
    polls++;
    return route.fulfill(
      polls === 1
        ? { json: { status: 'ready', version: 1, documentMarkdown: AUDIT_MARKDOWN } }
        : { status: 400, json: { error: 'Synthetic report storage failure' } }
    );
  });
  await app.go('/aeo-geo');
  await page.getByTestId('mktg-aeo-run-submit').click();
  await expect(page).toHaveURL(/\/documents\/aeo-geo\/run-/, { timeout: PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId('mktg-document-view-error')).toContainText('could not be loaded', { timeout: PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId('mktg-document-view-retry')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-run-again')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-scorecard')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('pending-storage-error.png'), fullPage: true });
});
