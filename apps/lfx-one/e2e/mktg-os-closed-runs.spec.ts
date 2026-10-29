// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DOCUMENT_TYPE, DOCUMENT_VIEW_URL, documentFixture, openDocuments, setupDocuments, startedDocumentRun } from './helpers/mktg-os-documents.helper';

test('keeps a run discarded elsewhere visible as a closed run instead of opening older output', async ({ page }, info) => {
  await suppressCookieBanner(page);
  const closed = startedDocumentRun('discarded');
  await setupDocuments(page, { runs: [] });
  await page.route(`**/api/mktg-agents/documents/${DOCUMENT_TYPE.agentKey}/living?*`, (route) => {
    expect(new URL(route.request().url()).searchParams.get('run')).toBe(closed.runId);
    return route.fulfill({ json: { ...documentFixture(), runs: [closed] } });
  });
  const root = DOCUMENT_VIEW_URL.split('/documents/')[0];
  const project = new URL(DOCUMENT_VIEW_URL, 'http://localhost').searchParams.get('project');
  const url = `${root}/${DOCUMENT_TYPE.catalogAgentId}?project=${project}&run=${closed.runId}`;
  await page.evaluate((destination) => {
    history.pushState({}, '', destination);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
  await expect(page.getByTestId('mktg-run-progress-closed-message')).toHaveText('This run was discarded.');
  await expect(page.getByTestId('mktg-run-progress-live')).toHaveCount(0);
  await expect(page).toHaveURL(url);
  await page.screenshot({ path: info.outputPath('discarded-run-page.png'), fullPage: true });
});

test('names the discarding writer and opens the exact replacement run', async ({ page }, info) => {
  await suppressCookieBanner(page);
  const newer = { ...startedDocumentRun('writing'), runId: 'c'.repeat(64) };
  const closed = { ...startedDocumentRun('discarded'), closedAt: '2026-10-19T13:00:00Z', closedBy: 'Synthetic writer', replacedBy: newer.runId };
  await setupDocuments(page, { empty: true, runs: [newer] });
  await page.route(`**/api/mktg-agents/documents/${DOCUMENT_TYPE.agentKey}/living?*`, (route) =>
    route.fulfill({ json: { ...documentFixture(), current: null, revisions: [], runs: [closed, newer] } })
  );
  await openDocuments(page, `${DOCUMENT_VIEW_URL}&run=${closed.runId}`);
  await expect(page.getByTestId('mktg-document-view-closed-message')).toContainText('This run was discarded by Synthetic writer at');
  const link = page.getByTestId('mktg-document-view-newer-run');
  await expect(link).toHaveText('Open the newer run');
  await expect(link).toHaveAttribute('href', `${DOCUMENT_VIEW_URL}&run=${newer.runId}`);
  await link.click();
  await expect(page).toHaveURL(
    (url) => url.pathname === `${DOCUMENT_VIEW_URL.split('/documents/')[0]}/${DOCUMENT_TYPE.catalogAgentId}` && url.searchParams.get('run') === newer.runId
  );
  await expect(page.getByTestId('mktg-document-view-closed-run')).toHaveCount(0);
  await expect(page.getByTestId('mktg-run-public-progress')).toBeVisible();
  await page.screenshot({ path: info.outputPath('replacement-run.png'), fullPage: true });
});

for (const state of ['discarded', 'superseded'] as const) {
  test(`explains the ${state} run and opens the newer Started run list`, async ({ page }, info) => {
    await suppressCookieBanner(page);
    const closed = { ...startedDocumentRun(state), closedAt: '2026-10-19T13:00:00Z' };
    const newer = { ...startedDocumentRun('writing'), runId: 'c'.repeat(64) };
    await setupDocuments(page, { empty: true, runs: [newer] });
    await page.route(`**/api/mktg-agents/documents/${DOCUMENT_TYPE.agentKey}/living?*`, (route) =>
      route.fulfill({ json: { ...documentFixture(), current: null, revisions: [], runs: [closed, newer] } })
    );
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&run=${closed.runId}`);
    const message = page.getByTestId('mktg-document-view-closed-message');
    if (state === 'discarded') {
      await expect(message).toContainText('This run was discarded at');
      await expect(message).not.toContainText('a newer run was started');
    } else await expect(message).toHaveText('A newer run replaced this one.');
    await expect(page.getByTestId('mktg-document-view-newer-run')).toHaveText('View started runs');
    await expect(page.getByTestId('mktg-document-view-run-steps')).toHaveCount(0);
    await expect(page.getByTestId('mktg-run-activity-steps')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-progress-retry')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('closed-run.png'), fullPage: true });
    await page.getByTestId('mktg-document-view-newer-run').click();
    await expect(page.getByTestId(`mktg-documents-started-run-${newer.runId}`)).toBeVisible();
    await expect(page.getByTestId(`mktg-documents-started-run-${closed.runId}`)).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('newer-started-run.png'), fullPage: true });
  });
}
