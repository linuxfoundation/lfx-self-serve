// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import {
  BRAND_KIT_PRINT_BODY_CLASS,
  FOUNDATION_MESSAGE_PRINT_BODY_CLASS,
  MKTG_SLIDES_EXPORT_AGENT_KEYS,
  MKTG_SLIDES_EXPORT_API_PATH,
} from '@lfx-one/shared/constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import {
  expectMktgPortraitPageSetup,
  expectMktgPrintFrame,
  finishMktgPrintFrame,
  layoutMktgPrintFrame,
  mktgPrintComputedPx,
  PRINT_FRAME_LETTER,
  stubMktgPrintFrame,
} from './helpers/mktg-print.helper';

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
    // The gaps view says what was accepted at approval and is still open; the header keeps its count.
    await page.getByTestId('mktg-faq-view-tab-sources').click();
    await expect(page.getByTestId('mktg-faq-view-gaps')).toContainText('How much does membership cost?');
    await expect(page.getByTestId('mktg-faq-view-gaps-accepted')).toHaveText('Accepted when v1 was approved; still open.');
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
      const header = page.getByTestId('mktg-document-view-title-card');
      await expect(header.getByTestId('mktg-document-view-meta')).toContainText(`the kit still shows v1, approved by ${name ?? 'a project writer'}`);
      await expect(page.getByTestId('mktg-document-view-version')).toHaveText('v2');
      const revisions = page.getByTestId('mktg-document-view-revisions');
      const approvedRow = revisions.getByTestId('mktg-document-view-revision-label-1');
      await expect(approvedRow).toContainText('v1 · Approved');
      await expect(approvedRow.getByTestId('mktg-document-view-current-1')).toHaveText('Current');
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
    await expect(page.getByTestId('mktg-document-view-title-loading')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-action-loading')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-title-loading').getByRole('status')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('mktg-document-view-loading').getByRole('status')).toHaveText('Loading the document…');
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
  test(`${key} isolated print frame preserves paper-sized layout without content-column containment`, async ({ page, browserName }, info) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await stubMktgPrintFrame(page);
    await openAssetDocument(page, key, 200, true, false, columnAssetRevisionResponse(key));
    const prefix = key === 'brand-kit' ? 'brand-kit-web-view' : 'mktg-framework-view';
    const testId = key === 'brand-kit' ? 'mktg-brand-kit-print' : 'mktg-framework-print';
    await expect(page.getByTestId(testId)).toBeHidden();
    await page
      .getByTestId(prefix + '-download-pdf')
      .getByRole('button')
      .click();
    const bodyClass = key === 'brand-kit' ? BRAND_KIT_PRINT_BODY_CLASS : FOUNDATION_MESSAGE_PRINT_BODY_CLASS;
    await expectMktgPrintFrame(page, bodyClass, key === 'brand-kit' ? 'lfx-mktg-brand-kit-print' : 'lfx-mktg-framework-print');
    // The page itself is never put under print media by production: the app shell stays as it was.
    await expect(page.locator('body')).not.toHaveClass(new RegExp(bodyClass));
    await expect(page.getByTestId('mktg-document-view-revisions')).toBeVisible();
    // Media emulation does not paginate or apply @page margins. Measure the frame's own layout
    // against a paper-sized initial containing block: that is the document the dialog prints.
    const frame = await layoutMktgPrintFrame(page);
    const print = frame.getByTestId(testId);
    await expect(print).toBeVisible();
    // Only the print-only wrapper was cloned: none of the screen shell travels into the frame.
    await expect(frame.getByTestId('mktg-document-view-revisions')).toHaveCount(0);
    await expect(frame.getByTestId(prefix + '-download-pdf')).toHaveCount(0);
    const box = await print.boundingBox();
    if (!box) throw new Error('The approved print document must be rendered');
    expect({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width) }).toEqual({ x: 0, y: 0, width: PRINT_FRAME_LETTER.width });
    if (key === 'brand-kit') {
      // The kit is a portrait book: US Letter frames, no page margin in either engine, sixteen frames in the mock's order
      // (no symbol page: the synthetic kit has no symbol), each 816×1056 at the sheet's edge, and nothing flowing.
      await expectMktgPortraitPageSetup(frame);
      const frames = print.getByTestId('lfx-mktg-portrait-page');
      await expect(frames).toHaveCount(16);
      await expect(frames.first()).toHaveAttribute('data-page-id', 'cover');
      await expect(frames.last()).toHaveAttribute('data-page-id', 'back-cover');
      await expect(frames.first()).toHaveCSS('page', 'mktg-portrait');
      await expect(frames.first()).toHaveCSS('break-after', 'page');
      const coverBox = await frames.first().boundingBox();
      expect(
        coverBox && { x: Math.round(coverBox.x), y: Math.round(coverBox.y), width: Math.round(coverBox.width), height: Math.round(coverBox.height) }
      ).toEqual({
        x: 0,
        y: 0,
        width: PRINT_FRAME_LETTER.width,
        height: 1056,
      });
      await expect(print.getByTestId('mktg-portrait-cover-title')).toHaveText('Brand Kit');
      await expect(print.locator('.kit-chapter, lfx-mktg-print-chapter-header, .lfx-brand-kit-page, tfoot')).toHaveCount(0);
      await expect(print.getByTestId('mktg-portrait-page-number')).toHaveText(Array.from({ length: 14 }, (_, index) => String(index + 2)));
    } else {
      // The framework prints as a portrait book of fixed Letter frames on the portrait grammar, one per plan page, on its
      // own margin-less setup in both engines: nothing flows across a page edge, so no sheet tables, no head or foot groups.
      await expectMktgPortraitPageSetup(frame, print);
      await expect(print.locator('lfx-mktg-print-sheet, thead, tfoot')).toHaveCount(0);
      await expect(print).toHaveCSS('position', 'static');
      await expect(print).toHaveCSS('display', 'block');
      await expect(print.locator('.h-screen, .min-h-screen, .flex-1')).toHaveCount(0);
      // One goal and one profile: the cover, the framework, the goal, say and avoid, the profiles, the house, the numbers, sources and gaps.
      const pages = print.getByTestId('lfx-mktg-portrait-page');
      await expect(pages).toHaveCount(8);
      expect(await pages.evaluateAll((sections) => sections.map((section) => section.getAttribute('data-page-id')))).toEqual([
        'cover',
        'framework',
        'goal-1',
        'say-avoid',
        'icps-1',
        'message-house',
        'key-numbers',
        'sources',
      ]);
      expect(await pages.evaluateAll((sections) => sections.map((section) => section.getAttribute('data-page')))).toEqual([
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
      ]);
      // The cover: the dark band edge to edge with the tagline and the umbrella, the title with the revision's version and
      // approval date (this fixture's record carries no read date), the contents, the strip.
      await expect(frame.getByTestId('mktg-framework-print-tagline')).toHaveText('Build openly.');
      await expect(frame.getByTestId('mktg-framework-print-umbrella')).toHaveText('Open collaboration.');
      await expect(frame.getByTestId('mktg-framework-print-title')).toHaveText('Messaging Framework');
      await expect(frame.getByTestId('mktg-framework-print-version')).toHaveText('V1.0 · Approved 19 Oct 2026');
      await expect(frame.getByTestId('mktg-framework-print-contents').locator('li')).toHaveCount(7);
      await expect(frame.getByTestId('mktg-framework-print-contents').locator('li').first()).toContainText('Framework');
      await expect(frame.getByTestId('mktg-framework-print-contents').locator('li').last()).toContainText('Sources & gaps');
      await expect(frame.getByTestId('mktg-framework-print-cover-strip')).toContainText('a Linux Foundation project');
      const coverBand = frame.getByTestId('mktg-framework-print-cover');
      await expect(coverBand).toBeVisible();
      expect(await coverBand.boundingBox()).toMatchObject({ x: 0, y: 0, width: 816, height: 420 });
      // Every inner page carries the running head with the chapter and the document's name, its title and its two-digit page number.
      await expect(print.getByTestId('mktg-portrait-page-head')).toHaveCount(7);
      await expect(print.getByTestId('mktg-portrait-page-doc').first()).toContainText('messaging framework');
      await expect(print.getByTestId('mktg-portrait-page-title')).toHaveText([
        'Framework',
        'Goal 1 · Adoption',
        'Say and avoid · anchor questions',
        'Ideal customer profiles',
        'Message house',
        'Key numbers',
        'Sources & gaps',
      ]);
      await expect(print.getByTestId('mktg-portrait-page-number')).toHaveText(['02', '03', '04', '05', '06', '07', '08']);
      // The chapter band on a chapter's first page only.
      await expect(print.getByTestId('mktg-portrait-page-band')).toHaveCount(5);
      // The framework page's goal matrix, one column per goal, with the grammar's labels.
      const rowLabels = print.getByTestId('mktg-framework-print-goals-label');
      await expect(rowLabels).toHaveText(['Value proposition', 'Key message', 'Proof', 'Sound bite']);
      for (const label of await rowLabels.all()) {
        await expect(label).toHaveCSS('text-transform', 'uppercase');
        const tracking = await label.evaluate((element) => {
          const style = getComputedStyle(element);
          return parseFloat(style.letterSpacing) / parseFloat(style.fontSize);
        });
        expect(tracking).toBeCloseTo(0.12);
      }
      // The goal's page, the profile with the goals × profiles matrix (one profile: the page has room), the house, the numbers.
      await expect(print.getByTestId('mktg-framework-print-goal-1')).toContainText('01');
      await expect(print.getByTestId('mktg-framework-print-icp-users')).toContainText('End users');
      await expect(print.getByTestId('mktg-framework-print-matrix-row')).toHaveCount(1);
      await expect(print.getByTestId('mktg-framework-print-matrix-dot')).toHaveCount(1);
      await expect(print.getByTestId('mktg-framework-print-pillars')).toContainText('Open');
      await expect(print.getByTestId('mktg-framework-print-numbers')).toContainText('1,200');
      // One number: its tile spans the column (no orphan half-tile); the facts table lists the fixture's one proof point.
      await expect(print.getByTestId('mktg-framework-print-number-tile-0')).toHaveAttribute('data-wide', 'true');
      await expect(print.locator('[data-testid^="mktg-framework-print-number-tile-"]')).toHaveCount(1);
      await expect(print.locator('[data-testid^="mktg-framework-print-fact-"]')).toHaveCount(1);
      // Nothing to avoid in this fixture: the page says so rather than printing an empty list.
      await expect(print.getByTestId('mktg-framework-print-avoid')).toHaveCount(0);
      await expect(print.getByTestId('mktg-framework-print-avoid-empty')).toHaveText('Nothing to avoid was stated.');
      // Sources & gaps: the fixture's sidecar carries a report with empty lists and no read date, so the Read block is empty, the two
      // shared empty-state lines print, the approval card names the version and the approval without the gaps clause, and no
      // Notes block exists (the run's notes stay on screen).
      await expect(print.getByTestId('mktg-framework-print-sources-intro')).toHaveText(
        'What the framework was built from, what could not be read, and what is still open.'
      );
      await expect(print.getByTestId('mktg-framework-print-sources-read').locator('li')).toHaveCount(0);
      await expect(print.getByTestId('mktg-framework-print-sources-failed-empty')).toHaveText('No source failed.');
      await expect(print.getByTestId('mktg-framework-print-gaps-empty')).toHaveText('The sources left no gap.');
      await expect(print.getByTestId('mktg-framework-print-approval')).toHaveText(
        'V1.0 · Approved 19 Oct 2026. A later run re-reads the sources and refreshes the LFX figures.'
      );
      await expect(print.getByTestId('mktg-framework-print-notes')).toHaveCount(0);
      await expect(pages.last()).not.toContainText('Notes');
      // No reviewer's note on paper.
      await expect(print).not.toContainText('choices for the reviewer');
      // Visibility-only hiding leaves screen canvas height behind. The entire
      // ancestor chain in the frame must be white/content-sized, and nothing else in flow.
      const flow = await print.evaluate((root) => {
        const ancestors = [];
        let parent = root.parentElement;
        while (parent) {
          const css = getComputedStyle(parent);
          ancestors.push({ background: css.backgroundColor, minHeight: css.minHeight, overflow: css.overflow });
          parent = parent.parentElement;
        }
        return {
          ancestors,
          end: root.getBoundingClientRect().bottom,
          bodyEnd: root.ownerDocument.body.getBoundingClientRect().bottom,
        };
      });
      for (const ancestor of flow.ancestors) {
        expect(ancestor.background).toBe('rgb(255, 255, 255)');
        expect(ancestor.minHeight).toBe('0px');
        expect(ancestor.overflow).toBe('visible');
      }
      expect(Math.abs(flow.bodyEnd - flow.end)).toBeLessThan(2);
      // The book's eight frames, end to end.
      expect(Math.round(flow.end)).toBe(8 * 1056);
    }
    // page.pdf prints the app window, not the frame, so there is no PDF artifact; the screenshot
    // shows the laid-out frame over the page.
    await page.screenshot({ path: info.outputPath(`${key}-print.png`), fullPage: true });
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
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

