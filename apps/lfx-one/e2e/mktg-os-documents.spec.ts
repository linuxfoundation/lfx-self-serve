// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { MKTG_DOCUMENT_TYPES, MKTG_LAST_INTAKE_API } from '../../../packages/shared/src/constants';

import {
  DOCUMENTS_URL,
  DOCUMENT_VIEW_URL,
  DOCUMENT_TYPE,
  documentFixture,
  fulfillDocumentJson,
  openDocuments,
  setupDocuments,
  startedDocumentRun,
} from './helpers/mktg-os-documents.helper';

test.describe('Marketing OS current revisions', () => {
  const progressReadTimeout = 15_000;
  test.use({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test.afterEach(async ({ page }, testInfo) => {
    await page.screenshot({ path: testInfo.outputPath('final-state.png'), fullPage: true });
  });

  for (const [state, text] of [
    ['writing', 'Writing the document'],
    ['questions', 'Waiting for your answers'],
    ['storing', 'Storing the revision'],
    ['failed', 'A previous run did not finish'],
  ] as const) {
    test(`shows a ${state} run before a draft exists without claiming empty history`, async ({ page }) => {
      const run = startedDocumentRun(state);
      await setupDocuments(page, { empty: true, runs: [run] });
      await openDocuments(page);
      await expect(page.getByTestId(`mktg-documents-started-run-${run.runId}`)).toContainText(text);
      await expect(page.getByTestId('mktg-documents-pending-document')).toBeVisible();
      await expect(page.getByTestId('mktg-documents-empty-living')).toHaveCount(0);
      await expect(page.getByTestId(`mktg-documents-open-started-${run.runId}`)).toHaveAttribute('href', new RegExp(`run=${run.runId}`));
      await page.getByTestId(`mktg-documents-open-started-${run.runId}`).click();
      await expect(page.getByTestId('mktg-document-view-run')).toBeVisible();
      await expect(page.getByTestId('mktg-document-view-revision-chip')).toHaveCount(0);
      if (state === 'failed') {
        const details = page.getByTestId('mktg-document-view-failure-details');
        await expect(details).not.toHaveAttribute('open');
        await details.locator('summary').click();
        await expect(page.getByTestId('mktg-document-view-failure-reply')).toHaveText(run.failureText ?? '');
      }
    });
  }

  test('labels a Member 360 questions run as paused in the started list and navigation', async ({ page }) => {
    const run: ReturnType<typeof startedDocumentRun> = { ...startedDocumentRun('questions'), agentKey: 'member-360', documentId: 'run-' + 'c'.repeat(24) };
    await setupDocuments(page, { empty: true, runs: [run] });
    await openDocuments(page);
    const row = page.getByTestId(`mktg-documents-started-run-${run.runId}`);
    await expect(row).toContainText('Paused — the run needs input');
    await expect(row).not.toContainText('Waiting for your answers');
    await expect(page.getByTestId('mktg-documents-nav-member-360')).toContainText('Paused');
    await expect(page.getByTestId('mktg-documents-nav-member-360')).not.toContainText('Needs answers');
  });

  test('opens a Started run before its first revision without crashing', async ({ page }) => {
    const run = startedDocumentRun('writing');
    await setupDocuments(page, { empty: true, runs: [run] });
    await openDocuments(page);
    await page.getByTestId(`mktg-documents-open-started-${run.runId}`).click();
    await expect(page.getByTestId('mktg-document-view-page')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-error')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-page')).toContainText('will appear');
    await expect(page.getByTestId('mktg-document-view-revisions')).toHaveCount(0);
  });

  test('recovers an initial list failure with a same-scope Refresh progress', async ({ page }) => {
    await setupDocuments(page);
    let reads = 0;
    await page.route('**/api/mktg-agents/documents?*', (route) => {
      reads++;
      if (reads === 1) return fulfillDocumentJson(route, { error: 'Synthetic list outage' }, 500);
      return route.fallback();
    });
    await openDocuments(page);
    await expect(page.getByTestId('mktg-documents-list-failed')).toBeVisible();
    await page.getByTestId('mktg-documents-refresh-progress').getByRole('button').click();
    await expect(page.getByTestId('mktg-documents-list-failed')).toHaveCount(0);
    await expect(page.getByTestId('mktg-documents-error')).toHaveCount(0);
    await expect(page.getByTestId('mktg-documents-revisions')).toBeVisible();
    expect(reads).toBe(2);
  });

  test('Retry checks the recorded run without a Generate POST and keeps current selection', async ({ page }) => {
    let generates = 0;
    await setupDocuments(page, { runs: [startedDocumentRun('failed')] });
    await page.route('**/api/mktg-agents/*/generate', (route) => {
      generates++;
      return fulfillDocumentJson(route, {}, 500);
    });
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&run=${startedDocumentRun().runId}`);
    const details = page.getByTestId('mktg-document-view-failure-details');
    await expect(details).not.toHaveAttribute('open');
    await details.locator('summary').click();
    await expect(page.getByTestId('mktg-document-view-failure-reply')).toBeVisible();
    await page.getByTestId('mktg-document-view-progress-retry').getByRole('button', { name: 'Check on it again', exact: true }).click();
    await expect(page.getByTestId('mktg-document-view-failure-reply')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-run-steps')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-current-2')).toBeVisible();
    expect(generates).toBe(0);
  });

  test('opens the selected run without changing the stored current revision', async ({ page }) => {
    const run = startedDocumentRun();
    await setupDocuments(page, { runs: [run] });
    await page.route(`**${MKTG_LAST_INTAKE_API}/${DOCUMENT_TYPE.agentKey}/last?*`, (route) => fulfillDocumentJson(route, { intake: null }));
    await openDocuments(page);
    await page.getByTestId(`mktg-documents-open-started-${run.runId}`).click();
    await expect(page).toHaveURL(new RegExp(`run=${run.runId}`));
    await expect(page.getByTestId('mktg-document-view-revision-chip')).toContainText('Revision 2 of 3');
    await expect(page.getByTestId('mktg-document-view-current-2')).toBeVisible();
    await page.getByTestId('mktg-document-view-run-again').click();
    await expect(page.getByTestId('mktg-run-sources')).toBeVisible();
    await expect(page.getByTestId('mktg-run-start').getByRole('button')).toBeEnabled();
    await expect(page.getByTestId('mktg-run-start-reason')).toBeVisible();
    await expect(page.getByTestId('mktg-agent-run-result')).toHaveCount(0);
  });

  test('retains loaded revisions on a transient poll error and removes completed progress after retry', async ({ page }) => {
    const runs = [startedDocumentRun()];
    await setupDocuments(page, { runs });
    let polls = 0;
    await page.route(/\/api\/mktg-agents\/documents\?/, async (route) => {
      if (new URL(route.request().url()).searchParams.get('poll') !== '1') return route.fallback();
      if (++polls === 1) return fulfillDocumentJson(route, {}, 503);
      runs.length = 0;
      return route.fallback();
    });
    await openDocuments(page);
    await expect(page.getByTestId('mktg-documents-refresh-warning')).toContainText('last loaded', { timeout: progressReadTimeout });
    await expect(page.getByTestId('mktg-documents-current-2')).toBeVisible();
    await expect(page.getByTestId('mktg-documents-started-runs')).toHaveCount(0, { timeout: progressReadTimeout });
    await expect(page.getByTestId('mktg-documents-refresh-warning')).toHaveCount(0);
    await expect(page.getByTestId(`mktg-documents-nav-${DOCUMENT_TYPE.agentKey}`)).toContainText('v2 · current');
  });

  test('retains current selection on a transient type refetch and offers manual refresh', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page);
    await expect(page.getByTestId('mktg-documents-current-2')).toBeVisible();
    let failReload = true;
    await page.route(/\/api\/mktg-agents\/documents\?/, async (route) => {
      if (failReload) {
        failReload = false;
        return fulfillDocumentJson(route, {}, 503);
      }
      return route.fallback();
    });
    await page.getByTestId('mktg-documents-nav-faq').click();
    await expect(page.getByTestId('mktg-documents-refresh-warning')).toContainText('last loaded');
    await page.getByTestId('mktg-documents-refresh-progress').getByRole('button').click();
    await expect(page.getByTestId('mktg-documents-refresh-warning')).toHaveCount(0);
    await page.getByTestId(`mktg-documents-nav-${DOCUMENT_TYPE.agentKey}`).click();
    await expect(page.getByTestId('mktg-documents-current-2')).toBeVisible();
    await expect(page.getByTestId('mktg-documents-revisions').locator('tbody tr')).toHaveCount(3);
  });

  test('retains a known run instead of asserting absence when tracking becomes unavailable', async ({ page }) => {
    const run = startedDocumentRun();
    const options = { empty: true, runs: [run], progressUnavailable: false };
    await setupDocuments(page, options);
    await openDocuments(page);
    await expect(page.getByTestId(`mktg-documents-started-run-${run.runId}`)).toBeVisible();
    options.runs = [];
    options.progressUnavailable = true;
    await expect(page.getByTestId('mktg-documents-refresh-warning')).toContainText('Retrying', { timeout: progressReadTimeout });
    await expect(page.getByTestId(`mktg-documents-started-run-${run.runId}`)).toBeVisible();
    await expect(page.getByTestId('mktg-documents-empty-living')).toHaveCount(0);
    await expect(page.getByTestId('mktg-documents-pending-document')).toContainText('unavailable');
    await expect(page.getByTestId('mktg-documents-nav')).not.toContainText(/Not generated yet|No runs yet/);
    await expect(page.getByTestId('mktg-documents-refresh-progress').getByRole('button')).toBeVisible();
  });

  for (const state of ['unavailable', 'started']) {
    test(`one-off ${state} progress never asserts that no runs exist`, async ({ page }) => {
      const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'linkedin-post');
      if (!type) throw new Error('Missing synthetic one-off document type');
      await setupDocuments(page, {
        empty: true,
        progressUnavailable: state === 'unavailable',
        runs: state === 'started' ? [{ ...startedDocumentRun(), agentKey: type.agentKey }] : [],
      });
      const url = new URL(DOCUMENTS_URL, 'http://localhost');
      url.searchParams.set('type', type.agentKey);
      await openDocuments(page, url.pathname + url.search);
      await expect(page.getByTestId('mktg-documents-empty-runs')).toHaveCount(0);
      await expect(page.getByTestId('mktg-documents-pending-run')).toContainText(state === 'unavailable' ? 'unavailable' : 'recorded run');
    });
  }

  test('does not expose progress to a project reader without writer access', async ({ page }) => {
    await setupDocuments(page, { writer: false, runs: [startedDocumentRun()] });
    await openDocuments(page);
    await expect(page.getByTestId('mktg-documents-error')).toContainText('write access');
    await expect(page.getByTestId('mktg-documents-started-runs')).toHaveCount(0);
    await expect(page.getByTestId('mktg-documents-empty-living')).toHaveCount(0);
  });

  test('keeps table attribution but simplifies the document side panel and Make current help', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page);
    await expect(page.getByTestId('mktg-documents-revision-3')).toContainText('The writer');
    await expect(page.getByTestId('mktg-documents-revision-3')).toContainText('revised from 4 comments · based on v1');
    await expect(page.getByTestId('mktg-documents-revision-2')).toContainText('Current');
    await expect(page.getByTestId('mktg-documents-revision-1')).toContainText('no name (stored before names were recorded)');
    await expect(page.getByTestId('mktg-documents-revision-2')).toContainText('name unavailable');
    await page.getByTestId('mktg-documents-view-latest').click();
    await expect(page.getByTestId('mktg-document-view-revision-chip')).toContainText('Revision 2 of 3');
    await expect(page.getByTestId('mktg-document-view-revision-label-3')).toHaveText('v3 · Draft · 13 Oct');
    await expect(page.getByTestId('mktg-document-view-revision-label-1')).toHaveText('v1 · Draft · 13 Oct');
    await expect(page.getByTestId('mktg-document-view-revision-label-2')).toHaveText('v2 · Draft · 13 Oct · Current');
    await expect(page.getByTestId('mktg-document-view-current-2')).toHaveText('Current');
    await expect(page.locator('[data-testid^="mktg-document-view-current-since-"]')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-hash')).toHaveCount(0);
    await expect(page.getByText('Make current selects the revision agents read.', { exact: false })).toHaveCount(0);
    const makeCurrent = page.getByTestId('mktg-document-view-restore-1');
    const hint = 'Agents read the current version. Nothing is added or deleted.';
    await makeCurrent.hover();
    await expect(page.getByRole('tooltip')).toHaveText(hint);
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await makeCurrent.focus();
    await expect(page.getByRole('tooltip')).toHaveText(hint);
    await page.screenshot({ path: test.info().outputPath('document-side-panel-focus-help.png'), fullPage: true });
  });

  test('historical documents default to newest without inventing current-selection attribution', async ({ page }) => {
    await setupDocuments(page, { withoutCurrentRecord: true });
    await openDocuments(page, DOCUMENT_VIEW_URL);
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 3');
    await expect(page.getByTestId('mktg-document-view-revision-3')).toContainText('Current');
    await expect(page.locator('[data-testid^="mktg-document-view-current-since-"]')).toHaveCount(0);
  });

  test('Make current adds no revision and opening another revision clears success', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture().revisions[2].id}`);
    await page.getByTestId('mktg-document-view-history-bar-make-current').click();
    await expect(page.getByTestId('mktg-document-view-history-bar')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-notice')).toContainText('No revision was added');
    await expect(page.getByTestId('mktg-document-view-revision-chip')).toContainText('Revision 1 of 3');
    await expect(page.getByTestId('mktg-document-view-revision-1')).toContainText('Current');
    await expect(page.locator('[data-testid^="mktg-document-view-current-since-"]')).toHaveCount(0);
    await page.getByTestId('mktg-document-view-open-3').click();
    await expect(page.getByTestId('mktg-document-view-notice')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 3');
  });

  test('nine revisions keep older open/current rows visible and expand in place', async ({ page }) => {
    await setupDocuments(page, { revisionCount: 9, currentRevisionNumber: 2 });
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture(9, 2).revisions[8].id}`);
    const list = page.getByTestId('mktg-document-view-revisions');
    await expect(list.locator('ol > li')).toHaveCount(7);
    await expect(page.getByTestId('mktg-document-view-revision-1')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-revision-2')).toContainText('Current');
    await expect(page.getByTestId('mktg-document-view-revision-3')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-show-all-revisions')).toHaveText('Show all 9 ▾');
    await page.getByTestId('mktg-document-view-show-all-revisions').click();
    await expect(list.locator('ol > li')).toHaveCount(9);
    await page.getByTestId('mktg-document-view-open-3').click();
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 3');
    await expect(list.locator('ol > li')).toHaveCount(9);
    await expect(page.getByTestId('mktg-document-view-restore-current')).toHaveCount(0);
  });

  test('the subtle bar goes back to current and makes the open revision current', async ({ page }) => {
    await setupDocuments(page, { revisionCount: 9, currentRevisionNumber: 9 });
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture(9, 9).revisions[2].id}`);
    await expect(page.getByTestId('mktg-document-view-history-bar-summary')).toHaveText("You're viewing v7 · 13 Oct · The writer · v9 is current");
    await expect(page.getByTestId('mktg-document-view-history-bar-make-current')).toHaveAccessibleName('Make v7 current');
    await expect(page.getByTestId('mktg-document-view-history-bar-back')).toHaveAccessibleName('Back to v9');
    await expect(page.getByTestId('mktg-document-view-history-bar-back')).not.toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('mktg-document-view-history-bar-back').click();
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 9');
    await expect(page.getByTestId('mktg-document-view-history-bar')).toHaveCount(0);
    await page.getByTestId('mktg-document-view-open-7').click();
    await page.getByTestId('mktg-document-view-history-bar-make-current').click();
    await expect(page.getByTestId('mktg-document-view-history-bar')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-revision-chip')).toContainText('Revision 7 of 9');
    await expect(page.getByTestId('mktg-document-view-revision-7')).toContainText('Current');
  });

  test('keyboard focus reveals the complete clipped history summary', async ({ page }) => {
    const name = 'The writer responsible for the synthetic document revision and its detailed review notes';
    await setupDocuments(page, { revisionCount: 9, currentRevisionNumber: 9, revisionAuthorName: name });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture(9, 9).revisions[2].id}`);
    const summary = page.getByTestId('mktg-document-view-history-bar-summary');
    await expect(summary).toBeVisible();
    expect(await summary.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.getByTestId('mktg-document-view-run-again').focus();
    await page.keyboard.press('Tab');
    await expect(summary).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText(`You're viewing v7 · 13 Oct · ${name} · v9 is current`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.getByTestId('mktg-document-view-history-bar-back').click();
    await expect(page.getByTestId('mktg-document-view-history-bar')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 9');
  });

  test('the phone bar uses the short copy without losing Make current', async ({ page }) => {
    await setupDocuments(page, { revisionCount: 9, currentRevisionNumber: 9 });
    await page.setViewportSize({ width: 390, height: 1000 });
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture(9, 9).revisions[2].id}`);
    await expect(page.getByTestId('mktg-document-view-history-bar-mobile-summary')).toHaveText('Viewing v7');
    await expect(page.getByTestId('mktg-document-view-history-bar-make-current')).toHaveAccessibleName('Make current');
    await expect(page.getByTestId('mktg-document-view-history-bar-back')).toHaveAccessibleName('Back');
    await page.getByTestId('mktg-document-view-history-bar-make-current').click();
    await expect(page.getByTestId('mktg-document-view-history-bar')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-revision-chip')).toContainText('Revision 7 of 9');
  });

  test('opens older revisions rather than making them current from the table', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page);
    await expect(page.getByTestId('mktg-documents-revisions').getByRole('button')).toHaveCount(0);
    await expect(page.getByText('To switch back to an older one, open it and choose Make current there;', { exact: false })).toBeVisible();
    await expect(page.getByTestId('mktg-documents-run-again-' + DOCUMENT_TYPE.agentKey)).toHaveText('Create a new version');
    await expect(page.getByTestId('mktg-documents-view-latest').getByRole('link')).toHaveAccessibleName('Open');
    await page.getByTestId('mktg-documents-view-1').click();
    await expect(page.getByTestId('mktg-document-view-history-bar-make-current')).toBeVisible();
  });

  test('empty documents follow their family header without starting a live session', async ({ page }) => {
    const framework = MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === 'foundation-message');
    if (!framework) throw new Error('Framework type must exist');
    await setupDocuments(page, { empty: true, documentType: framework });
    await openDocuments(page, DOCUMENTS_URL.replace(`type=${DOCUMENT_TYPE.agentKey}`, `type=${framework.agentKey}`));
    await expect(page.getByTestId('mktg-documents-empty-living')).toBeVisible();
    const run = page.locator('[data-testid^="mktg-documents-run-agent-"]').getByRole('link');
    await expect(run).toHaveAccessibleName('Create messaging framework');
    await expect(run).toHaveAttribute('href', /mktg-os-agents\//);
    await run.click();
    await expect(page).not.toHaveURL(/\/documents\?/);
  });

  for (const status of [403, 404, 500]) {
    test(`load failure ${status} is distinct from an empty document`, async ({ page }) => {
      await setupDocuments(page, { status, writer: status !== 403 });
      await openDocuments(page, DOCUMENT_VIEW_URL);
      const error = page.getByTestId('mktg-document-view-error');
      if (status === 403) await expect(error).toContainText('write access');
      else if (status === 404) await expect(error).toContainText('This document could not be found');
      else await expect(error).toContainText('could not be loaded');
      await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    });
  }

  for (const writeStatus of [403, 404, 412]) {
    test(`Make current failure ${writeStatus} preserves the open body`, async ({ page }) => {
      await setupDocuments(page, { writeStatus });
      await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture().revisions[2].id}`);
      await page.getByTestId('mktg-document-view-history-bar-make-current').click();
      await expect(page.getByTestId('mktg-document-view-error')).toBeVisible();
      await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 1');
      await expect(page.getByTestId('mktg-document-view-history-bar-make-current')).toBeEnabled();
    });
  }
});
