// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { MEMBER_360_INPUT_TIMEOUT_MESSAGE } from '@lfx-one/shared/constants';

import {
  json,
  MEMBER_360_DOCUMENT_ID,
  openMember360,
  setupMember360,
  selectMember360Option,
  member360Progress,
  stubMember360Progress,
} from './helpers/member-360.helper';
import { member360Revision } from './fixtures/mock-data/member-360.mock';
import { SYNTHETIC_ORG_NAME, SYNTHETIC_SECOND_ORG_LEGAL_NAME } from './fixtures/mock-data/synthetic-org.mock';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 60000 });
test.beforeEach(({ page, isMobile }) => {
  if (isMobile) expect(page.viewportSize()?.width).toBeLessThan(640);
});

test('Kit → Member family → run has fixed linked parents and browser Back', async ({ page }, info) => {
  // setupMember360 calls suppressCookieBanner and stubs project rights and all domain APIs.
  await setupMember360(page);
  await openMember360(page);
  await page.getByTestId('mktg-breadcrumb-link-0').click();
  await expect(page.getByTestId('mktg-kit-page')).toBeVisible();
  await page.getByTestId('mktg-kit-family-link-member-sponsor').click();
  const familyRun = page.getByTestId('mktg-family-run').getByRole('link');
  await expect(familyRun).toHaveAccessibleName('Create Member 360');
  await familyRun.click();
  await expect(page.getByTestId('member-360-run-page')).toBeVisible();
  await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveAttribute('href', /\/families\/member-sponsor\?project=sample-foundation$/);
  await page.goBack();
  await expect(page.getByTestId('mktg-family-page')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('mktg-kit-page')).toBeVisible();
  await page.screenshot({ path: info.outputPath('member-family-back.png'), fullPage: true });
});

test('shared Member document has linked parents and Create another Member 360 drops asset-only URL state', async ({ page }, info) => {
  await setupMember360(page, { stored: true });
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  await expect(page.getByTestId('member-360-result')).toBeVisible();
  await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveAttribute('href', /\/families\/member-sponsor\?project=sample-foundation$/);
  await expect(page.getByTestId('member-360-new-run')).toHaveAttribute('href', '/project/mktg-os-agents/member-360?project=sample-foundation');
  await expect(page.getByTestId('member-360-new-run')).toHaveText('Create another Member 360');
  await expect(page.getByTestId('mktg-breadcrumb-current')).toHaveText('Member 360 · 2026-Q3');
  await page.getByTestId('member-360-new-run').click();
  await expect(page.getByTestId('member-360-run-page')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('member-360-result')).toBeVisible();
  await page.screenshot({ path: info.outputPath('member-document-back.png'), fullPage: true });
});

test('Sources and Method use plain-English connection labels for legacy envelopes', async ({ page }, info) => {
  await setupMember360(page, { stored: true }); // Includes suppressCookieBanner(page).
  const view = member360Revision();
  if (!view.member360) throw new Error('Member 360 fixture is missing');
  view.member360.tabs.summary.data_coverage.sources_unavailable = ['CRM (not wired)', 'Web research'];
  view.member360.content_sha256 = createHash('sha256').update(JSON.stringify(view.member360.tabs)).digest('hex');
  await page.route(`**/api/mktg-agents/documents/member-360/${MEMBER_360_DOCUMENT_ID}**`, (route) => json(route, view));
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  await expect(page.getByTestId('member-360-result')).toContainText('CRM (not connected yet), Web research');
  await page.getByTestId('member-360-method-toggle').click();
  await expect(page.getByTestId('member-360-method')).toContainText('hubspot: not connected yet');
  await expect(page.getByTestId('member-360-method')).not.toContainText('not_wired');
  await page.screenshot({ path: info.outputPath('plain-source-labels.png'), fullPage: true });
});

test('ranking filters push shareable URLs and Back restores each preceding view', async ({ page }, info) => {
  await setupMember360(page, { stored: true });
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  await expect(page.getByTestId('member-360-ranking-row')).toHaveCount(2);
  const entries = await page.evaluate(() => history.length);
  await selectMember360Option(page, 'member-360-tier', 'At Risk');
  await expect(page).toHaveURL(/tier=At%20Risk/);
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);
  await selectMember360Option(page, 'member-360-owner', 'Sales');
  await expect(page).toHaveURL(/owner=Sales/);
  await expect(page.getByTestId('member-360-no-matches')).toBeVisible();
  await page.goBack();
  await expect(page).not.toHaveURL(/owner=Sales/);
  await expect(page.getByTestId('member-360-ranking-row')).toHaveCount(1);
  await page.goBack();
  await expect(page).not.toHaveURL(/[?&]tier=/);
  await expect(page.getByTestId('member-360-ranking-row')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('ranking-filter-history.png'), fullPage: true });
});

