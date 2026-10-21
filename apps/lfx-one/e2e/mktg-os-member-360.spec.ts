// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

import { json, MEMBER_360_DOCUMENT_ID, openMember360, setupMember360, selectMember360Option } from './helpers/member-360.helper';
import { member360Revision } from './fixtures/mock-data/member-360.mock';
import { SYNTHETIC_ORG_NAME, SYNTHETIC_SECOND_ORG_LEGAL_NAME } from './fixtures/mock-data/synthetic-org.mock';

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 60000 });
test.beforeEach(({ page, isMobile }) => {
  if (isMobile) expect(page.viewportSize()?.width).toBeLessThan(640);
});

test('catalog tile opens the Member 360 form', async ({ page }, info) => {
  await setupMember360(page);
  await openMember360(page, 'agents');
  const family = page.getByTestId('mktg-os-agents-family-member-sponsor');
  const tile = family.getByTestId('mktg-os-agents-tile-member-360');
  await tile.scrollIntoViewIfNeeded();
  await expect(tile).toBeEnabled();
  await tile.click();
  await expect(page.getByTestId('member-360-run-page')).toBeVisible();
  await page.screenshot({ path: info.outputPath('catalog-to-form.png'), fullPage: true });
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
  // No variant attribute is exposed by the upload wrapper; verify the rendered outlined/dashed button.
  await expect(uploadButton).toHaveClass(/p-button-outlined/);
  await expect(uploadButton).toHaveCSS('border-top-style', 'dashed');
  const trackerSpacing = await page
    .getByTestId('member-360-run-page')
    .getByText('Trackers', { exact: true })
    .evaluate((element) => {
      const next = element.nextElementSibling;
      if (!next) throw new Error('Tracker optional label is missing');
      return next.getBoundingClientRect().left - element.getBoundingClientRect().right;
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
  await expect(page.getByTestId('member-360-tracker')).toContainText('1 row · company, speaker, session');
  await expect(page.getByTestId('member-360-tracker')).toContainText('CSV');
  await expect(page.getByRole('button', { name: 'Upload tracker', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Remove speaking.csv' }).click();
  await expect(page.getByTestId('member-360-tracker')).toHaveCount(0);
  await expect(page.getByTestId('member-360-run').getByRole('button')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('form-empty-history.png'), fullPage: true });
});

test('Generate lands on the document and stays generating until the run is stored', async ({ page }, info) => {
  await setupMember360(page, { stored: true });
  let stored = false;
  await page.route('**/api/mktg-agents/member-360/generate', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ project: 'sample-project', window: '12', compare: true, trackers: [] });
    await json(route, { sessionId: 'synthetic-session', ownerToken: 'synthetic-owner-token', documentId: MEMBER_360_DOCUMENT_ID });
  });
  await page.route('**/api/mktg-agents/member-360/result', (route) =>
    json(route, {
      status: stored ? 'ready' : 'pending',
      stored,
      documentId: MEMBER_360_DOCUMENT_ID,
      activity: Array.from({ length: 10 }, (_, index) => ({
        id: `step-${index + 1}`,
        kind: index % 2 ? 'search' : 'lfx',
        label: index % 2 ? 'Searching the web' : 'Checking LFX',
        status: index === 9 ? 'running' : 'done',
        startedAt: '2026-10-19T10:00:00.000Z',
      })),
    })
  );
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

test('a questions turn keeps the document open with the feed and an unsupported-answer notice', async ({ page }, info) => {
  await setupMember360(page); // Includes suppressCookieBanner(page).
  await page.route('**/api/mktg-agents/member-360/generate', (route) =>
    json(route, { sessionId: 'synthetic-session', ownerToken: 'synthetic-token', documentId: MEMBER_360_DOCUMENT_ID })
  );
  await page.route('**/api/mktg-agents/member-360/result', (route) => json(route, { status: 'needs_input', activity: [] }));
  await openMember360(page);
  await page.getByTestId('member-360-run').getByRole('button').click();
  await expect(page.getByTestId('member-360-needs-input')).toContainText('this version of the page cannot answer yet; the run stays open');
  await expect(page.getByTestId('mktg-run-activity')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-error')).toHaveCount(0);
  await expect(page.getByTestId('member-360-result')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('questions-turn-open.png'), fullPage: true });
});

test('ranking sorts, filters, expands evidence, copies team actions and exports the workbook', async ({ page }, info) => {
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
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (_text: string) => undefined } }));
  await page.getByRole('button', { name: 'Copy Member Success list' }).click();
  await expect(page.getByTestId('member-360-notice')).toContainText('Member Success list copied.');
  const download = page.waitForEvent('download');
  await page.getByTestId('member-360-download').getByRole('button').click();
  expect((await download).suggestedFilename()).toBe('Member360_sample-foundation_2026-Q3.xlsx');
  await page.screenshot({ path: info.outputPath('filtered-expanded-ranking.png'), fullPage: true });
});

test('a failed submission preserves the form and permits retry', async ({ page }, info) => {
  await setupMember360(page);
  await page.route('**/api/mktg-agents/member-360/generate', (route) => route.fulfill({ status: 503, body: '{}' }));
  await openMember360(page);
  await page.getByTestId('member-360-run').getByRole('button').click();
  await expect(page.getByTestId('member-360-error')).toContainText('could not be started');
  await expect(page.getByTestId('member-360-run').getByRole('button')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('submission-error.png'), fullPage: true });
});