for (const immediateReceipt of [true, false]) {
  test(`a Draft lands on its exact stored revision with an ${immediateReceipt ? 'immediate' : 'eventual'} receipt, never approving or exporting by digest`, async ({
    page,
  }, info) => {
    const fixture = await openDraftAssetRun(page, immediateReceipt);
    await expect(page.getByTestId('mktg-document-view-page')).toHaveCount(0);
    fixture.finish();
    if (!immediateReceipt) {
      await expect.poll(() => fixture.state.readyWithoutReceiptPolls, { timeout: 20_000 }).toBeGreaterThan(0);
      await expect(page).not.toHaveURL(/\/documents\//);
      await expect(page.getByTestId('mktg-agent-run-status')).toContainText('Writing');
      await expect(page.getByTestId('mktg-document-view-page')).toHaveCount(0);
      await expect(page.getByTestId('mktg-document-view-approve')).toHaveCount(0);
      await expect(page.getByTestId('mktg-framework-view-download-pdf')).toHaveCount(0);
      await expect(page.getByTestId('mktg-framework-view-export-slides')).toHaveCount(0);
      fixture.persist();
    }
    await expect(page).toHaveURL(new RegExp(`/documents/foundation-message/living.*revision=${fixture.revisionId}`), { timeout: 20_000 });
    await expect(page.getByTestId('mktg-document-view-framework')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Draft');
    await expect(page.getByTestId('mktg-document-view-title-card')).not.toContainText('approved by');
    await expect(page.getByTestId('mktg-document-view-title-card')).not.toContainText('the kit still shows');
    await expect(page.getByTestId('mktg-framework-view-approval-required')).toHaveText('Export is available once this version is approved');
    await expect(page.getByTestId('mktg-framework-view-download-pdf')).toHaveCount(0);
    await expect(page.getByTestId('mktg-framework-view-export-slides')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-approve')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open in Documents', exact: true })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('revision')).toBe(fixture.revisionId);
    expect(fixture.state.posts.filter((path) => path === fixture.generatePath)).toEqual([fixture.generatePath]);
    expect(fixture.state.posts.every((path) => path === fixture.generatePath || path === fixture.resultPath)).toBe(true);
    await page.screenshot({ path: info.outputPath(`stored-document-${immediateReceipt}.png`), fullPage: true });
  });
}
