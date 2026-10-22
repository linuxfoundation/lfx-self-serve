// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { BRAND_KIT_INTAKE, FOUNDATION_MESSAGE_INTAKE, FOUNDATION_MESSAGE_WEBSITE_KEY, ICP_INTAKE, MKTG_RUN_FAILURE_REASON } from '@lfx-one/shared/constants';
import { ASSET_PROJECT, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

test('a failed revision Retry preserves feedback and successful v1 history', async ({ page }, info) => {
  await suppressCookieBanner(page);
  await openAssetDocument(page, 'faq');
  await page.route('**/api/mktg-agents/documents?*', (route) => route.fulfill({ json: { project: ASSET_PROJECT.uid, groups: [] } }));
  await page.route('**/api/mktg-agents/*/stored?*', (route) => route.fulfill({ status: 404, json: { error: 'No optional dependency' } }));
  const submissions: Record<string, unknown>[] = [];
  await page.route(`**${ICP_INTAKE.endpoints.generate}`, (route) => {
    submissions.push(route.request().postDataJSON());
    return route.fulfill({ json: { sessionId: `synthetic-revision-${submissions.length}`, ownerToken: 'synthetic-proof' } });
  });
  await page.route(`**${ICP_INTAKE.endpoints.result}`, (route) => {
    if (submissions.length === 2)
      return route.fulfill({ json: { status: 'failed', failure: { eventType: 'runtime_error', reason: MKTG_RUN_FAILURE_REASON } } });
    return route.fulfill({
      json: {
        status: 'ready',
        version: submissions.length === 1 ? 1 : 2,
        documentMarkdown: '# Synthetic ICP',
        persistence: { project: ASSET_PROJECT.uid, s3_key: 'synthetic/icp.md' },
      },
    });
  });
  await page.evaluate((url) => {
    history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/mktg-os-agents/${ICP_INTAKE.agentId}?project=${ASSET_PROJECT.slug}`);
  for (const field of ICP_INTAKE.fields.filter((value) => !value.optional)) {
    await page
      .locator(`[data-test="mktg-intake-${field.key}"]`)
      .fill(field.key === 'github_url' ? 'https://github.com/synthetic-project/example' : 'Synthetic adoption goals');
  }
  await page.getByTestId('mktg-agent-run-submit-button').getByRole('button').click();
  await expect(page.getByTestId('mktg-agent-run-doc-version')).toHaveText('v1', { timeout: 20000 });
  await page.locator('textarea[data-test="mktg-agent-run-feedback"]').fill('Keep this exact revision feedback.');
  await page.getByTestId('mktg-agent-run-regenerate-button').getByRole('button').click();
  await expect(page.getByTestId('mktg-agent-run-error')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('mktg-agent-run-retry').getByRole('button').click();
  await expect(page.getByTestId('mktg-agent-run-doc-version')).toHaveText('v2', { timeout: 20000 });
  expect(submissions[2]).toEqual(submissions[1]);
  expect(submissions[2]).toMatchObject({ feedback: 'Keep this exact revision feedback.', priorVersion: 1 });
  await expect(page.getByTestId('mktg-agent-run-version-chips')).toContainText('v1');
  await page.screenshot({ path: info.outputPath('retry-feedback-v2.png'), fullPage: true });
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