test('one settled search term pushes once and Back restores the unfiltered list', async ({ page }, info) => {
  await setupMember360(page, { stored: true }); // Includes suppressCookieBanner(page).
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  await expect(page.getByTestId('member-360-ranking-row')).toHaveCount(2);
  const entries = await page.evaluate(() => history.length);
  const input = page.getByTestId('member-360-search').locator('input');
  await input.pressSequentially(SYNTHETIC_SECOND_ORG_LEGAL_NAME, { delay: 10 });
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe(SYNTHETIC_SECOND_ORG_LEGAL_NAME);
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);
  await expect(input).toBeFocused();
  await expect(input).toHaveValue(SYNTHETIC_SECOND_ORG_LEGAL_NAME);
  await expect(page.getByTestId('member-360-ranking-row')).toHaveCount(1);
  await page.goBack();
  await expect(page).not.toHaveURL(/[?&]search=/);
  await expect(input).toHaveValue('');
  await expect(page.getByTestId('member-360-ranking-row')).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('search-history.png'), fullPage: true });
});

test('form-only intake fixes the project, parses/removes CSV, and has an empty history', async ({ page, isMobile }, info) => {
  if (!isMobile) await page.setViewportSize({ width: 1280, height: 1000 });
  await setupMember360(page);
  await openMember360(page);
  await expect(page.getByTestId('member-360-project')).toContainText('Sample Foundation');
  await expect(page.getByTestId('member-360-project').locator('input')).toHaveCount(0);
  // No selected-label hook is exposed by the wrapper; measure the text box itself to detect clipping.
  const windowLabel = page.getByTestId('member-360-window').locator('.p-select-label');
  await expect(windowLabel).toHaveText('Trailing 12 months, recent quarter emphasised (default)');
  expect(await windowLabel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const uploadButton = page.getByRole('button', { name: 'Upload tracker', exact: true });
  // No variant attribute is exposed by the upload wrapper; verify the standard solid-border outline.
  await expect(uploadButton).toHaveClass(/p-button-outlined/);
  await expect(uploadButton).toHaveCSS('border-top-style', 'solid');
  const trackerSpacing = await page
    .getByTestId('member-360-run-page')
    .getByText('Trackers', { exact: true })
    .evaluate((element) => {
      const next = element.nextElementSibling;
      if (!next) throw new Error('Tracker optional label is missing');
      // A wrapped inline span's bounding box includes later lines; measure its first text fragment.
      const first = next.getClientRects()[0];
      if (!first) throw new Error('Tracker optional label has no text fragment');
      return first.left - element.getBoundingClientRect().right;
    });
  expect(trackerSpacing).toBeGreaterThan(0);
  await expect(page.getByTestId('member-360-run-history')).toContainText('No Member 360 runs yet.');
  await page
    .getByTestId('member-360-upload')
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'speaking.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`company,speaker,session\n${SYNTHETIC_ORG_NAME},Sample speaker,Sample session`),
    });
  await expect(page.getByTestId('member-360-tracker')).toContainText('1 row · 3 columns');
  await expect(page.getByTestId('member-360-tracker')).toContainText('CSV');
  await expect(page.getByRole('button', { name: 'Upload tracker', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Remove speaking.csv' }).click();
  await expect(page.getByTestId('member-360-tracker')).toHaveCount(0);
  const create = page.getByTestId('member-360-run').getByRole('button', { name: 'Create Member 360', exact: true });
  await expect(create).toBeEnabled();
  await expect(page.getByTestId('member-360-compare')).toContainText('No comparison');
  await page.route('**/api/mktg-agents/member-360/generate', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ project: 'sample-project', window: '12', compare: false, trackerIds: [] });
    await json(route, { sessionId: 'synthetic-first-run', ownerToken: 'synthetic-proof', documentId: MEMBER_360_DOCUMENT_ID, runId: 'b'.repeat(64) });
  });
  await stubMember360Progress(page, () => member360Progress('writing'));
  await create.click();
  await expect(page).toHaveURL(new RegExp(`/documents/member-360/${MEMBER_360_DOCUMENT_ID}`));
  await expect(page.getByTestId('mktg-document-view-run')).toBeVisible();
  await page.screenshot({ path: info.outputPath('first-run-no-comparison.png'), fullPage: true });
});

