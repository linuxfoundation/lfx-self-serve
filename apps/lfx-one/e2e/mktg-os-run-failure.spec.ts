// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { BRAND_KIT_INTAKE, FOUNDATION_MESSAGE_INTAKE, ICP_INTAKE, MKTG_RUN_FAILURE_REASON } from '@lfx-one/shared/constants/mktg-run.constants';
import { FOUNDATION_MESSAGE_WEBSITE_KEY } from '@lfx-one/shared/constants/foundation-message.constants';
import { DOCUMENT_PROJECT, DOCUMENT_TYPE, documentFixture, fulfillDocumentJson, setupDocuments } from './helpers/mktg-os-documents.helper';
import { ASSET_PROJECT, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

test('ICP document failure returns its retained inputs and explicit Retry starts a fresh session that lands', async ({ page }, info) => {
  await suppressCookieBanner(page);
  await setupDocuments(page, { empty: true });
  const submitted: unknown[] = [];
  const sessions: string[] = [];
  let ready = false;
  const history = documentFixture();
  const revision = history.revisions[0];
  const stored = {
    ...history,
    revisions: [revision],
    revision,
    current: { revisionId: revision.id, changedAt: revision.createdAt, changedBy: null },
    markdown: '# Recovered synthetic ICP',
    approval: null,
    sidecar: null,
  };
  await page.route('**/api/mktg-agents/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/stored')) return fulfillDocumentJson(route, {}, 404);
    if (path.endsWith('/retry')) throw new Error('Generation failure must never reopen the dead Guild session');
    if (path === ICP_INTAKE.endpoints.generate) {
      submitted.push(route.request().postDataJSON());
      return fulfillDocumentJson(route, {
        sessionId: `synthetic-icp-${submitted.length}`,
        ownerToken: 'synthetic-proof',
        runId: (submitted.length === 1 ? 'b' : 'c').repeat(64),
      });
    }
    if (path === ICP_INTAKE.endpoints.result) {
      const body = route.request().postDataJSON();
      sessions.push(body.sessionId);
      if (body.sessionId === 'synthetic-icp-1')
        return fulfillDocumentJson(route, { status: 'failed', failure: { eventType: 'runtime_error', reason: MKTG_RUN_FAILURE_REASON } });
      ready = true;
      return fulfillDocumentJson(route, {
        status: 'ready',
        version: 1,
        documentMarkdown: stored.markdown,
        persistence: {
          project: DOCUMENT_PROJECT.uid,
          version: 1,
          s3_key: 'synthetic-icp.md',
          content_sha256: revision.contentSha256,
          document_location: { agent_key: DOCUMENT_TYPE.agentKey, document_id: 'living', revision_id: revision.id },
        },
      });
    }
    if (path.endsWith('/documents/icp/living'))
      return fulfillDocumentJson(
        route,
        ready
          ? { ...stored, runs: [] }
          : {
              project: DOCUMENT_PROJECT.uid,
              type: DOCUMENT_TYPE,
              documentId: 'living',
              revisions: [],
              approvedCurrent: null,
              runs: submitted.length
                ? [
                    {
                      project: DOCUMENT_PROJECT.uid,
                      agentKey: DOCUMENT_TYPE.agentKey,
                      documentId: 'living',
                      runId: (submitted.length === 1 ? 'b' : 'c').repeat(64),
                      startedAt: new Date().toISOString(),
                      state: submitted.length === 1 ? 'failed' : 'writing',
                      ...(submitted.length === 1 && { failureText: MKTG_RUN_FAILURE_REASON }),
                    },
                  ]
                : [],
            }
      );
    if (path.includes('/revisions/')) return fulfillDocumentJson(route, stored);
    if (path.endsWith('/comments')) return fulfillDocumentJson(route, { revisionId: revision.id, threads: [] });
    return route.fallback();
  });
  await page.evaluate((url) => {
    history.pushState({}, '', url);
    dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/${ICP_INTAKE.agentId}?project=${DOCUMENT_PROJECT.slug}`);
  for (const field of ICP_INTAKE.fields) {
    if (field.optional) continue;
    await page
      .locator(`#mktg-intake-${field.key}`)
      .fill(field.format === 'github-repo-url' ? 'https://github.com/synthetic-org/synthetic-orbit' : 'Synthetic ICP input');
  }
  await page.getByTestId('mktg-agent-run-submit-button').getByRole('button').click();
  await expect(page.getByTestId('mktg-document-view-failure-reply')).toContainText(MKTG_RUN_FAILURE_REASON, { timeout: 20000 });
  expect(submitted).toHaveLength(1);
  await page.getByTestId('mktg-document-view-intake-link').getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByTestId('mktg-agent-run-retry')).toBeVisible();
  expect(submitted).toHaveLength(1);
  await page.getByTestId('mktg-agent-run-retry').getByRole('button').click();
  await expect(page.getByRole('heading', { name: 'Recovered synthetic ICP', exact: true })).toBeVisible({ timeout: 20000 });
  expect(submitted).toHaveLength(2);
  expect(submitted[1]).toEqual(submitted[0]);
  expect(sessions).toContain('synthetic-icp-2');
  await page.screenshot({ path: info.outputPath('icp-document-fresh-retry-ready.png'), fullPage: true });
});

test('generic catalog run fails within one poll and Retry starts fresh with the same inputs', async ({ page }, info) => {
  await suppressCookieBanner(page);
  await openAssetDocument(page, 'faq');
  await page.route(`**${BRAND_KIT_INTAKE.endpoints.stored}**`, (route) => route.fulfill({ status: 404, json: { error: 'No approved branding' } }));
  const submitted: unknown[] = [];
  await page.route(`**${FOUNDATION_MESSAGE_INTAKE.endpoints.generate}`, (route) => {
    submitted.push(route.request().postDataJSON());
    return route.fulfill({ json: { sessionId: `synthetic-session-${submitted.length}`, ownerToken: 'synthetic-proof' } });
  });
  let polls = 0;
  await page.route(`**${FOUNDATION_MESSAGE_INTAKE.endpoints.result}`, (route) => {
    polls++;
    return route.fulfill({ json: { status: 'failed', failure: { eventType: 'runtime_error', reason: MKTG_RUN_FAILURE_REASON } } });
  });
  await page.evaluate((url) => {
    history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/${FOUNDATION_MESSAGE_INTAKE.agentId}?project=${ASSET_PROJECT.slug}`);
  await page.locator('[data-test="mktg-intake-project_name"]').fill(ASSET_PROJECT.name);
  await page.locator(`[data-test="mktg-intake-${FOUNDATION_MESSAGE_WEBSITE_KEY}"]`).fill('https://project.example');
  await page.getByTestId('mktg-agent-run-submit-button').getByRole('button').click();
  await expect(page.getByTestId('mktg-agent-run-error')).toContainText(MKTG_RUN_FAILURE_REASON, { timeout: 20000 });
  await expect.poll(() => polls).toBe(1);
  await expect(page.getByTestId('mktg-framework-view')).toHaveCount(0);
  await page.getByTestId('mktg-agent-run-retry').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('mktg-agent-run-error')).toHaveCount(0);
  await expect.poll(() => submitted.length).toBe(2);
  expect(submitted[1]).toEqual(submitted[0]);
  await expect.poll(() => polls, { timeout: 20000 }).toBe(2);
  await expect(page.getByTestId('mktg-agent-run-error')).toContainText(MKTG_RUN_FAILURE_REASON, { timeout: 20000 });
  await page.screenshot({ path: info.outputPath('generic-run-failed-retry.png'), fullPage: true });
});
