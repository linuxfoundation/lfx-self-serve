// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { LINKEDIN_API } from '../../../packages/shared/src/constants/linkedin-post.constants';
import { MKTG_NOT_AVAILABLE_TEXT, MKTG_POLL_RETRYING_TEXT, MKTG_REBUILD_UNREACHABLE_TEXT } from '../../../packages/shared/src/constants/mktg-run.constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { kitTest as test, KIT_PROJECT, kitJson, openKit, setupKit } from './helpers/mktg-kit.helper';
import { json, LINKEDIN_RUN_TIMEOUT, openLinkedin, setupLinkedin } from './helpers/mktg-linkedin.helper';
import { DATA_LOAD_TIMEOUT } from './helpers/mktg-os-assets.helper';
import { fulfillDocumentJson } from './helpers/mktg-os-documents.helper';
import { clearsAfter, expectFinalLine, expectNoRetryControl, expectRetryingLine, OUTAGE_GREY, readLine, setupOutage } from './helpers/mktg-os-outage.helper';
import { setupFreshSources } from './helpers/mktg-os-sources.helper';
import { openStaleness, setupStaleness, STALENESS_ASSET_URL, STALENESS_FAMILY_URL, STALENESS_KIT_URL } from './helpers/mktg-os-staleness.helper';

/**
 * The offline sweep: one connection-failure behaviour on every remaining Marketing OS screen.
 * (A) an open page loses the connection: one grey status line where the read is made, the loaded content stays usable,
 * no button, and the line clears by itself on the next good read. (B) the screen is opened while the server cannot be
 * reached: the same line over the loading skeleton. Only a FINAL refusal is a red one-liner that names what is not
 * available, with no Retry. The helpers stub every /api route, so this proves the browser's behaviour. Every row runs
 * on the kit fixture, whose request check also fails a row that sends an unexpected Marketing OS request.
 */
const KIT_FAMILY = '/families/positioning-brand';
const kitUrl = (path = '') => `/project/mktg-os-agents${path}?project=${KIT_PROJECT.slug}`;