test('a parsed tracker sends only its opaque id when generating', async ({ page }, info) => {
  await setupMember360(page);
  await page.route('**/api/mktg-agents/member-360/generate', async (route) => {
    const body = route.request().postDataJSON();
    expect(body.trackerIds).toEqual(['a'.repeat(64)]);
    expect(body).not.toHaveProperty('trackers');
    expect(JSON.stringify(body)).not.toContain('synthetic-contact');
    await json(route, { sessionId: 'synthetic-tracker-run', ownerToken: 'synthetic-proof', documentId: MEMBER_360_DOCUMENT_ID, runId: 'b'.repeat(64) });
  });
  await stubMember360Progress(page, () => member360Progress('writing'));
  await openMember360(page);
  await page
    .locator('lfx-file-upload input[type=file]')
    .setInputFiles({ name: 'tracker.csv', mimeType: 'text/csv', buffer: Buffer.from('email\nsynthetic-contact@example.test') });
  await expect(page.getByTestId('member-360-tracker')).toContainText('1 row · 3 columns');
  await page.getByTestId('member-360-run').getByRole('button', { name: 'Create Member 360', exact: true }).click();
  await expect(page.getByTestId('mktg-document-view-run')).toBeVisible();
  await page.screenshot({ path: info.outputPath('opaque-tracker-run.png'), fullPage: true });
});

