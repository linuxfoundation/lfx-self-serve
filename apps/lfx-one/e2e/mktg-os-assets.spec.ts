// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { BRAND_KIT_INTAKE, MKTG_AGENT_INTAKES } from '@lfx-one/shared/constants/mktg-run.constants';
import type { MktgRunResultResponse, MktgRunSessionResponse } from '@lfx-one/shared/interfaces/mktg-run.interface';
import { DOCUMENT_PROJECT, DOCUMENT_TYPE, documentFixture, fulfillDocumentJson, setupDocuments } from './helpers/mktg-os-documents.helper';
import { ASSET_FAILURE, ASSET_PROJECT, DATA_LOAD_TIMEOUT, assetRevision, setupAsset } from './helpers/mktg-os-assets.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { setupNoQuestionsHandoff } from './helpers/mktg-os-handoff.helper';

test.describe('Marketing OS runs land on assets', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.afterEach(async ({ page }) => {
    await expect(page).not.toHaveURL(/auth0\.com/);
  });
  test('Generate stays on the run page and a later matching receipt opens exactly its stored revision', async ({ page }) => {
    const intake = MKTG_AGENT_INTAKES[DOCUMENT_TYPE.catalogAgentId ?? ''];
    if (!intake || intake.endpoints.answers) throw new Error('Missing registered direct-intake fixture');
    await setupDocuments(page);
    const revision = documentFixture().revisions[0];
    const ack: MktgRunSessionResponse = { sessionId: 'synthetic-intake-session', ownerToken: 'synthetic-owner-proof', runId: 'b'.repeat(64) };
    const ready: MktgRunResultResponse = { status: 'ready', version: 1, documentMarkdown: `# Revision ${revision.number}\n\nSynthetic document text.` };
    const persisted: MktgRunResultResponse = {
      ...ready,
      persistence: {
        project: DOCUMENT_PROJECT.uid,
        version: 1,
        s3_key: `${DOCUMENT_TYPE.agentKey}/${DOCUMENT_PROJECT.uid}/${revision.contentSha256}.md`,
        content_sha256: revision.contentSha256,
        document_location: { agent_key: DOCUMENT_TYPE.agentKey, document_id: 'living', revision_id: revision.id },
      },
    };
    let posts = 0;
    let polls = 0;
    await page.route('**' + intake.endpoints.generate, (route) => {
      posts++;
      return fulfillDocumentJson(route, ack);
    });
    await page.route('**' + intake.endpoints.result + '**', (route) => fulfillDocumentJson(route, ++polls === 1 ? ready : persisted));
    await page.evaluate((url) => {
      history.pushState({}, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    }, `/project/mktg-os-agents/${intake.agentId}?project=${DOCUMENT_PROJECT.slug}`);
    await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
    for (const field of intake.fields) {
      if (field.kind !== 'text' && field.kind !== 'textarea') throw new Error('Update the synthetic direct-intake field fixture');
      // LFX form wrappers expose dataTest as data-test, not data-testid.
      await page
        .locator(`[data-test="mktg-intake-${field.key}"]`)
        .fill(field.format?.startsWith('github') ? 'https://github.com/synthetic-org/synthetic-documents' : 'Synthetic answer');
    }
    await expect(page.getByTestId('mktg-agent-run-result')).toHaveCount(0);
    await expect(page.locator('textarea[data-test="mktg-agent-run-feedback"]')).toHaveCount(0);
    const generate = page.getByTestId('mktg-agent-run-submit-button').getByRole('button');
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(page.getByTestId('mktg-agent-run-status')).toContainText('Writing');
    await expect(page).not.toHaveURL(/\/documents\//);
    await expect(page).toHaveURL(new RegExp('revision=' + revision.id), { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision ' + revision.number);
    await expect(page.getByTestId('mktg-document-view-current-2')).toBeVisible();
    expect(posts).toBe(1);
    expect(polls).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: test.info().outputPath('intake-late-receipt-exact-revision.png'), fullPage: true });
  });

  test('multi-round Brand Kit research, checking and writing stay on the run route until the exact stored revision', async ({ page }) => {
    const fixture = await setupNoQuestionsHandoff(page);
    await fixture.openAndGenerate();
    fixture.betweenRounds();
    await expect(page.getByTestId('mktg-run-activity-step-' + fixture.firstReadingId)).toContainText('done', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page).not.toHaveURL(/\/documents\//);
    fixture.startWriting();
    await expect(page.getByTestId('mktg-run-activity-step-' + fixture.lastReadingId)).toContainText('done', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page).not.toHaveURL(/\/documents\//);
    await expect(page.getByTestId('mktg-run-activity-title')).not.toContainText('Writing');
    fixture.startChecking();
    await expect(page.getByTestId('mktg-run-activity-title')).toContainText('Writing', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page).not.toHaveURL(/\/documents\//);
    fixture.storing();
    await expect(page.getByTestId('mktg-agent-run-live')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-page')).toHaveCount(0);
    fixture.finish();
    await expect(page).toHaveURL(new RegExp('revision=' + fixture.revision.id), { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-brand-kit')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-run')).toHaveCount(0);
    expect(fixture.posts).toEqual([BRAND_KIT_INTAKE.endpoints.generate]);
    await page.screenshot({ path: test.info().outputPath('no-questions-research-writing-exact-kit.png'), fullPage: true });
  });

  test('an earlier receipt-less ready result stays on the run page until its exact stored revision', async ({ page }) => {
    const fixture = await setupNoQuestionsHandoff(page);
    await fixture.openAndGenerate();
    fixture.earlyReady();
    await expect(page.getByTestId('mktg-run-activity-title')).toContainText('Writing', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page).not.toHaveURL(/\/documents\//);
    fixture.finish();
    await expect(page).toHaveURL(new RegExp('revision=' + fixture.revision.id), { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-brand-kit')).toBeVisible();
    expect(fixture.posts).toEqual([BRAND_KIT_INTAKE.endpoints.generate]);
    await page.screenshot({ path: test.info().outputPath('early-ready-exact-revision.png'), fullPage: true });
  });

  test('an unconfirmed owned check offers the kept intake without starting another run', async ({ page }) => {
    const fixture = await setupNoQuestionsHandoff(page);
    await fixture.openAndGenerate();
    fixture.startChecking();
    await expect(page.getByTestId('mktg-run-activity-title')).toContainText('Writing', { timeout: DATA_LOAD_TIMEOUT });
    fixture.unconfirm();
    await expect(page.getByTestId('mktg-agent-run-error')).toContainText('Your answers are kept', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
    await expect(page).not.toHaveURL(/\/documents\//);
    expect(fixture.posts).toEqual([BRAND_KIT_INTAKE.endpoints.generate]);
    await page.screenshot({ path: test.info().outputPath('unconfirmed-kept-intake.png'), fullPage: true });
  });

  test('a document observes its first run headlessly until the structured revision lands', async ({ page }) => {
    await suppressCookieBanner(page);
    const fixture = await setupAsset(page);
    await fixture.open();
    await expect(page.getByTestId('mktg-document-view-run')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-framework')).toHaveCount(0);
    fixture.finish();
    await expect(page.getByTestId('mktg-document-view-framework')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-framework-view-positioning')).toContainText('open release toolkit');
    await expect(page.getByTestId('mktg-document-view-run')).toHaveCount(0);
    expect(fixture.state.posts).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('first-run-ready.png'), fullPage: true });
  });

  test('a malformed structured revision is unsupported, never Markdown, while history stays readable', async ({ page }) => {
    const fixture = await setupAsset(page, { mode: 'ready' });
    await page.route('**/api/mktg-agents/documents/*/living/revisions/**', (route) =>
      fulfillDocumentJson(route, { ...assetRevision(), markdown: '{ malformed synthetic JSON' })
    );
    await fixture.open();
    await expect(page.getByTestId('mktg-document-view-unsupported-asset')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-framework')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-revisions')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('unsupported-structured-revision.png'), fullPage: true });
  });

  test('a transient metadata poll failure keeps the known run and offers a truthful refresh warning', async ({ page }) => {
    const fixture = await setupAsset(page);
    await fixture.open();
    await page.evaluate(
      (url) => {
        history.pushState({}, '', url);
        dispatchEvent(new PopStateEvent('popstate'));
      },
      `/project/mktg-os-agents/documents/${assetRevision().type.agentKey}/living?project=${ASSET_PROJECT.slug}&run=${'c'.repeat(64)}`
    );
    await expect(page.getByTestId('mktg-run-public-progress')).toBeVisible();
    await page.route(/\/api\/mktg-agents\/documents\/[^/]+\/living\?/, (route) =>
      new URL(route.request().url()).searchParams.get('poll') === '1' ? fulfillDocumentJson(route, { code: 'SYNTHETIC_UNAVAILABLE' }, 503) : route.fallback()
    );
    await expect(page.getByTestId('mktg-run-progress-status')).toContainText('last loaded', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-run')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-refresh-progress').getByRole('button')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-error')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('transient-run-progress-warning.png'), fullPage: true });
  });

  test('loading settles on the asset without an empty-revisions crash', async ({ page }) => {
    await suppressCookieBanner(page);
    const fixture = await setupAsset(page, { hold: true });
    await fixture.open();
    await expect(page.getByText('Loading the document…', { exact: true })).toBeVisible();
    fixture.finish();
    await expect(page.getByTestId('mktg-document-view-framework')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.screenshot({ path: test.info().outputPath('loading-settled.png'), fullPage: true });
  });

  test('two persistence-failed sessions select distinct targets and Retry only rechecks the selected run', async ({ page }) => {
    await suppressCookieBanner(page);
    const fixture = await setupAsset(page, { mode: 'failed' });
    await fixture.open('&run=' + 'c'.repeat(64));
    await expect(page.getByTestId('mktg-document-view-failure-reply')).toHaveText(ASSET_FAILURE);
    await expect(page.getByTestId('mktg-document-view-intake-link').getByRole('button')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-failure-reply').locator('img')).toHaveCount(0);
    await page.getByTestId('mktg-document-view-progress-retry').getByRole('button').click();
    await expect(page.getByTestId('mktg-document-view-framework')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    expect(fixture.state.retries).toEqual(['c'.repeat(64)]);
    expect(fixture.state.posts).toHaveLength(1);
    expect(fixture.state.posts[0]).toContain('/retry');
    await page.screenshot({ path: test.info().outputPath('selected-run-recovered.png'), fullPage: true });
  });

  test('a questions pause is reached on the run page, not presented on the document', async ({ page }) => {
    const fixture = await setupAsset(page, { mode: 'questions' });
    await fixture.open();
    await expect(page.getByTestId('mktg-document-view-run')).toHaveCount(0);
    await page.evaluate(
      (url) => {
        history.pushState({}, '', url);
        dispatchEvent(new PopStateEvent('popstate'));
      },
      `/project/mktg-os-agents/documents/${assetRevision().type.agentKey}/living?project=${ASSET_PROJECT.slug}&run=${'c'.repeat(64)}`
    );
    await expect(page.getByTestId('mktg-run-public-progress')).toBeVisible();
    await expect(page.getByTestId('mktg-run-progress-status')).toContainText('Waiting for your answers');
    expect(fixture.state.posts).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('questions-intake-action.png'), fullPage: true });
  });

  test('empty Documents is a measured empty state, not an invented stored asset', async ({ page }) => {
    await suppressCookieBanner(page);
    const fixture = await setupAsset(page, { mode: 'empty' });
    await fixture.open();
    await page.evaluate((url) => {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `/project/mktg-os-agents/documents?project=${ASSET_PROJECT.slug}`);
    await expect(page.getByTestId('mktg-documents-empty-all')).toBeVisible();
    await expect(page.getByTestId('mktg-documents-started-runs')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('empty-documents.png'), fullPage: true });
  });

  for (const [label, options, text] of [
    ['unavailable', { mode: 'error' as const }, 'could not be loaded'],
    ['no-access', { writer: false }, 'write access'],
  ] as const) {
    test(`${label} is explicit instead of rendering another asset or claiming it is empty`, async ({ page }) => {
      await suppressCookieBanner(page);
      const fixture = await setupAsset(page, options);
      await fixture.open();
      await expect(page.getByTestId('mktg-document-view-error')).toContainText(text);
      await expect(page.getByTestId('mktg-document-view-framework')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`${label}.png`), fullPage: true });
    });
  }

  test('leaving and returning without local run state uses server progress and no creator result/generate POST', async ({ page }) => {
    await suppressCookieBanner(page);
    const fixture = await setupAsset(page);
    await fixture.open();
    await expect(page.getByTestId('mktg-document-view-run')).toHaveCount(0);
    await page.evaluate((url) => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('lfx-mktg-')) {
          localStorage.removeItem(key);
        }
      }
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `/project/mktg-os-agents/documents?project=${ASSET_PROJECT.slug}`);
    await expect(page.getByTestId('mktg-documents-started-runs')).toBeVisible();
    await page.getByTestId('mktg-documents-open-started-' + 'c'.repeat(64)).click();
    await expect(page.getByTestId('mktg-run-public-progress')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-run')).toHaveCount(0);
    fixture.finish();
    await expect(page.getByTestId('mktg-document-view-framework')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    expect(fixture.state.posts).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('returned-server-asset.png'), fullPage: true });
  });
});
