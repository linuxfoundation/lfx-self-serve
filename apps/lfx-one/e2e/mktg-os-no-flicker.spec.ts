// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { kitTest as test, kitJson, KIT_PROJECT, openKit, setupKit } from './helpers/mktg-kit.helper';
import { DOCUMENTS_URL, openDocuments, setupDocuments, startedDocumentRun } from './helpers/mktg-os-documents.helper';
import { MEMBER_360_DOCUMENT_ID, openMember360, setupMember360 } from './helpers/member-360.helper';
import { member360Revision } from './fixtures/mock-data/member-360.mock';

// Deliberately hold reads instead of racing fast local fixtures: QA can capture both paints.
test.beforeEach(async ({ page }) => suppressCookieBanner(page));
test.afterEach(async ({ page }, info) => {
  await page.screenshot({ path: info.outputPath('settled.png'), fullPage: true });
});

test('living document lands with its catalog title and resolved action, never Run again first', async ({ page }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await setupKit(page, { loaded: true, revisionHold: hold });
  await openKit(page, '/documents/foundation-message/living');
  await expect(page.getByTestId('mktg-document-view-title-loading')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-action-loading')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-title')).toHaveCount(0);
  await expect(page.getByTestId('mktg-document-view-run-again')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('loading.png'), fullPage: true });
  release();
  await expect(page.getByTestId('mktg-document-view-title')).toHaveText(`${KIT_PROJECT.name} Messaging framework`);
  await expect(page.getByTestId('mktg-document-view-run-again')).toHaveText('Create a new version');
});

test('Member 360 title waits for the resolved reporting period', async ({ page }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await setupMember360(page, { stored: true });
  await page.route(`**/api/mktg-agents/documents/member-360/${MEMBER_360_DOCUMENT_ID}**`, async (route) => {
    await hold;
    await kitJson(route, member360Revision());
  });
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  await expect(page.getByTestId('mktg-document-view-title-loading')).toBeVisible();
  await expect(page.getByTestId('mktg-document-view-title')).toHaveCount(0);
  release();
  await expect(page.getByTestId('mktg-document-view-title')).toHaveText('Member 360 · 2026-Q3');
});

test('Documents reserves started runs on arrival and keeps the slot when a run ends', async ({ page }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  const run = startedDocumentRun();
  const runs = [run];
  await setupDocuments(page, { runs });
  let first = true;
  await page.route('**/api/mktg-agents/documents?*', async (route) => {
    if (first) {
      first = false;
      await hold;
    }
    await route.fallback();
  });
  await openDocuments(page);
  await expect(page.getByTestId('mktg-documents-started-loading')).toBeVisible();
  await expect(page.getByTestId('mktg-documents-started-runs')).toHaveCount(0);
  release();
  await expect(page.getByTestId(`mktg-documents-started-run-${run.runId}`)).toBeVisible();
  runs.splice(0);
  const slot = page.getByTestId('mktg-documents-started-runs');
  await expect(slot).toContainText('No runs in progress', { timeout: 15_000 });
  await expect(slot).toBeVisible();
  await expect(page.getByTestId('mktg-documents-revisions')).toBeVisible();
});

test('Documents navigation refetch does not blank loaded content or badges', async ({ page }) => {
  await setupDocuments(page);
  await openDocuments(page, DOCUMENTS_URL.replace(/&type=[^&]+/, ''));
  await expect(page.getByTestId('mktg-documents-all')).toBeVisible();
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/mktg-agents/documents?*', async (route) => {
    await hold;
    await route.fallback();
  });
  await page.getByTestId('mktg-documents-nav-icp').click();
  await expect(page.getByTestId('mktg-documents-revisions')).toBeVisible();
  await expect(page.getByTestId('mktg-documents-loading')).toHaveCount(0);
  await expect(page.getByTestId('mktg-documents-nav-icp')).toContainText('current');
  release();
});

test('Family reserves its header action until the kit answers', async ({ page }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => (release = resolve));
  await setupKit(page, { loaded: true, hold });
  await openKit(page, '/families/positioning-brand');
  await expect(page.getByTestId('mktg-family-action-loading')).toBeVisible();
  await expect(page.getByTestId('mktg-family-actions')).toHaveCount(0);
  await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
  release();
  await expect(page.getByTestId('mktg-family-run')).toContainText('Review 4 drafts');
  await expect(page.getByTestId('mktg-family-assets')).toBeVisible();
  await expect(page.getByTestId('mktg-family-action-loading')).toHaveCount(0);
});