test('Generate lands on the document and stays generating until the run is stored', async ({ page }, info) => {
  await setupMember360(page, { stored: true });
  let stored = false;
  await page.route('**/api/mktg-agents/member-360/generate', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ project: 'sample-project', window: '12', compare: true, trackerIds: [] });
    await json(route, { sessionId: 'synthetic-session', ownerToken: 'synthetic-owner-token', documentId: MEMBER_360_DOCUMENT_ID, runId: 'b'.repeat(64) });
  });
  await stubMember360Progress(page, () => (stored ? member360Revision() : member360Progress('writing')));
  await openMember360(page);
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.set('revision', 'obsolete-revision');
    history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.getByTestId('member-360-run').getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/documents/member-360/${MEMBER_360_DOCUMENT_ID}`));
  await expect(page).not.toHaveURL(/revision=/);
  await expect(page.getByTestId('mktg-run-activity-title')).toHaveText('Working on Member 360');
  await expect(page.getByTestId('mktg-run-activity-step-step-10')).toContainText('Searching the web');
  await expect(page.getByTestId('mktg-run-activity-phase-questions')).toHaveCount(0);
  await expect(page.getByTestId('mktg-run-activity-phase-research')).toHaveAttribute('aria-current', 'step');
  const showAll = page.getByTestId('mktg-run-activity-toggle-all');
  await expect(showAll).toContainText('Show all 10 steps');
  await showAll.click();
  await expect(page.getByTestId('mktg-run-activity-step-step-1')).toBeVisible();
  await expect(page.getByTestId('member-360-result')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('generating-live-feed.png'), fullPage: true });
  stored = true;
  await expect(page.getByTestId('member-360-result')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('member-360-result-history')).toContainText('this run');
  await page.screenshot({ path: info.outputPath('generated-document.png'), fullPage: true });
});

test('a plain Member document URL in another browser recovers server progress and lands', async ({ page, browser }, info) => {
  await setupMember360(page, { stored: true }); // suppressCookieBanner runs in each helper setup.
  let ready = false;
  await stubMember360Progress(page, () => member360Progress('writing'));
  await page.route('**/api/mktg-agents/member-360/generate', (route) =>
    json(route, { sessionId: 'synthetic-session', ownerToken: 'synthetic-token', documentId: MEMBER_360_DOCUMENT_ID, runId: 'b'.repeat(64) })
  );
  await openMember360(page);
  await page.getByTestId('member-360-run').getByRole('button').click();
  await expect(page.getByTestId('mktg-document-view-run')).toBeVisible();
  const other = await browser.newPage({ baseURL: new URL(page.url()).origin });
  try {
    await setupMember360(other, { stored: true });
    await stubMember360Progress(other, () => (ready ? member360Revision() : member360Progress('writing')));
    await openMember360(other, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
    await expect(other).not.toHaveURL(/generation=|run=/);
    await expect(other.getByTestId('mktg-run-activity')).toBeVisible();
    expect(await other.evaluate(() => sessionStorage.length)).toBe(0);
    ready = true;
    await expect(other.getByTestId('member-360-result')).toBeVisible({ timeout: 20000 });
    await other.screenshot({ path: info.outputPath('fresh-browser-landed.png'), fullPage: true });
  } finally {
    await other.close();
  }
});

test('a finished refusal shows a plain reason, collapsed Details and Run again', async ({ page }, info) => {
  await setupMember360(page); // Includes suppressCookieBanner(page).
  const message = 'SCOPE GUARD: no entitlement for sample-project-uid in this session; the intake form could not be verified.';
  await page.route('**/api/mktg-agents/member-360/generate', (route) =>
    json(route, { sessionId: 'synthetic-session', ownerToken: 'synthetic-token', documentId: MEMBER_360_DOCUMENT_ID })
  );
  await stubMember360Progress(page, () => member360Progress('failed', 'no_edit_access', message));
  let legacyPolls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/member-360/result')) legacyPolls++;
  });
  await openMember360(page);
  await selectMember360Option(page, 'member-360-compare', 'No comparison');
  await page.getByTestId('member-360-run').getByRole('button').click();
  await expect(page.getByTestId('mktg-document-view-error')).toContainText(
    "Member 360 couldn't run: your account doesn't have edit access to this project's member data."
  );
  await expect(page.getByTestId('mktg-document-view-error')).not.toContainText('SCOPE GUARD');
  const details = page.getByTestId('member-360-failure-details');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('member-360-failure-message')).not.toBeVisible();
  await page.screenshot({ path: info.outputPath('terminal-refusal-collapsed.png'), fullPage: true });
  await details.getByText('Details', { exact: true }).click();
  await expect(page.getByTestId('member-360-failure-message')).toBeVisible();
  await expect(page.getByTestId('member-360-failure-message')).toHaveText(message);
  await expect(page.getByTestId('mktg-run-activity')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-retry')).toHaveCount(0);
  await expect(page.getByTestId('member-360-result')).toHaveCount(0);
  expect(legacyPolls).toBe(0);
  await page.screenshot({ path: info.outputPath('terminal-refusal.png'), fullPage: true });
  await page.getByTestId('member-360-run-again').click();
  await expect(page.getByTestId('member-360-run-page')).toBeVisible();
  await expect(page.getByTestId('member-360-run').getByRole('button')).toBeEnabled();
  expect(legacyPolls).toBe(0);
  await page.screenshot({ path: info.outputPath('run-again-intake.png'), fullPage: true });
});

test('an expired unsupported-input run offers Run again instead of Retry', async ({ page }, info) => {
  await setupMember360(page); // Includes suppressCookieBanner(page).
  await stubMember360Progress(page, () => member360Progress('failed', undefined, MEMBER_360_INPUT_TIMEOUT_MESSAGE));
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  await expect(page.getByTestId('member-360-run-again')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-progress-retry')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-retry')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-paused-refresh')).toHaveCount(0);
  await page.getByTestId('member-360-failure-details').getByText('Details', { exact: true }).click();
  await expect(page.getByTestId('member-360-failure-message')).toHaveText(MEMBER_360_INPUT_TIMEOUT_MESSAGE);
  await page.screenshot({ path: info.outputPath('expired-needs-input-run-again.png'), fullPage: true });
});

test('an unsupported tracker type is explained inline before upload', async ({ page }, info) => {
  await setupMember360(page); // Includes suppressCookieBanner(page).
  let uploads = 0;
  await page.route('**/api/mktg-agents/member-360/tracker**', async (route) => {
    uploads++;
    await route.abort();
  });
  await openMember360(page);
  await expect(page.getByTestId('member-360-upload-types')).toHaveText('XLSX or CSV');
  await page
    .getByTestId('member-360-upload')
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'tracker.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('synthetic pdf'),
    });
  await expect(page.getByTestId('member-360-error')).toContainText('Only .xlsx or .csv trackers can be uploaded.');
  await expect(page.getByTestId('member-360-tracker')).toHaveCount(0);
  await expect(page.getByTestId('member-360-run').getByRole('button')).toBeEnabled();
  expect(uploads).toBe(0);
  await page.screenshot({ path: info.outputPath('unsupported-tracker.png'), fullPage: true });
});

test('a questions turn keeps the document open with the feed and an unsupported-answer notice', async ({ page }, info) => {
  await setupMember360(page); // Includes suppressCookieBanner(page).
  await page.route('**/api/mktg-agents/member-360/generate', (route) =>
    json(route, { sessionId: 'synthetic-session', ownerToken: 'synthetic-token', documentId: MEMBER_360_DOCUMENT_ID })
  );
  await stubMember360Progress(page, () => member360Progress('questions'));
  await openMember360(page);
  await selectMember360Option(page, 'member-360-compare', 'No comparison');
  await page.getByTestId('member-360-run').getByRole('button').click();
  await expect(page.getByTestId('member-360-needs-input')).toContainText('this version of the page cannot answer yet; the run stays open');
  await expect(page.getByTestId('mktg-run-activity')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-error')).toHaveCount(0);
  await expect(page.getByTestId('member-360-result')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('questions-turn-open.png'), fullPage: true });
});

test('ranking sorts, filters, expands evidence and copies team actions', async ({ page }, info) => {
  await setupMember360(page, { stored: true });
  const view = member360Revision();
  if (!view.member360) throw new Error('Member 360 fixture is missing');
  view.member360.inputs.prior_run_provided = true;
  view.member360.tabs.member_ranking[0].trend = '▼';
  view.member360.tabs.member_ranking[1].trend = '▲';
  view.member360.tabs.summary.movers = {
    gainers: [{ member_organization: SYNTHETIC_SECOND_ORG_LEGAL_NAME, delta: 4 }],
    decliners: [{ member_organization: SYNTHETIC_ORG_NAME, delta: -11 }],
  };
  view.member360.content_sha256 = createHash('sha256').update(JSON.stringify(view.member360.tabs)).digest('hex');
  // Document detail AND its immutable revision must carry the same prior-run fixture.
  await page.route(`**/api/mktg-agents/documents/member-360/${MEMBER_360_DOCUMENT_ID}**`, (route) => json(route, view));
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  const rows = page.getByTestId('member-360-ranking-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(SYNTHETIC_SECOND_ORG_LEGAL_NAME);
  await expect(rows.first().getByTestId('member-360-trend')).toHaveText('▲ 4');
  await expect(rows.last().getByTestId('member-360-trend')).toHaveText('▼ 11');
  await expect(page.getByTestId('member-360-actions')).toContainText('Member Success · 1 action');
  await page.getByTestId('member-360-sort-engagement_score').click();
  await expect(rows.first()).toContainText(SYNTHETIC_ORG_NAME);
  await selectMember360Option(page, 'member-360-tier', 'At Risk');
  await expect(rows).toHaveCount(1);
  await selectMember360Option(page, 'member-360-owner', 'Sales');
  await expect(page.getByTestId('member-360-no-matches')).toBeVisible();
  await selectMember360Option(page, 'member-360-owner', 'All');
  await rows.getByRole('button', { name: SYNTHETIC_ORG_NAME }).click();
  await expect(page.getByTestId('member-360-row-detail')).toContainText('No speaking activity');
  await expect(page.getByTestId('member-360-row-detail')).toContainText('LFX Platform connector');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => undefined } }));
  await page.getByRole('button', { name: 'Copy Member Success list' }).click();
  await expect(page.getByTestId('member-360-notice')).toContainText('Member Success list copied.');
  const download = page.waitForEvent('download');
  await expect(page.getByTestId('member-360-download').getByRole('button')).toHaveText('Download workbook');
  await page.getByTestId('member-360-download').getByRole('button').click();
  expect((await download).suggestedFilename()).toBe('Member360_sample-foundation_2026-Q3.xlsx');

  await page.screenshot({ path: info.outputPath('filtered-expanded-ranking.png'), fullPage: true });
});

test('a failed submission preserves the form and permits retry', async ({ page }, info) => {
  await setupMember360(page);
  await page.route('**/api/mktg-agents/member-360/generate', (route) => route.fulfill({ status: 503, body: '{}' }));
  await openMember360(page);
  await selectMember360Option(page, 'member-360-compare', 'No comparison');
  await page.getByTestId('member-360-run').getByRole('button').click();
  await expect(page.getByTestId('member-360-error')).toContainText('could not be started');
  await expect(page.getByTestId('member-360-run').getByRole('button')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('submission-error.png'), fullPage: true });
});
