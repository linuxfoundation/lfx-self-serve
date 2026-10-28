// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DOCUMENT_TYPE, DOCUMENT_VIEW_URL, documentFixture, openDocuments, setupDocuments, startedDocumentRun } from './helpers/mktg-os-documents.helper';

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
    if (state === 'discarded') await expect(message).toContainText('This run was discarded at');
    else await expect(message).toHaveText('A newer run replaced this one.');
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
