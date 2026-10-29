// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { BRAND_KIT_PRINT_BODY_CLASS } from '@lfx-one/shared/constants/brand-kit.constants';
import { FOUNDATION_MESSAGE_PRINT_BODY_CLASS } from '@lfx-one/shared/constants/mktg-print.constants';
import { MKTG_SLIDES_EXPORT_AGENT_KEYS, MKTG_SLIDES_EXPORT_API_PATH } from '@lfx-one/shared/constants/mktg-slides-export.constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

import {
  columnAssetRevisionResponse,
  nativeAssetRevisionResponse,
  openAssetDocument,
  openDraftAssetRun,
  openUnapprovedAssetDocument,
} from './helpers/mktg-os-asset-views.helper';

test.beforeEach(async ({ page }) => suppressCookieBanner(page));

// The canonical FAQ report has a failed source and an unanswered question; clean approval scenarios opt out explicitly.
function cleanFaqResponse() {
  const base = nativeAssetRevisionResponse('faq');
  return {
    ...base,
    markdown: JSON.stringify({ faq: [['About', [['What is it?', 'Open collaboration.', 'Docs']]]] }),
    sidecar: { ...base.sidecar, report: { sources_read: ['Docs'], sources_failed: [], gaps: [], notes: '' } },
  };
}