/** A client-side navigation: the app is already loaded, so a screen opened during an outage still renders. */
async function navigate(page: Page, url: string): Promise<void> {
  await page.evaluate((destination) => {
    history.pushState({}, '', destination);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
}

async function shot(page: Page, name: string): Promise<void> {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

/** The read strings go verbatim into the hand-test brief: keep what the browser showed beside the screenshots. */
async function record(name: string, value: unknown): Promise<void> {
  const path = test.info().outputPath(`read-${name}.json`);
  writeFileSync(path, JSON.stringify(value, null, 2));
  await test.info().attach(`read-${name}`, { path, contentType: 'application/json' });
}

test.describe('Marketing OS connection failures · offline sweep', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.setTimeout(120_000);
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });

  test('row 10 · Kit home: the loaded kit stays usable under the grey line; opened offline it sits over the skeleton', async ({ page }) => {
    await setupKit(page, { loaded: true });
    const outage = await setupOutage(page);
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4, { timeout: DATA_LOAD_TIMEOUT });
    const line = page.getByTestId('mktg-kit-retrying');
    await expect(line).toHaveCount(0);

    // (A) The open page loses the connection.
    await outage.down();
    await expectRetryingLine(page, line);
    await expect(page.getByTestId('mktg-kit-error')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4);
    await expect(page.getByTestId('mktg-kit-in-kit')).not.toHaveText('—');
    // Usable: the filters still work on the loaded kit.
    await page.getByTestId('filter-pill-draft').click();
    await expect(page.getByTestId('filter-pill-draft')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('filter-pill-all').click();
    await shot(page, 'kit-open-page-offline');
    const openPage = await readLine(page, line);
    const cleared = await clearsAfter(outage.up, line);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4);

    // (B) Opened while the server cannot be reached.
    await navigate(page, kitUrl(KIT_FAMILY));
    await expect(page.getByTestId('mktg-family-assets')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await outage.down();
    await navigate(page, kitUrl());
    await expectRetryingLine(page, line);
    await expect(page.getByTestId('mktg-kit-loading')).toBeVisible();
    await expect(page.getByTestId('mktg-kit-error')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-families')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-in-kit')).toHaveText('—');
    await shot(page, 'kit-opened-offline');
    const openedOffline = await readLine(page, line);
    const opened = await clearsAfter(outage.up, line);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4);
    await expect(page.getByTestId('mktg-kit-loading')).toHaveCount(0);
    await record('kit-home', { openPage: { ...openPage, clearedMs: cleared }, openedOffline: { ...openedOffline, clearedMs: opened } });
  });

  test('row 10 · Kit home: the line clears by itself on the next automatic check, with no wake', async ({ page }) => {
    await setupKit(page, { loaded: true });
    const outage = await setupOutage(page);
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4, { timeout: DATA_LOAD_TIMEOUT });
    await outage.down();
    const line = page.getByTestId('mktg-kit-retrying');
    await expectRetryingLine(page, line);
    // No reconnect, focus or tab-return event: only the poller's own next retry (jittered, at most the 30 s cap).
    const cleared = await clearsAfter(async () => outage.upQuietly(), line, 35_000);
    expect(outage.failed()).toBeGreaterThan(0);
    await record('kit-home-automatic-retry', { clearedMs: cleared, refusedReads: outage.failed() });
  });

  test('row 10 · Kit home: a final refusal is one red line that names the kit, with no Retry', async ({ page }) => {
    await setupKit(page, { status: 404 });
    await openKit(page);
    await expectFinalLine(page, page.getByTestId('mktg-kit-error'), MKTG_NOT_AVAILABLE_TEXT.kit);
    await expect(page.getByTestId('mktg-kit-error-retry')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-families')).toHaveCount(0);
    await shot(page, 'kit-final-refusal');
    await record('kit-home-final-refusal', await readLine(page, page.getByTestId('mktg-kit-error')));
  });

  test('row 6b · Family page: the loaded family stays usable under the grey line; opened offline it sits over the skeleton', async ({ page }) => {
    await setupKit(page, { loaded: true });
    const outage = await setupOutage(page);
    await openKit(page, KIT_FAMILY);
    await expect(page.getByTestId('mktg-family-asset-boilerplates')).toContainText('Draft', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-family-sources')).toBeVisible();
    const line = page.getByTestId('mktg-family-retrying');

    // (A) The open page loses the connection.
    await outage.down();
    await expectRetryingLine(page, line);
    await expect(page.getByTestId('mktg-family-error')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-error-retry')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-asset-boilerplates')).toContainText('Draft');
    await expect(page.getByTestId('mktg-family-sources')).toBeVisible();
    await expect(page.getByTestId('mktg-family-run')).toBeVisible();
    await shot(page, 'family-open-page-offline');
    const openPage = await readLine(page, line);
    const cleared = await clearsAfter(outage.up, line);

    // (B) Opened while the server cannot be reached.
    await navigate(page, kitUrl());
    await expect(page.getByTestId('mktg-kit-families')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await outage.down();
    await navigate(page, kitUrl(KIT_FAMILY));
    await expectRetryingLine(page, line);
    await expect(page.getByTestId('mktg-family-content-loading')).toBeVisible();
    await expect(page.getByTestId('mktg-family-error')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
    await shot(page, 'family-opened-offline');
    const openedOffline = await readLine(page, line);
    const opened = await clearsAfter(outage.up, line);
    await expect(page.getByTestId('mktg-family-asset-boilerplates')).toContainText('Draft');
    await expect(page.getByTestId('mktg-family-sources')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await record('family', { openPage: { ...openPage, clearedMs: cleared }, openedOffline: { ...openedOffline, clearedMs: opened } });
  });

  test('row 6b · Family details: the source read keeps trying behind the grey line and the assets stay', async ({ page }) => {
    await setupKit(page, { loaded: true });
    // Only the source details read is cut: the family listing keeps answering.
    const outage = await setupOutage(page, (url) => url.pathname.includes('/revisions/'));
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-families')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await outage.down();
    await navigate(page, kitUrl(KIT_FAMILY));
    const line = page.getByTestId('mktg-family-sources-loading');
    await expectRetryingLine(page, line);
    await expect(page.getByTestId('mktg-family-sources-error')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-sources-retry')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-asset-boilerplates')).toContainText('Draft');
    await expect(page.getByTestId('mktg-family-retrying')).toHaveCount(0);
    await shot(page, 'family-details-offline');
    const read = await readLine(page, line);
    const started = Date.now();
    await outage.up();
    await expect(page.getByTestId('mktg-family-sources')).toContainText('Sources read on the last run');
    await expect(line).toBeEmpty();
    await record('family-details', { ...read, clearedMs: Date.now() - started });
  });

  test('row 6b · Family: a final refusal of the family or of its details is one red line, with no Retry', async ({ page }) => {
    const options = { loaded: true, revisionStatus: 404, status: 200 };
    await setupKit(page, options);
    await openKit(page, KIT_FAMILY);
    await expectFinalLine(page, page.getByTestId('mktg-family-sources-error'), MKTG_NOT_AVAILABLE_TEXT.familyDetails);
    await expect(page.getByTestId('mktg-family-asset-boilerplates')).toContainText('Draft');
    await shot(page, 'family-details-final-refusal');
    const details = await readLine(page, page.getByTestId('mktg-family-sources-error'));

    await page.route(
      (url) => url.pathname === '/api/mktg-agents/documents',
      (route) => kitJson(route, { error: 'Synthetic missing listing' }, 404)
    );
    await navigate(page, kitUrl());
    await expect(page.getByTestId('mktg-kit-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await navigate(page, kitUrl(KIT_FAMILY));
    await expectFinalLine(page, page.getByTestId('mktg-family-error'), MKTG_NOT_AVAILABLE_TEXT.kit);
    await expect(page.getByTestId('mktg-family-error-retry')).toHaveCount(0);
    await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
    await shot(page, 'family-final-refusal');
    await record('family-final-refusal', { details, family: await readLine(page, page.getByTestId('mktg-family-error')) });
  });

  test('row 11 · Downstream panel: opened offline, the grey line sits over its skeleton and the rest of the rail is shown', async ({ page }) => {
    await setupStaleness(page);
    // Only the panel's own read (the documents listing) is cut: the document itself keeps answering.
    const outage = await setupOutage(page, (url) => url.pathname === '/api/mktg-agents/documents');
    await openStaleness(page, STALENESS_ASSET_URL);
    await expect(page.getByTestId('mktg-downstream-copy')).toHaveText('Boilerplates and FAQ were built from v1. Rebuild them from v3?', {
      timeout: DATA_LOAD_TIMEOUT,
    });
    const line = page.getByTestId('mktg-downstream-retrying');
    await expect(line).toHaveCount(0);

    // Leave the document, then open it again during the outage.
    await navigate(page, STALENESS_KIT_URL);
    await expect(page.getByTestId('mktg-kit-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-page')).toHaveCount(0);
    await outage.down();
    await navigate(page, STALENESS_ASSET_URL);
    await expectRetryingLine(page, line);
    await expect(page.getByTestId('mktg-downstream-loading')).toBeVisible();
    await expect(page.getByTestId('mktg-downstream-error')).toHaveCount(0);
    await expect(page.getByTestId('mktg-downstream-retry')).toHaveCount(0);
    // The rail does not wait for the server: the document and its About card are on screen.
    await expect(page.getByTestId('mktg-document-view-about')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-downstream-skeleton')).toHaveCount(0);
    await shot(page, 'downstream-opened-offline');
    const read = await readLine(page, line);
    const cleared = await clearsAfter(outage.up, line);
    await expect(page.getByTestId('mktg-downstream-copy')).toHaveText('Boilerplates and FAQ were built from v1. Rebuild them from v3?');
    await expect(page.getByTestId('mktg-downstream-rebuild').getByRole('button')).toBeEnabled();
    await record('downstream', { ...read, clearedMs: cleared });
  });

  test('row 11 · Downstream panel: a final refusal is one red line that names the downstream assets, with no Retry', async ({ page }) => {
    await setupStaleness(page);
    await page.route(
      (url) => url.pathname === '/api/mktg-agents/documents',
      (route) => fulfillDocumentJson(route, { error: 'Synthetic missing listing' }, 404)
    );
    await openStaleness(page, STALENESS_ASSET_URL);
    await expectFinalLine(page, page.getByTestId('mktg-downstream-error'), MKTG_NOT_AVAILABLE_TEXT.downstream);
    await expect(page.getByTestId('mktg-downstream-retry')).toHaveCount(0);
    await shot(page, 'downstream-final-refusal');
    await record('downstream-final-refusal', await readLine(page, page.getByTestId('mktg-downstream-error')));
  });

  test('row 12 · Rebuild progress: the steps stay under the grey line while the chain cannot reach the server, then it finishes', async ({ page }) => {
    await setupStaleness(page);
    // Only the chain's own checks are cut: the family listing keeps answering.
    const outage = await setupOutage(page, (url) => url.pathname.includes('/rebuild/'));
    await openStaleness(page, STALENESS_FAMILY_URL);
    await page.getByTestId('mktg-family-rebuild').getByRole('button').click();
    await expect(page.getByTestId('mktg-rebuild-step-boilerplates')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await outage.down();
    const line = page.getByTestId('mktg-rebuild-retrying');
    await expectRetryingLine(page, line);
    await expect(page.getByTestId('mktg-rebuild-error')).toHaveCount(0);
    await expect(page.getByTestId('mktg-rebuild-progress')).not.toContainText('reload the family');
    await expect(page.getByTestId('mktg-rebuild-step-boilerplates')).toBeVisible();
    await expect(page.getByTestId('mktg-rebuild-step-faq')).toBeVisible();
    await shot(page, 'rebuild-offline');
    const read = await readLine(page, line);
    const cleared = await clearsAfter(outage.up, line);
    await expect(page.getByTestId('mktg-rebuild-status')).toContainText('ready for review', { timeout: 40_000 });
    await expect(page.getByTestId('mktg-rebuild-error')).toHaveCount(0);
    await record('rebuild', { ...read, clearedMs: cleared, refusedChecks: outage.failed() });
  });

  test('row 12 · Rebuild: a start that cannot reach the server is the one failed action that offers Try again', async ({ page }) => {
    const calls = await setupStaleness(page);
    const outage = await setupOutage(page, (url) => url.pathname.endsWith('/rebuild/start'));
    await openStaleness(page, STALENESS_FAMILY_URL);
    await expect(page.getByTestId('mktg-family-rebuild').getByRole('button')).toBeEnabled({ timeout: DATA_LOAD_TIMEOUT });
    await outage.down();
    await page.getByTestId('mktg-family-rebuild').getByRole('button').click();
    const error = page.getByTestId('mktg-rebuild-error');
    await expect(error).toHaveText(MKTG_REBUILD_UNREACHABLE_TEXT);
    await expect(error).toHaveRole('alert');
    await expect(page.getByTestId('mktg-rebuild-progress')).not.toContainText('reload the family');
    await expect(page.getByTestId('mktg-rebuild-retrying')).toHaveCount(0);
    expect(calls.starts).toEqual([]);
    await shot(page, 'rebuild-start-unreachable');
    await record('rebuild-start-unreachable', {
      ...(await readLine(page, error)),
      tryAgain: await page.getByTestId('mktg-rebuild-try-again').getByRole('button').innerText(),
    });
    await outage.up();
    await page.getByTestId('mktg-rebuild-try-again').getByRole('button').click();
    await expect(page.getByTestId('mktg-rebuild-step-boilerplates')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(error).toHaveCount(0);
    await expect(page.getByTestId('mktg-rebuild-try-again')).toHaveCount(0);
  });

  test('row 12 · Rebuild progress: a final refusal is one red line with no Retry and no "reload the family"', async ({ page }) => {
    await setupStaleness(page);
    await page.route(
      (url) => url.pathname.endsWith('/rebuild/result'),
      (route) => fulfillDocumentJson(route, {}, 404)
    );
    await openStaleness(page, STALENESS_FAMILY_URL);
    await page.getByTestId('mktg-family-rebuild').getByRole('button').click();
    const error = page.getByTestId('mktg-rebuild-error');
    await expect(error).toHaveText(MKTG_NOT_AVAILABLE_TEXT.rebuild, { timeout: DATA_LOAD_TIMEOUT });
    await expect(error).toHaveRole('alert');
    await expect(page.getByTestId('mktg-rebuild-progress')).not.toContainText('reload the family');
    await expect(page.getByTestId('mktg-rebuild-try-again')).toHaveCount(0);
    await expect(page.getByTestId('mktg-rebuild-retrying')).toHaveCount(0);
    await shot(page, 'rebuild-final-refusal');
    await record('rebuild-final-refusal', await readLine(page, error));
  });

  test('row 13 · Run page dependency check: the grey line in its spot, no yellow note and no button, then the measured answer', async ({ page }) => {
    const sources = await setupFreshSources(page);
    const stored = (url: URL) => url.pathname === '/api/mktg-agents/foundation-message/stored';
    await page.route(stored, (route) => fulfillDocumentJson(route, { error: 'No approved synthetic framework' }, 404));
    const outage = await setupOutage(page, stored);
    await outage.down();
    await sources.open();
    const card = page.getByTestId('mktg-run-sources');
    const line = card.getByTestId('mktg-agent-run-dependency-retrying');
    await expectRetryingLine(page, line);
    await expect(card.getByTestId('mktg-agent-run-missing-dependency')).toHaveCount(0);
    await expect(card.getByTestId('mktg-agent-run-dependency-retry')).toHaveCount(0);
    await expect(page.getByTestId('mktg-agent-run-error')).toHaveCount(0);
    await shot(page, 'dependency-check-offline');
    const read = await readLine(page, line);
    const cleared = await clearsAfter(outage.up, line);
    // The check landed by itself on what the server measured: no approved framework yet.
    await expect(card.getByTestId('mktg-agent-run-missing-dependency')).toBeVisible();
    await expect(card.getByTestId('mktg-agent-run-missing-dependency-link').getByRole('button')).toBeVisible();
    expect(sources.generated).toHaveLength(0);
    await record('dependency-check', { ...read, clearedMs: cleared });
  });

  test('row 13 · Run page dependency check: a final refusal is a red line that names the document, with no Try again', async ({ page }) => {
    const sources = await setupFreshSources(page);
    await page.route(
      (url) => url.pathname === '/api/mktg-agents/foundation-message/stored',
      (route) => fulfillDocumentJson(route, { error: 'Synthetic refusal' }, 400)
    );
    await sources.open();
    const card = page.getByTestId('mktg-run-sources');
    const note = card.getByTestId('mktg-agent-run-missing-dependency');
    await expect(note).toContainText('not available.');
    await expect(note).not.toContainText('try again');
    await expect(note.locator('.p-message-error')).toBeVisible();
    await expect(card.getByTestId('mktg-agent-run-dependency-retrying')).toHaveCount(0);
    await expect(card.getByTestId('mktg-agent-run-dependency-retry')).toHaveCount(0);
    await expectNoRetryControl(page);
    await shot(page, 'dependency-check-final-refusal');
    await record('dependency-check-final-refusal', await readLine(page, note.locator('.p-message-error')));
  });

  test('row 9 · LinkedIn post run page: opened offline, the grey line sits over the skeleton, then the form appears by itself', async ({ page }) => {
    await setupLinkedin(page, { saved: true });
    const outage = await setupOutage(page);
    await outage.down();
    await openLinkedin(page);
    const line = page.getByTestId('mktg-linkedin-retrying');
    await expectRetryingLine(page, line);
    await expect(page.getByTestId('mktg-linkedin-loading')).toBeVisible();
    await expect(page.getByTestId('mktg-linkedin-error')).toHaveCount(0);
    await expect(page.getByTestId('mktg-linkedin-retry-load')).toHaveCount(0);
    await expect(page.getByTestId('mktg-linkedin-post-form')).toHaveCount(0);
    await shot(page, 'linkedin-opened-offline');
    const openedOffline = await readLine(page, line);
    const cleared = await clearsAfter(outage.up, line);
    await expect(page.getByTestId('mktg-linkedin-post-form')).toBeVisible({ timeout: LINKEDIN_RUN_TIMEOUT });
    await expect(page.getByTestId('mktg-linkedin-loading')).toHaveCount(0);

    // (A) The open page loses the connection: the form stays usable under the page's one status line.
    await outage.down();
    const note = page.getByTestId('mktg-linkedin-intake-note');
    await expect(note).toHaveText(MKTG_POLL_RETRYING_TEXT, { timeout: 35_000 });
    await expect(note).toHaveRole('status');
    await expect(note).toHaveCSS('color', OUTAGE_GREY);
    await expect(page.getByTestId('mktg-linkedin-error')).toHaveCount(0);
    await page.getByTestId('mktg-linkedin-content-text').locator('textarea').fill('Synthetic unsent edit');
    await shot(page, 'linkedin-open-page-offline');
    const openPage = await readLine(page, note);
    await outage.up();
    await expect(note).not.toHaveText(MKTG_POLL_RETRYING_TEXT);
    await expect(page.getByTestId('mktg-linkedin-content-text').locator('textarea')).toHaveValue('Synthetic unsent edit');
    await record('linkedin', { openedOffline: { ...openedOffline, clearedMs: cleared }, openPage });
  });

  test('row 9 · LinkedIn post run page: a final refusal is one red line with no Try again', async ({ page }) => {
    await setupLinkedin(page, { saved: true });
    await page.route(`**${LINKEDIN_API}/profile`, (route) =>
      route.request().method() === 'GET' ? json(route, { error: 'Synthetic refusal' }, 404) : route.fallback()
    );
    await openLinkedin(page);
    const error = page.getByTestId('mktg-linkedin-error');
    await expect(error).toContainText(MKTG_NOT_AVAILABLE_TEXT.linkedin, { timeout: LINKEDIN_RUN_TIMEOUT });
    await expect(error).toHaveRole('alert');
    await expect(page.getByTestId('mktg-linkedin-retry-load')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('mktg-linkedin-retrying')).toHaveCount(0);
    await expect(page.getByTestId('mktg-linkedin-profile-form')).toHaveCount(0);
    await shot(page, 'linkedin-final-refusal');
    await record('linkedin-final-refusal', await readLine(page, error));
  });
});
