// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE, MKTG_SLIDES_EXPORT_AGENT_KEYS, MKTG_SLIDES_EXPORT_API_PATH } from '@lfx-one/shared/constants';
import { nativeAssetRevisionResponse, openAssetDocument, openDraftAssetRun, openUnapprovedAssetDocument } from './helpers/mktg-os-asset-views.helper';

test.describe('Native FAQ document approval and header', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test('projects the shared document header and catalog Run again onto the native FAQ without exports', async ({ page }, info) => {
    await openAssetDocument(page, 'faq');
    const view = page.getByTestId('mktg-faq-view');
    await expect(view).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Draft');
    await expect(page.getByTestId('mktg-document-view-meta')).toContainText('v1');
    await expect(page.getByTestId('mktg-faq-view-metadata')).toHaveCount(0);
    await expect(page.getByTestId('mktg-faq-view-question-0-0')).toBeVisible();
    await expect(page.getByTestId('mktg-faq-view-tabs')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-json')).toHaveCount(0);
    await expect(page.getByTestId('shared-markdown-renderer-content')).toHaveCount(0);
    await expect(view.getByRole('button', { name: /Download PDF|Export to Google Slides/ })).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-run-again')).toHaveAttribute('href', /\/mktg-os-agents\/faq\?project=/);
    await page.screenshot({ path: info.outputPath('loaded.png'), fullPage: true });
  });
  test('approves directly without confirmation and updates the header', async ({ page }, info) => {
    await openAssetDocument(page, 'faq');
    const status = page.getByTestId('mktg-document-view-saving-status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toHaveText('');
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Approved');
    await expect(page.getByTestId('mktg-document-view-approve')).toHaveCount(0);
    await expect(status).toHaveText('Revision 1 is approved and current.');
    await page.screenshot({ path: info.outputPath('approved.png'), fullPage: true });
  });
  for (const first of ['approve', 'restore'] as const) {
    test(`disables both writes while ${first} is pending and enables retry after finalize`, async ({ page }, info) => {
      const base = nativeAssetRevisionResponse('faq');
      const older = { ...base.revision, id: `000002-${'b'.repeat(64)}`, number: 2, latest: false };
      await openAssetDocument(page, 'faq', 200, true, false, { ...base, revisions: [base.revision, older] });
      let release: (() => void) | undefined;
      const pending = new Promise<void>((done) => (release = done));
      const writes: string[] = [];
      await page.route('**/api/mktg-agents/documents/faq/living/**', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        writes.push(new URL(route.request().url()).pathname.endsWith('/approve') ? 'approve' : 'restore');
        await pending;
        return route.fulfill({ status: 500, json: { error: 'Synthetic write failure' } });
      });
      const approve = page.getByTestId('mktg-document-view-approve').getByRole('button');
      const restore = page.getByTestId('mktg-document-view-restore-2');
      const sent = page.waitForRequest((request) => request.method() === 'POST' && request.url().includes('/documents/faq/living/'));
      await (first === 'approve' ? approve : restore).click();
      await sent;
      await expect(approve).toBeDisabled();
      await expect(restore).toBeDisabled();
      await expect.poll(() => writes).toEqual([first]);
      release?.();
      await expect(approve).toBeEnabled();
      await expect(restore).toBeEnabled();
      await page.screenshot({ path: info.outputPath(`${first}-write-finalized.png`), fullPage: true });
    });
  }
  for (const name of [null, 'Synthetic approval role']) {
    test(`shows a different approved current with its actual approver or neutral fallback (${name ?? 'unknown'})`, async ({ page }, info) => {
      await openAssetDocument(page, 'faq');
      const base = nativeAssetRevisionResponse('faq');
      const approval = { approvedAt: '2026-10-19T11:00:00Z', approvedBy: name ? { name } : null };
      const approved = { ...base.revision, approval };
      const draft = { ...base.revision, id: `000002-${'b'.repeat(64)}`, number: 2, latest: false };
      const response = { ...base, revision: draft, revisions: [draft, approved], approvedCurrent: { revisionId: approved.id, number: 1 } };
      await page.route('**/api/mktg-agents/documents/faq/living/revisions/**', (route) => route.fulfill({ json: response }));
      await page.evaluate((revision) => {
        const url = new URL(window.location.href);
        url.searchParams.set('revision', revision);
        window.history.pushState({}, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, draft.id);
      await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Draft');
      await expect(page.getByTestId('mktg-document-view-meta')).toContainText(`the kit still shows v1, approved by ${name ?? 'a project writer'}`);
      await expect(page.getByTestId('mktg-document-view-version')).toHaveText('v2');
      const revisions = page.getByTestId('mktg-document-view-revisions');
      const approvedRow = revisions.getByTestId('mktg-document-view-revision-label-1');
      await expect(approvedRow).toContainText(' · Approved');
      await expect(approvedRow.getByTestId('mktg-document-view-current-1')).toHaveText('Current');
      await expect(approvedRow).toContainText(` · approved by ${name ?? 'a project writer'}`);
      const draftRow = revisions.getByTestId('mktg-document-view-revision-label-2');
      await expect(draftRow).toContainText(' · Draft');
      await expect(draftRow).not.toContainText('approved by');
      await expect(draftRow.getByTestId('mktg-document-view-current-2')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`other-approved-${name ? 'named' : 'unknown'}.png`), fullPage: true });
    });
  }
  for (const status of [500, 412]) {
    test(`keeps the Draft and inline retry on approval ${status}`, async ({ page }, info) => {
      await openAssetDocument(page, 'faq');
      const message = 'The document changed while making a revision current. Reload and try again.';
      await page.route('**/api/mktg-agents/documents/faq/living/revisions/*/approve?*', (route) =>
        route.fulfill({ status, json: { error: message, code: 'PRECONDITION_FAILED' } })
      );
      const approve = page.getByTestId('mktg-document-view-approve').getByRole('button');
      await approve.click();
      await expect(page.getByTestId('mktg-document-view-approval-error')).toContainText(
        status === 412 ? message : 'The approval could not be confirmed. Reload to see the current state before trying again.'
      );
      await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Draft');
      await expect(page.getByTestId('mktg-document-view-saving-status')).toContainText(status === 412 ? message : 'The approval could not be confirmed.');
      await expect(approve).toBeEnabled();
      await page.screenshot({ path: info.outputPath(`approval-error-${status}.png`), fullPage: true });
    });
  }
  test('shows a plain unreadable-JSON error, never the stored bytes', async ({ page }, info) => {
    await openAssetDocument(page, 'faq', 200, true, true);
    await expect(page.getByTestId('mktg-document-view-unreadable-json')).toContainText('This revision could not be displayed. Revision 1.');
    await expect(page.getByTestId('mktg-document-view-json')).toHaveCount(0);
    await expect(page.getByTestId('shared-markdown-renderer-content')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-page')).not.toContainText('synthetic source text');
    await page.screenshot({ path: info.outputPath('unreadable.png'), fullPage: true });
  });
  test('keeps a loading state while the read is pending', async ({ page }, info) => {
    await openAssetDocument(page, 'faq', 0);
    await expect(page.getByTestId('mktg-document-view-loading')).toContainText('Loading the document');
    await expect(page.getByTestId('mktg-faq-view')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('loading.png'), fullPage: true });
  });
  for (const status of [403, 404, 500]) {
    test(`shows a distinct ${status} read state`, async ({ page }, info) => {
      await openAssetDocument(page, 'faq', status, status !== 403);
      let message = 'This revision could not be loaded';
      if (status === 403) message = 'You need write access';
      if (status === 404) message = 'This document has no such revision';
      await expect(page.getByTestId('mktg-document-view-error')).toContainText(message);
      await expect(page.getByTestId('mktg-faq-view')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`error-${status}.png`), fullPage: true });
    });
  }
});