test.describe('Native FAQ document approval and header', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test('keeps Create a new version and Approve in the title card for native FAQ without exports', async ({ page }, info) => {
    await openAssetDocument(page, 'faq');
    const view = page.getByTestId('mktg-faq-view');
    await expect(view).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-readiness')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-readiness')).toHaveText('Ready — 1 of 2 sources could not be read; 1 gap.');
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Draft');
    await expect(page.getByTestId('mktg-document-view-meta')).toContainText('v1');
    await expect(page.getByTestId('mktg-faq-view-metadata')).toHaveCount(0);
    await expect(page.getByTestId('mktg-faq-view-question-0-0')).toBeVisible();
    await expect(page.getByTestId('mktg-faq-view-tabs')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-json')).toHaveCount(0);
    await expect(page.getByTestId('shared-markdown-renderer-content')).toHaveCount(0);
    await expect(view.getByRole('button', { name: /Download PDF|Export to Google Slides/ })).toHaveCount(0);
    const actions = page.getByTestId('mktg-document-view-title-actions');
    await expect(actions.getByTestId('mktg-document-view-run-again')).toHaveText('Create a new version');
    await expect(actions.getByTestId('mktg-document-view-run-again')).toHaveAttribute('href', /\/mktg-os-agents\/faq\?project=/);
    await expect(actions.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
    await expect(page.getByTestId('mktg-faq-view-unanswered-chip')).toHaveCount(0);
    await expect(page.getByTestId('mktg-faq-view-unanswered-open')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('loaded.png'), fullPage: true });
  });
  test('approves directly without confirmation and updates the header', async ({ page }, info) => {
    await openAssetDocument(page, 'faq', 200, true, false, cleanFaqResponse());
    await expect(page.getByTestId('mktg-document-view-readiness')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-readiness')).toHaveText('Ready.');
    const status = page.getByTestId('mktg-document-view-saving-status');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toHaveText('');
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Approved');
    await expect(page.getByTestId('mktg-document-view-approve')).toHaveCount(0);
    await expect(status).toHaveText('Revision 1 is approved and current.');
    await page.screenshot({ path: info.outputPath('approved.png'), fullPage: true });
  });
  test('confirms open source and question gaps before approval, with a no-op Cancel', async ({ page }, info) => {
    await openAssetDocument(page, 'faq');
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/approve?')) writes.push(request.url());
    });
    const approve = page.getByTestId('mktg-document-view-approve').getByRole('button');
    await approve.click();
    const dialog = page.getByRole('dialog', { name: 'Approve with open gaps?' });
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm')).toBeVisible();
    await expect(dialog).toContainText('https://search.example.org/members — 404');
    await expect(dialog).toContainText('How much does membership cost?');
    await dialog.getByTestId('mktg-document-view-approve-cancel').getByRole('button').click();
    await expect(dialog).toBeHidden();
    expect(writes).toHaveLength(0);
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Draft');
    await approve.click();
    await dialog.getByTestId('mktg-document-view-approve-anyway').getByRole('button').click();
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Approved');
    expect(writes).toHaveLength(1);
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('mktg-document-view-readiness')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-readiness')).toHaveText('Ready — 1 of 2 sources could not be read; 1 gap.');
    await page.screenshot({ path: info.outputPath('approved-with-gaps.png'), fullPage: true });
  });
  for (const first of ['approve', 'restore'] as const) {
    test(`disables both writes while ${first} is pending and enables retry after finalize`, async ({ page }, info) => {
      const base = cleanFaqResponse();
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
      await openAssetDocument(page, 'faq', 200, true, false, cleanFaqResponse());
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
  test(`${key} print media fills a paper-sized viewport without content-column containment`, async ({ page, browserName }, info) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.addInitScript(() => {
      window.print = () => undefined;
    });
    await openAssetDocument(page, key, 200, true, false, columnAssetRevisionResponse(key));
    const prefix = key === 'brand-kit' ? 'brand-kit-web-view' : 'mktg-framework-view';
    const print = page.getByTestId(key === 'brand-kit' ? 'mktg-brand-kit-print' : 'mktg-framework-print');
    await expect(print).toBeHidden();
    await page
      .getByTestId(prefix + '-download-pdf')
      .getByRole('button')
      .click();
    await expect(page.locator('body')).toHaveClass(new RegExp(key === 'brand-kit' ? BRAND_KIT_PRINT_BODY_CLASS : FOUNDATION_MESSAGE_PRINT_BODY_CLASS));
    await page.emulateMedia({ media: 'print' });
    // Media emulation does not paginate or apply @page margins. Measure against
    // a paper-sized initial containing block, not the app shell's offset wrapper.
    const paperViewport = { width: 8.5 * 96, height: 11 * 96 };
    await page.setViewportSize(paperViewport);
    await expect(print).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-revisions')).toBeHidden();
    const box = await print.boundingBox();
    if (!box) throw new Error('The approved print document must be rendered');
    expect({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) }).toEqual({ x: 0, y: 0, width: paperViewport.width });
    if (key === 'brand-kit') {
      await expect(print.locator('.kit-chapter')).toHaveCount(5);
      await expect(print.locator('lfx-mktg-print-chapter-header h2 > span')).toHaveText(['1', '2', '3', '4', '5']);
      await expect(print.locator('.lfx-brand-kit-page')).toHaveCount(0);
      await expect(print).toHaveCSS('page', 'mktg-framework');
      await expect(print.getByTestId('kit-print-type')).toContainText('Typography');
    } else await expect(page.getByTestId('mktg-framework-print-tagline')).toHaveText('Build openly.');
    if (browserName === 'chromium') await page.pdf({ path: info.outputPath(`${key}.pdf`), preferCSSPageSize: true, printBackground: true });
    await page.screenshot({ path: info.outputPath(`${key}-print.png`), fullPage: true });
  });
  test(`${key} reads the last export while approved bytes remain pending`, async ({ page }, info) => {
    const lastRead = page.waitForRequest((request) => new URL(request.url()).pathname === `${MKTG_SLIDES_EXPORT_API_PATH}/last`);
    await openUnapprovedAssetDocument(page, key, true);
    await lastRead;
    const prefix = key === 'brand-kit' ? 'brand-kit-web-view' : 'mktg-framework-view';
    await expect(page.getByTestId(prefix)).toContainText('Loading the approved current');
    await expect(page.getByTestId(prefix + '-download-pdf')).toHaveCount(0);
    await expect(page.getByTestId(prefix + '-export-slides')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${key}-history-before-approved.png`), fullPage: true });
  });
  test(`${key} requires approval before PDF or Slides`, async ({ page }, info) => {
    await openUnapprovedAssetDocument(page, key);
    const prefix = key === 'brand-kit' ? 'brand-kit-web-view' : 'mktg-framework-view';
    await expect(page.getByTestId('mktg-document-view-title-actions').getByTestId(prefix + '-approval-required')).toHaveText(
      'Export is available once this version is approved'
    );
    await expect(page.getByTestId(prefix + '-download-pdf')).toHaveCount(0);
    await expect(page.getByTestId(prefix + '-export-slides')).toHaveCount(0);
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
    await expect(page.getByTestId('mktg-framework-view-approval-required')).toHaveText('Export is available once this version is approved');
    await expect(page.getByTestId('mktg-framework-view-download-pdf')).toHaveCount(0);
    await expect(page.getByTestId('mktg-framework-view-export-slides')).toHaveCount(0);
    await page.getByRole('button', { name: 'Open in Documents', exact: true }).click();
    await expect(page.getByTestId('mktg-document-view-page')).toBeVisible();
    await expect(page).toHaveURL(/\/documents\/foundation-message\/living/);
    const selected = new URL(page.url()).searchParams.get('revision');
    expect(selected).toBe(receipt ? revision : null);
    await expect(page.getByTestId('mktg-document-view-approve')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`open-document-${receipt}.png`), fullPage: true });
  });
}