for (const key of MKTG_SLIDES_EXPORT_AGENT_KEYS) {
  test(`${key} reads the last export while approved bytes remain pending`, async ({ page }, info) => {
    const lastRead = page.waitForRequest((request) => new URL(request.url()).pathname === `${MKTG_SLIDES_EXPORT_API_PATH}/last`);
    await openUnapprovedAssetDocument(page, key, true);
    await lastRead;
    const prefix = key === 'brand-kit' ? 'brand-kit-web-view' : 'mktg-framework-view';
    await expect(page.getByTestId(prefix)).toContainText('Loading the approved current');
    await expect(page.getByTestId(prefix + '-download-pdf').getByRole('button')).toBeDisabled();
    await expect(page.getByTestId(prefix + '-export-slides').getByRole('button')).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`${key}-history-before-approved.png`), fullPage: true });
  });
  test(`${key} requires approval before PDF or Slides`, async ({ page }, info) => {
    await openUnapprovedAssetDocument(page, key);
    const prefix = key === 'brand-kit' ? 'brand-kit-web-view' : 'mktg-framework-view';
    await expect(page.getByTestId(prefix + '-approval-required')).toHaveText(MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE);
    await expect(page.getByTestId(prefix + '-download-pdf').getByRole('button')).toBeDisabled();
    await expect(page.getByTestId(prefix + '-export-slides').getByRole('button')).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`${key}-approve-first.png`), fullPage: true });
  });
}

for (const receipt of [true, false]) {
  test(`standalone Draft opens the ${receipt ? 'receipt-named revision' : 'document default'}, never approving or exporting by digest`, async ({
    page,
  }, info) => {
    const revision = await openDraftAssetRun(page, receipt);
    await expect(page.getByTestId('mktg-framework-view-approval-state')).toHaveText('Draft');
    await expect(page.getByTestId('mktg-document-view-approve')).toHaveCount(0);
    await expect(page.getByTestId('mktg-framework-view-header')).not.toContainText('approved by');
    await expect(page.getByTestId('mktg-framework-view-header')).not.toContainText('the kit still shows');
    await expect(page.getByTestId('mktg-framework-view-download-pdf').getByRole('button')).toBeDisabled();
    await expect(page.getByTestId('mktg-framework-view-export-slides').getByRole('button')).toBeDisabled();
    await page.getByRole('button', { name: 'Open in Documents', exact: true }).click();
    await expect(page.getByTestId('mktg-document-view-page')).toBeVisible();
    await expect(page).toHaveURL(/\/documents\/foundation-message\/living/);
    const selected = new URL(page.url()).searchParams.get('revision');
    expect(selected).toBe(receipt ? revision : null);
    await expect(page.getByTestId('mktg-document-view-approve')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`open-document-${receipt}.png`), fullPage: true });
  });
}
