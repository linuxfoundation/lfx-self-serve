// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import {
  BRAND_KIT_PRINT_BODY_CLASS,
  FOUNDATION_MESSAGE_PRINT_BODY_CLASS,
  FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES,
  FRAMEWORK_PORTRAIT_ROOM,
  FRAMEWORK_PORTRAIT_TOPS,
  FRAMEWORK_PORTRAIT_TYPE,
  MKTG_PORTRAIT_FIT,
  MKTG_PORTRAIT_PAGE,
  MKTG_PORTRAIT_PAGE_NUMBER_DIGITS,
  MKTG_PORTRAIT_PAPERS,
  MKTG_PRINT_KIT_READ_NOTES,
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
  printMktgFrameWithChrome,
  stubMktgPrintFrame,
} from './helpers/mktg-print.helper';

import { brandKitLogolessFixture, brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { mktgPortraitAccentOnDark, mktgPortraitAccentText, mktgPortraitPlatePadding } from '@lfx-one/shared/utils/mktg-portrait-print.utils';
import {
  ASSET_PROJECT,
  columnAssetRevisionResponse,
  cssRgb,
  nativeAssetRevisionResponse,
  openAssetDocument,
  openDraftAssetRun,
  openUnapprovedAssetDocument,
  capGoalsFrameworkRevisionResponse,
  OVERFULL_GOAL_TITLES,
  overfullFrameworkRevisionResponse,
  realShapedFrameworkRevisionResponse,
  servedSixFrameworkRevisionResponse,
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
      // Both reads carry the rows: the living document's poll merges the detail's revisions into the view, so a
      // detail still answering the helper's one-revision base would put the v1 row back to Draft mid-test.
      await page.route('**/api/mktg-agents/documents/faq/living?*', (route) => route.fulfill({ json: response }));
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
      await expect(frames.first()).toHaveCSS('break-before', 'page');
      await expect(frames.last()).toHaveCSS('break-after', 'auto');
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
      // The grammar prints the inner pages' numbers padded ("02"…"15"), the cover and back cover unnumbered.
      await expect(print.getByTestId('mktg-portrait-page-number')).toHaveText(
        Array.from({ length: 14 }, (_, index) => String(index + 2).padStart(MKTG_PORTRAIT_PAGE_NUMBER_DIGITS, '0'))
      );
    } else {
      // The framework prints as a portrait book of fixed Letter frames on the portrait grammar, one per plan page, on its
      // own margin-less setup in both engines: nothing flows across a page edge, so no sheet tables, no head or foot groups.
      await expectMktgPortraitPageSetup(frame, print);
      // One named page on the whole print path, the grammar's, set by the frames alone: the root names none, and no element above a frame
      // does (a change of page name forces a break, which is a blank sheet). One break per boundary, owned by the frame that starts the
      // page: `break-before: page` on every frame, `break-after` on none.
      expect(['', 'auto', 'mktg-portrait']).toContain(await print.evaluate((root) => getComputedStyle(root).getPropertyValue('page')));
      expect(
        await frame
          .locator('body *:has(> [data-testid="lfx-mktg-portrait-page"])')
          .evaluateAll((parents) =>
            parents.map((parent) => getComputedStyle(parent).getPropertyValue('page')).filter((name) => name && name !== 'auto' && name !== 'mktg-portrait')
          )
      ).toEqual([]);
      expect(
        await print
          .getByTestId('lfx-mktg-portrait-page')
          .evaluateAll((sections) => sections.map((section) => [getComputedStyle(section).breakBefore, getComputedStyle(section).breakAfter].join(' ')))
      ).toEqual(Array.from({ length: 8 }, () => 'page auto'));
      await expect(print.locator('lfx-mktg-print-sheet, thead, tfoot')).toHaveCount(0);
      await expect(print).toHaveCSS('position', 'static');
      await expect(print).toHaveCSS('display', 'block');
      await expect(print.locator('.h-screen, .min-h-screen, .flex-1')).toHaveCount(0);
      // Every Angular host on the print path is a block: Google Chrome breaks a page at an inline host that wraps a frame
      // carrying a break (one blank page per host), where Playwright's Chromium does not. And the frames are siblings
      // under one parent, so the grammar's `.pp-page { break-before: page; break-after: auto }` rule gives every page boundary its one break.
      const hosts = frame.locator('lfx-mktg-framework-print, lfx-mktg-portrait-page');
      expect(await hosts.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).display))).toEqual(
        Array.from({ length: 9 }, () => 'block')
      );
      expect(await print.getByTestId('lfx-mktg-portrait-page').evaluateAll((sections) => new Set(sections.map((section) => section.parentElement)).size)).toBe(
        1
      );
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
      // The editor's gap under the cover title: 16–24 px, set at 18 (the framework pages' global partial).
      await expect(frame.getByTestId('mktg-framework-print-version')).toHaveCSS('margin-top', '18px');
      await expect(frame.getByTestId('mktg-framework-print-contents-row')).toHaveCount(7);
      await expect(frame.getByTestId('mktg-framework-print-contents-row').first()).toContainText('Framework');
      await expect(frame.getByTestId('mktg-framework-print-contents-row').last()).toContainText('Sources & gaps');
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
      // The matrix's source tag is the fixed vocabulary, kept whole as the mock's: the fact before it wraps, never the tag.
      await expect(print.locator('.fwp-matrix-source').first()).toHaveCSS('white-space', 'nowrap');
      // The goal's page, the profile with the goals × profiles matrix (one profile: the page has room), the house, the numbers.
      await expect(print.getByTestId('mktg-framework-print-goal-1')).toContainText('01');
      const icpRow = print.getByTestId('mktg-framework-print-icp-users');
      await expect(icpRow).toContainText('End users');
      // The board's card: six fields in two rows of three, the proof figures under the channels; an objection without a response
      // prints its question alone (the editor's rule); the kind and goal tags hold one line.
      await expect(icpRow.locator('dt')).toHaveText(['Need', 'Value', 'Lead message', 'Call to action', 'Objection', 'Channels']);
      await expect(icpRow.locator('dd').nth(4)).toHaveText('“Too early?”');
      await expect(icpRow.locator('dd').nth(5).getByTestId('mktg-framework-print-icp-proof')).toHaveCount(1);
      await expect(icpRow.getByTestId('mktg-framework-print-icp-chips')).toHaveCSS('flex-wrap', 'nowrap');
      await expect(print.getByTestId('mktg-framework-print-matrix-row')).toHaveCount(1);
      await expect(print.getByTestId('mktg-framework-print-matrix-dot')).toHaveCount(1);
      await expect(print.getByTestId('mktg-framework-print-pillars')).toContainText('Open');
      await expect(print.getByTestId('mktg-framework-print-numbers')).toContainText('1,200');
      // One number: its tile spans the column (no orphan half-tile); the facts table lists the fixture's one proof point, whole, with no cut line.
      await expect(print.getByTestId('mktg-framework-print-number-tile-0')).toHaveAttribute('data-wide', 'true');
      await expect(print.locator('[data-testid^="mktg-framework-print-number-tile-"]')).toHaveCount(1);
      // The tile's source pill: the goal's proof point states the figure ("1,200 contributors", Website), so the tile carries it.
      await expect(print.getByTestId('mktg-framework-print-number-tile-0').getByTestId('mktg-framework-print-number-source')).toHaveText('Website');
      await expect(print.getByTestId('mktg-framework-print-numbers-table')).toHaveCount(0);
      await expect(print.getByTestId('mktg-framework-print-facts')).toContainText('Figures and their sources');
      await expect(print.locator('[data-testid^="mktg-framework-print-fact-"]')).toHaveCount(1);
      await expect(print.getByTestId('mktg-framework-print-facts-cut')).toHaveCount(0);
      await expect(print.getByTestId('mktg-framework-print-proofs-cut')).toHaveCount(0);
      // Nothing to avoid in this fixture: the page says so rather than printing an empty list.
      await expect(print.getByTestId('mktg-framework-print-avoid')).toHaveCount(0);
      await expect(print.getByTestId('mktg-framework-print-avoid-empty')).toHaveText('Nothing to avoid was stated.');
      // Sources & gaps: the fixture's sidecar carries a report with empty lists and no read date, so the intro prints without a
      // date, no Read block (nothing was read), the two shared empty-state lines print, the approval card names the version and
      // the approval without the gaps clause, and no Notes block exists (the run's notes stay on screen).
      await expect(print.getByTestId('mktg-framework-print-sources-intro')).toHaveText(
        'What the framework was built from, what could not be read, and what is still open.'
      );
      await expect(print.getByTestId('mktg-framework-print-sources-read')).toHaveCount(0);
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

test('the framework print lists every figure past six as a table, continued on a second page, and says how many rows a cut list left off', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  await openAssetDocument(page, 'foundation-message', 200, true, false, overfullFrameworkRevisionResponse());
  await page.getByTestId('mktg-framework-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
  const frame = await layoutMktgPrintFrame(page);
  const print = frame.getByTestId('mktg-framework-print');
  await expect(print).toBeVisible();
  // Eight figures (the record's cap) with long labels: no tiles, a key numbers table under the intro that lists every figure, whole
  // rows to the footer and the rest on `key-numbers-2` (never a figure dropped), the facts table after the last row.
  await expect(print.locator('[data-testid^="mktg-framework-print-number-tile-"]')).toHaveCount(0);
  const numbersPage = print.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id="key-numbers"]');
  const numbersPage2 = print.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id="key-numbers-2"]');
  await expect(numbersPage2).toHaveCount(1);
  await expect(numbersPage.getByTestId('mktg-framework-print-number-row-0')).toContainText('synthetic figure 1');
  await expect(numbersPage2.locator('[data-testid^="mktg-framework-print-number-row-"]').last()).toContainText('synthetic figure 8');
  await expect(print.locator('[data-testid^="mktg-framework-print-number-row-"]')).toHaveCount(8);
  await expect(numbersPage.getByTestId('mktg-framework-print-facts')).toHaveCount(0);
  await expect(numbersPage2.getByTestId('mktg-framework-print-facts')).toContainText('Figures and their sources');
  // The last of the record's 13 frames: cover, framework, goal-1…4, say-avoid, icps-1, icps-2, message-house, key-numbers, key-numbers-2, sources.
  await expect(print.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id="sources"]')).toHaveAttribute('data-page', '13');
  // Four long proof points (the record's cap) on the first goal: tightened, then cut to whole rows, with the muted "+N more" line.
  const goalPage = print.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id="goal-1"]');
  const proofRows = goalPage.getByTestId('mktg-framework-print-proof-row');
  const kept = await proofRows.count();
  expect(kept).toBeGreaterThan(0);
  expect(kept).toBeLessThan(4);
  await expect(goalPage.getByTestId('mktg-framework-print-proofs-cut')).toHaveText(`+${4 - kept} more in LFX One`);
  await expect(goalPage.getByTestId('mktg-framework-print-proofs-cut')).toHaveCSS('color', 'rgb(107, 114, 128)');
  await expect(goalPage.getByTestId('mktg-framework-print-proofs-cut')).toHaveCSS('font-size', '10.5px');
  // Sixty sources read and forty gaps: each list cut to its column with its own line, the counts from the report.
  const read = print.getByTestId('mktg-framework-print-sources-read-row');
  const readKept = await read.count();
  expect(readKept).toBeGreaterThan(0);
  expect(readKept).toBeLessThan(60);
  await expect(print.getByTestId('mktg-framework-print-sources-read-cut')).toHaveText(`+${60 - readKept} more in LFX One`);
  // The failed source in a reader's words: the sign-in-walled recordings page as its host, no scheme, www. or path, the reason after the dash.
  await expect(print.getByTestId('mktg-framework-print-sources-failed-row').first()).toContainText('example.org — ');
  // Never a path in a printed source line (the editor's rule): the Read rows are hosts (the first here, one counted row would gather a
  // host's pages), the failed rows hosts with their reason.
  await expect(read.first()).toHaveText('synthetic-source-1.example.org');
  for (const row of await read.allTextContents()) expect(row).not.toContain('/');
  for (const row of await print.getByTestId('mktg-framework-print-sources-failed-row').allTextContents()) expect(row).not.toContain('/');
  const gaps = print.getByTestId('mktg-framework-print-gaps-row');
  const gapsKept = await gaps.count();
  expect(gapsKept).toBeLessThan(40);
  await expect(print.getByTestId('mktg-framework-print-gaps-cut')).toHaveText(`+${40 - gapsKept} more in LFX One`);
  await expect(print.getByTestId('mktg-framework-print-sources-failed-cut')).toHaveCount(0);
  // Every variable-length block bounded (the design reader's rule): on every frame, every placed block ends at or above the footer's
  // room (1019 in the frame's coordinates) and no block passes the next one's top; the goal pages' titles whole, the lead under them;
  // the say pills and the avoid rows end above the anchors, and the anchors above the crosscut box.
  const frames = print.getByTestId('lfx-mktg-portrait-page');
  const overflow = await frames.evaluateAll((pages) =>
    pages.flatMap((frame) => {
      const frameTop = frame.getBoundingClientRect().top;
      return Array.from(frame.querySelectorAll<HTMLElement>('[style*="top:"]'))
        .map((block) => ({
          page: frame.getAttribute('data-page-id'),
          className: block.className,
          bottom: Math.round(block.getBoundingClientRect().bottom - frameTop),
        }))
        .filter((block) => block.bottom > 1019);
    })
  );
  expect(overflow).toEqual([]);
  // The framework page's matrix ends above the footer rule (1000), its text cells fitted and its proof cells cut before it could.
  const matrixBottom = await print.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id="framework"]').evaluate((frame) => {
    const matrix = frame.querySelector('[data-testid="mktg-framework-print-goals"]')?.getBoundingClientRect();
    return matrix ? Math.round(matrix.bottom - frame.getBoundingClientRect().top) : Number.NaN;
  });
  expect(matrixBottom).toBeLessThanOrEqual(1000);
  const goalTitles = await print.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id^="goal-"]').evaluateAll((pages) =>
    pages.map((frame) => {
      const title = frame.querySelector('.pp-title')?.getBoundingClientRect();
      const lead = frame.querySelector('.fwp-goal-lead')?.getBoundingClientRect();
      return { text: frame.querySelector('.pp-title')?.textContent?.trim(), underLead: !!title && !!lead && title.bottom <= lead.top };
    })
  );
  expect(goalTitles.map((title) => title.underLead)).toEqual([true, true, true, true]);
  expect(goalTitles[3].text).toBe('Goal 4 · Events where the roadmap is decided in the open');
  const sayAvoid = print.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id="say-avoid"]');
  const order = await sayAvoid.evaluate((frame) => {
    const bottom = (selector: string): number => frame.querySelector(selector)?.getBoundingClientRect().bottom ?? Number.NaN;
    const top = (selector: string): number => frame.querySelector(selector)?.getBoundingClientRect().top ?? Number.NaN;
    const anchorsTop = top('[data-testid="mktg-framework-print-anchor"]');
    return {
      sayAboveAnchors: bottom('[data-testid="mktg-framework-print-say"]') <= anchorsTop,
      avoidAboveAnchors: bottom('[data-testid="mktg-framework-print-avoid"]') <= anchorsTop,
      anchorsAboveCrosscut: bottom('[data-testid="mktg-framework-print-anchor"]') <= top('.fwp-crosscut-box'),
    };
  });
  expect(order).toEqual({ sayAboveAnchors: true, avoidAboveAnchors: true, anchorsAboveCrosscut: true });
  // Ten say phrases and five long avoid rows: each list tightened, then cut to what its column holds above the anchors, the cut said under it.
  await expect(sayAvoid.getByTestId('mktg-framework-print-say-row')).toHaveCount(7);
  await expect(sayAvoid.getByTestId('mktg-framework-print-say-cut')).toHaveText('+3 more in LFX One');
  await expect(sayAvoid.getByTestId('mktg-framework-print-avoid-row')).toHaveCount(3);
  await expect(sayAvoid.getByTestId('mktg-framework-print-avoid-cut')).toHaveText('+2 more in LFX One');
  // Every profile card ends at least 4 px above the footer rule (the harness's A4 finding: at a 0.974 scale a card that touched the rule crossed it),
  // and no profile page's cards are set tight (the record's cards fit at the normal measure).
  const icpBottoms = await print.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id^="icps-"]').evaluateAll((pages) =>
    pages.map((frame) => {
      const frameTop = frame.getBoundingClientRect().top;
      // A profile row is the article carrying the profile's testid (`mktg-framework-print-icp-<id>`); its parts carry their own.
      const cards = Array.from(frame.querySelectorAll('article[data-testid^="mktg-framework-print-icp-"]'));
      const footer = frame.querySelector('[data-testid="mktg-portrait-page-foot"]')?.getBoundingClientRect();
      return {
        cards: cards.map((card) => Math.round(card.getBoundingClientRect().bottom - frameTop)),
        footer: footer ? Math.round(footer.top - frameTop) : null,
      };
    })
  );
  expect(icpBottoms.length).toBeGreaterThan(0);
  for (const page of icpBottoms) {
    expect(page.footer).not.toBeNull();
    for (const bottom of page.cards) expect(bottom).toBeLessThanOrEqual((page.footer ?? 0) - 4);
  }
  await expect(print.locator('.fwp-icp-rows--tight')).toHaveCount(0);
  // The message house: Why now and the audiences sit a gap under the measured pillars, not at a fixed top that leaves a band; the two blocks share
  // one top.
  const house = print.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id="message-house"]');
  const houseLayout = await house.evaluate((frame) => {
    const rect = (selector: string): DOMRect | undefined => frame.querySelector(selector)?.getBoundingClientRect();
    const pillars = rect('[data-testid="mktg-framework-print-pillars"]');
    const whyNow = rect('[data-testid="mktg-framework-print-why-now"]');
    const audiences = frame.querySelector('[data-testid="mktg-framework-print-audiences"]')?.parentElement?.getBoundingClientRect();
    return {
      gapUnderPillars: pillars && whyNow ? Math.round(whyNow.top - pillars.bottom) : Number.NaN,
      sameTop: !!whyNow && !!audiences && Math.abs(whyNow.top - audiences.top) < 1,
    };
  });
  expect(houseLayout.gapUnderPillars).toBeGreaterThanOrEqual(28);
  expect(houseLayout.gapUnderPillars).toBeLessThanOrEqual(36);
  expect(houseLayout.sameTop).toBe(true);
  await page.screenshot({ path: info.outputPath('foundation-message-print-overfull.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});

test('Download PDF waits for the project’s Brand Kit: disabled with the reason while the read is open, then three downloads in a row each print the kit’s cover (editor C1)', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  // The kit with the fixture's lockup: its answer is held back until the test releases it, as a slow stored read is.
  const kit = brandKitTestRevision();
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => (release = resolve));
  await openAssetDocument(page, 'foundation-message', 200, true, false, realShapedFrameworkRevisionResponse(), ASSET_PROJECT, kit, { hold });
  const download = page.getByTestId('mktg-framework-view-download-pdf');
  // While the read is open: the button is disabled, its wrapper says why, and no print root (no LF-default book) is on the page.
  await expect(download.getByRole('button')).toBeDisabled();
  await expect(page.locator('span[aria-label]', { has: download })).toHaveAttribute('aria-label', MKTG_PRINT_KIT_READ_NOTES.pending);
  await expect(page.getByTestId('mktg-framework-print')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('framework-pdf-waits-for-kit.png') });
  release();
  await expect(download.getByRole('button')).toBeEnabled();
  // Three consecutive downloads: each one's cover is the kit's (its lockup as a data: SVG, never the LF file; its dark band).
  for (let press = 1; press <= 3; press++) {
    await download.getByRole('button').click();
    await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
    const frame = await layoutMktgPrintFrame(page);
    await expect(frame.getByTestId('mktg-framework-print')).toHaveAttribute('data-brand', 'kit');
    const logo = frame.getByTestId('mktg-framework-print-cover-logo');
    await expect(logo).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await expect(logo).not.toHaveAttribute('src', /logo_lf_white\.svg/);
    const cover = frame.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id="cover"]');
    await expect(cover.getByTestId('mktg-framework-print-cover')).toHaveCSS('background-color', cssRgb(kit.kit.dark));
    // The fixture's three-colour lockup, with no reversed file, sits on the grammar's white plate, padded by half its 40 px
    // height (the kit cover's precedence, editor W3); the band shows it in full colour, never flattened.
    const plate = cover.getByTestId('mktg-portrait-plate');
    await expect(plate).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(plate).toHaveCSS('padding-top', `${mktgPortraitPlatePadding(FRAMEWORK_PORTRAIT_ROOM.coverLogoHeight)}px`);
    await expect(plate.getByTestId('mktg-framework-print-cover-logo')).toHaveCSS('filter', 'none');
    if (press === 3) await page.screenshot({ path: info.outputPath('framework-pdf-kit-cover-third-download.png') });
    await finishMktgPrintFrame(page);
  }
});

test('the cover strip keeps one line under a long project name with the kit’s host: the Linux Foundation segment goes first, nothing wraps (order 41)', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  // The overfull record under the editor's long name, with the kit's host in the strip's right half: at 33584d0ea both halves
  // wrapped to two lines. The strip is now the grammar's rule (`mktgPortraitCoverStrip`): the left half gives up
  // "· a Linux Foundation project" and both halves share the one line; only one word each still too long would wrap it.
  const kit = brandKitTestRevision();
  const project = { ...ASSET_PROJECT, name: 'Cloud Native Computing Foundation (CNCF)' };
  await openAssetDocument(page, 'foundation-message', 200, true, false, overfullFrameworkRevisionResponse(), project, kit);
  await page.getByTestId('mktg-framework-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
  const frame = await layoutMktgPrintFrame(page);
  const strip = frame.getByTestId('mktg-framework-print-cover-strip');
  await expect(strip.locator('span')).toHaveText([project.name, /^one\.example\.org · V\d+\.0 · /]);
  await expect(strip).not.toHaveClass(/pp-cover-strip--wrapped/);
  const lines = await strip.evaluate((block) => {
    const line = parseFloat(getComputedStyle(block).fontSize);
    return Array.from(block.querySelectorAll('span')).map((span) => Math.round(span.getBoundingClientRect().height / line));
  });
  expect(lines).toEqual([1, 1]);
  await expect(strip).toHaveCSS('top', `${FRAMEWORK_PORTRAIT_TOPS.coverStrip}px`);
  await page.screenshot({ path: info.outputPath('framework-pdf-cover-strip-long-name.png') });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});

test('a failed Brand Kit read never prints the LF look: Download PDF stays disabled and says so, with no print root on the page', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  await openAssetDocument(page, 'foundation-message', 200, true, false, realShapedFrameworkRevisionResponse(), ASSET_PROJECT, brandKitTestRevision(), {
    status: 500,
  });
  const download = page.getByTestId('mktg-framework-view-download-pdf');
  await expect(download.getByRole('button')).toBeDisabled();
  await expect(page.locator('span[aria-label]', { has: download })).toHaveAttribute('aria-label', MKTG_PRINT_KIT_READ_NOTES.failed);
  await expect(page.getByTestId('mktg-framework-print')).toHaveCount(0);
  // The rest of the page is the framework's: the failed brand read stops the PDF alone.
  await expect(page.getByTestId('mktg-framework-view')).toBeVisible();
  await page.screenshot({ path: info.outputPath('framework-pdf-kit-read-failed.png') });
});

test('the framework print set in the project’s kit: accent text darkened to read on the page, the cover logo skipped on a logo-less kit, the tiles’ figures on one line', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  // The grammar's logo-less kit, its accent the coral the editor measured at 2.76:1 as text on white.
  const kit = brandKitLogolessFixture();
  const accent = '#FF702D';
  kit.kit.accent = accent;
  await openAssetDocument(page, 'foundation-message', 200, true, false, realShapedFrameworkRevisionResponse(), ASSET_PROJECT, kit);
  await page.getByTestId('mktg-framework-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
  const frame = await layoutMktgPrintFrame(page);
  const print = frame.getByTestId('mktg-framework-print');
  await expect(print).toHaveAttribute('data-brand', 'kit');
  // The logo-less record plans the AAIF record's twelve frames (four goals, four profiles two a page, four figures): the kit changes no page.
  await expect(print.getByTestId('lfx-mktg-portrait-page')).toHaveCount(12);
  // No drawable artwork: the cover keeps its band, tagline and title, and prints no logo block (K's gating rule through mktgPrintBrand).
  await expect(print.getByTestId('mktg-framework-print-cover-logo')).toHaveCount(0);
  await expect(print.getByTestId('mktg-framework-print-cover')).toHaveCSS('background-color', cssRgb(kit.kit.dark));
  expect(await print.getByTestId('mktg-framework-print-cover').boundingBox()).toMatchObject({ x: 0, y: 0, width: 816, height: 420 });
  // Accent TEXT on the page white reads through the grammar's darkened text accent (--pp-accent-text): the goal numerals and the anchor numbers;
  // accent TEXT over a dark ground (the key message bar's label, the cover's eyebrow) through --pp-accent-on-dark: the accent where it reads
  // there at AA, else the ink on the dark — on this kit's mid-gray the coral fails, so both print in the ink; the accent itself stays on fills.
  const textAccent = cssRgb(mktgPortraitAccentText(accent));
  expect(textAccent).not.toBe(cssRgb(accent));
  await expect(print.locator('.fwp-goal-number').first()).toHaveCSS('color', textAccent);
  await expect(print.locator('.fwp-anchor-number').first()).toHaveCSS('color', textAccent);
  const onDark = await print
    .locator('[data-testid="lfx-mktg-portrait-page"]')
    .first()
    .evaluate((frame) => ({
      accentOnDark: getComputedStyle(frame).getPropertyValue('--pp-accent-on-dark').trim(),
      ink: getComputedStyle(frame).getPropertyValue('--pp-on-dark').trim(),
    }));
  expect(onDark.accentOnDark).toBe(mktgPortraitAccentOnDark({ accent, dark: kit.kit.dark, onDark: onDark.ink }));
  expect(onDark.accentOnDark).not.toBe(accent);
  await expect(print.locator('.fwp-goal-key-label').first()).toHaveCSS('color', cssRgb(onDark.accentOnDark));
  await expect(print.getByTestId('mktg-framework-print-tagline')).toHaveCSS('color', cssRgb(onDark.accentOnDark));
  await expect(print.locator('.fwp-number-tile-lead')).toHaveCSS('border-top-color', cssRgb(accent));
  // Four figures in two rows of two: the lead tile's accent bar does not push its figure below its neighbor's.
  const figureTops = await print
    .locator('[data-testid^="mktg-framework-print-number-tile-"] .fwp-number')
    .evaluateAll((figures) => figures.map((figure) => Math.round(figure.getBoundingClientRect().top)));
  expect(figureTops).toHaveLength(4);
  expect(figureTops[0]).toBe(figureTops[1]);
  // Each figure's box ends inside its tile's (the fit model's measure against the tile's inner width holds in real layout).
  const overflowing = await print.locator('[data-testid^="mktg-framework-print-number-tile-"]').evaluateAll(
    (tiles) =>
      tiles.filter((tile) => {
        const figure = tile.querySelector('.fwp-number');
        return !!figure && figure.getBoundingClientRect().right > tile.getBoundingClientRect().right + 0.5;
      }).length
  );
  expect(overflowing).toBe(0);
  await page.screenshot({ path: info.outputPath('foundation-message-print-kit.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});

test('a framework at the goals’ cap: the matrix’s eight columns fit their text, each proof cell keeping its first proof over the note, ending above the footer', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  await openAssetDocument(page, 'foundation-message', 200, true, false, capGoalsFrameworkRevisionResponse());
  await page.getByTestId('mktg-framework-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
  const frame = await layoutMktgPrintFrame(page);
  const print = frame.getByTestId('mktg-framework-print');
  // Eight goals: cover, framework, goal-1…8, say-avoid, the four profiles two a page, the house, the numbers, the sources.
  await expect(print.getByTestId('lfx-mktg-portrait-page')).toHaveCount(16);
  // The cover lists all fifteen pages after it, one row each, and the list ends above the cover strip (the design reader's list rule
  // bounds it: tightened past nine pairs (eighteen rows), the runs collapsed to ranges past twelve pairs (twenty-four); fifteen rows need neither).
  const contents = print.getByTestId('mktg-framework-print-contents');
  await expect(contents.getByTestId('mktg-framework-print-contents-row')).toHaveCount(15);
  await expect(contents.getByTestId('mktg-framework-print-contents-row').nth(1)).toContainText('03 Goal 1 · Goal 1 title');
  await expect(contents.getByTestId('mktg-framework-print-contents-row').nth(8)).toContainText('10 Goal 8 · Goal 8 title');
  const contentsFit = await contents.evaluate((list) => {
    const frame = list.closest('[data-testid="lfx-mktg-portrait-page"]') as HTMLElement;
    const strip = frame.querySelector('[data-testid="mktg-framework-print-cover-strip"]') as HTMLElement;
    return { aboveStrip: list.getBoundingClientRect().bottom <= strip.getBoundingClientRect().top, tight: list.classList.contains('fwp-contents--tight') };
  });
  expect(contentsFit).toEqual({ aboveStrip: true, tight: false });
  const framework = print.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id="framework"]');
  const matrix = framework.getByTestId('mktg-framework-print-goals');
  await expect(matrix.getByTestId('mktg-framework-print-matrix-vp')).toHaveCount(8);
  const layout = await framework.evaluate((frame) => {
    const top = frame.getBoundingClientRect().top;
    const bottom = (selector: string): number => Math.round((frame.querySelector(selector)?.getBoundingClientRect().bottom ?? Number.NaN) - top);
    const sizes = (selector: string): number[] =>
      Array.from(frame.querySelectorAll<HTMLElement>(selector)).map((cell) => parseFloat(getComputedStyle(cell).fontSize));
    return {
      matrix: bottom('[data-testid="mktg-framework-print-goals"]'),
      vp: sizes('[data-testid="mktg-framework-print-matrix-vp"]'),
      key: sizes('.fwp-matrix-key'),
      bite: sizes('.fwp-matrix-bite'),
    };
  });
  expect(layout.matrix).toBeLessThanOrEqual(1000);
  // Short titles at eight goals stay one strip of eight; no title box reaches its neighbor's, none overflows its column.
  await expect(matrix.getByTestId('mktg-framework-print-goals-band-0')).toHaveCount(1);
  await expect(matrix.getByTestId('mktg-framework-print-goals-band-1')).toHaveCount(0);
  expect(await matrix.evaluate(matrixTitleOverlaps)).toEqual({ overlapping: 0, overflowing: 0, titles: 8 });
  // A strip prints every row (the band rules of editor W1 never touch it): the four labels, no row note.
  await expect(matrix.getByTestId('mktg-framework-print-goals-label')).toHaveText(['Value proposition', 'Key message', 'Proof', 'Sound bite']);
  await expect(matrix.getByTestId('mktg-framework-print-matrix-row-note')).toHaveCount(0);
  // The cells set smaller than their type (11 / 11 / 12.5 px), never under the fit model's floor: minScale of the type, in
  // half pixels (`mktgPortraitFitBlock`; at this record the value and key cells sit on the floor, 7.5 px).
  const floor = (size: number): number => Math.floor(size * MKTG_PORTRAIT_FIT.minScale * 2) / 2;
  for (const size of layout.vp) expect(size).toBeLessThan(11);
  for (const size of [...layout.vp, ...layout.key]) expect(size).toBeGreaterThanOrEqual(floor(11));
  for (const size of layout.bite) expect(size).toBeGreaterThanOrEqual(floor(12.5));
  // Every proof cell keeps its first proof (editor F3: never only the note) and says what it cut; the count is the record's (four a goal).
  const cells = matrix.getByTestId('mktg-framework-print-matrix-proof-cell');
  await expect(cells).toHaveCount(8);
  for (const cell of await cells.all()) await expect(cell.getByTestId('mktg-framework-print-matrix-proof')).toHaveCount(1);
  const notes = matrix.getByTestId('mktg-framework-print-matrix-proofs-cut');
  const noteCount = await notes.count();
  expect(noteCount).toBeGreaterThan(0);
  for (const note of await notes.all()) await expect(note).toHaveText(/^\+[1-3] more in LFX One$/);
  // Eight figures print as the table, each with its thousands separators (the editor's rule); the fixture's bare "2000" is in the year range
  // and prints as stored.
  await expect(page.getByTestId('mktg-framework-print-numbers-table').getByTestId('mktg-framework-print-number-figure')).toHaveText([
    '1,000',
    '2000',
    '3,000',
    '4,000',
    '5,000',
    '6,000',
    '7,000',
    '8,000',
  ]);
  await page.screenshot({ path: info.outputPath('foundation-message-print-cap-goals.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});

/** In the matrix: head titles whose boxes overlap a neighbor's, or whose text overflows its own box (a word wider than the column). */
function matrixTitleOverlaps(matrix: Element): { overlapping: number; overflowing: number; titles: number } {
  const titles = Array.from(matrix.querySelectorAll<HTMLElement>('[data-testid="mktg-framework-print-matrix-title"]'));
  const boxes = titles.map((title) => title.getBoundingClientRect());
  let overlapping = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlapping++;
    }
  }
  const overflowing = titles.filter((title) => title.scrollWidth > title.clientWidth + 0.5).length;
  return { overlapping, overflowing, titles: titles.length };
}

test('eight goals with the overfull record’s titles: the matrix prints as two bands of four, every title inside its column, none overlapping, above the footer (editor C2b)', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  await openAssetDocument(page, 'foundation-message', 200, true, false, capGoalsFrameworkRevisionResponse(OVERFULL_GOAL_TITLES));
  await page.getByTestId('mktg-framework-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
  const frame = await layoutMktgPrintFrame(page);
  const framework = frame.getByTestId('mktg-framework-print').locator('[data-page-id="framework"]');
  const matrix = framework.getByTestId('mktg-framework-print-goals');
  // Two bands of the board's four columns, the eight goals in order across them, every title whole at one size.
  await expect(matrix.getByTestId('mktg-framework-print-goals-band-0').getByTestId('mktg-framework-print-matrix-vp')).toHaveCount(4);
  await expect(matrix.getByTestId('mktg-framework-print-goals-band-1').getByTestId('mktg-framework-print-matrix-vp')).toHaveCount(4);
  await expect(matrix.getByTestId('mktg-framework-print-goals-band-2')).toHaveCount(0);
  await expect(matrix.getByTestId('mktg-framework-print-matrix-title')).toHaveText(OVERFULL_GOAL_TITLES);
  const titleSizes = await matrix
    .getByTestId('mktg-framework-print-matrix-title')
    .evaluateAll((titles) => titles.map((title) => getComputedStyle(title).fontSize));
  expect(new Set(titleSizes).size).toBe(1);
  expect(parseFloat(titleSizes[0])).toBeGreaterThanOrEqual(FRAMEWORK_PORTRAIT_ROOM.matrixTitleMin);
  // No title box reaches its neighbor's and none overflows its column (the harness's gate-4 overlap at 2b5f1a3e3).
  expect(await matrix.evaluate(matrixTitleOverlaps)).toEqual({ overlapping: 0, overflowing: 0, titles: 8 });
  // Every proof cell keeps a proof above its note (F3), and the matrix ends above the footer rule.
  for (const band of [0, 1]) {
    const cells = matrix.getByTestId(`mktg-framework-print-goals-band-${band}`).getByTestId('mktg-framework-print-matrix-proof-cell');
    await expect(cells).toHaveCount(4);
    for (const cell of await cells.all()) await expect(cell.getByTestId('mktg-framework-print-matrix-proof')).not.toHaveCount(0);
  }
  // The band rules (editor W1, W4) on this shape: the bands cannot hold the sound bites whole, so that row is dropped from every
  // band and said once under the last, above the crosscut; the value row stays; the value and key cells are clamped to two lines
  // at their 11 px type, never set smaller; and each band's proofs print at one size, never under the tight type (10.5 px).
  for (const band of [0, 1]) {
    await expect(matrix.getByTestId(`mktg-framework-print-goals-band-${band}`).getByTestId('mktg-framework-print-goals-label')).toHaveText([
      'Value proposition',
      'Key message',
      'Proof',
    ]);
  }
  await expect(matrix.getByTestId('mktg-framework-print-matrix-bite')).toHaveCount(0);
  await expect(matrix.getByTestId('mktg-framework-print-matrix-row-note')).toHaveText([FRAMEWORK_PORTRAIT_MATRIX_BAND_NOTES.bites]);
  const bandCells = await matrix.evaluate((block) => {
    const measure = (cell: Element): { size: number; lines: number } => {
      const style = getComputedStyle(cell);
      return { size: parseFloat(style.fontSize), lines: Math.round(cell.getBoundingClientRect().height / parseFloat(style.lineHeight)) };
    };
    const text = Array.from(block.querySelectorAll('[data-testid="mktg-framework-print-matrix-vp"], .fwp-matrix-key')).map(measure);
    const proofs = [0, 1].map((band) =>
      Array.from(block.querySelectorAll(`[data-testid="mktg-framework-print-goals-band-${band}"] [data-testid="mktg-framework-print-matrix-proof"]`)).map(
        (proof) => parseFloat(getComputedStyle(proof).fontSize)
      )
    );
    return { text, proofs };
  });
  expect(bandCells.text).toHaveLength(16);
  for (const cell of bandCells.text) {
    expect(cell.size).toBe(11);
    expect(cell.lines).toBeLessThanOrEqual(FRAMEWORK_PORTRAIT_ROOM.matrixBandLines);
  }
  for (const sizes of bandCells.proofs) {
    expect(sizes.length).toBeGreaterThan(0);
    expect(new Set(sizes).size).toBe(1);
    expect(sizes[0]).toBeGreaterThanOrEqual(FRAMEWORK_PORTRAIT_TYPE.matrixProofTight.size);
  }
  const matrixBottom = await matrix.evaluate((block) => {
    const frameTop = (block.closest('[data-page-id]') as HTMLElement).getBoundingClientRect().top;
    return Math.round(block.getBoundingClientRect().bottom - frameTop);
  });
  expect(matrixBottom).toBeLessThanOrEqual(1000);
  await page.screenshot({ path: info.outputPath('foundation-message-print-cap-goals-bands.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});

test('a goal served by six profiles: four cards, the note for the other two, the block ending above the footer', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  await openAssetDocument(page, 'foundation-message', 200, true, false, servedSixFrameworkRevisionResponse());
  await page.getByTestId('mktg-framework-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
  const frame = await layoutMktgPrintFrame(page);
  const goalPage = frame.getByTestId('mktg-framework-print').locator('[data-page-id="goal-1"]');
  // The row holds the board's four cards; the two it does not hold are counted in the note under it.
  await expect(goalPage.getByTestId('mktg-framework-print-served-card')).toHaveCount(4);
  await expect(goalPage.getByTestId('mktg-framework-print-served-cut')).toHaveText('+2 more in LFX One');
  // The cards' long lines are fitted into the room the note leaves: the whole block (label, cards, note) ends above the footer rule (1000).
  const servedBottom = await goalPage.evaluate((page) => {
    const block = page.querySelector('[data-testid="mktg-framework-print-served"]') as HTMLElement;
    return block.getBoundingClientRect().bottom - page.getBoundingClientRect().top;
  });
  expect(servedBottom).toBeLessThanOrEqual(1000);
  await page.screenshot({ path: info.outputPath('foundation-message-print-served-six.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});

test('the profile cards’ fields start at one x on every profile page: the name column takes the book’s one width, a lone card too', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  // The overfull record's three profiles: one carries two goal tags (its column grows past the board's 190), the others one; two cards on the
  // first profile page, the third alone on the second.
  await openAssetDocument(page, 'foundation-message', 200, true, false, overfullFrameworkRevisionResponse());
  await page.getByTestId('mktg-framework-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
  const frame = await layoutMktgPrintFrame(page);
  const print = frame.getByTestId('mktg-framework-print');
  const columns = await print.locator('[data-testid="lfx-mktg-portrait-page"][data-page-id^="icps-"]').evaluateAll((pages) =>
    pages.map((frame) => {
      const left = frame.getBoundingClientRect().left;
      return Array.from(frame.querySelectorAll('[data-testid="mktg-framework-print-icp-who"]')).map((who) => ({
        who: Math.round(who.getBoundingClientRect().left - left),
        fields: Math.round(
          (who.parentElement?.querySelector('[data-testid="mktg-framework-print-icp-fields"]')?.getBoundingClientRect().left ?? Number.NaN) - left
        ),
        tags: who.querySelectorAll('[data-testid="mktg-framework-print-icp-chip"]').length,
      }));
    })
  );
  expect(columns.map((page) => page.length)).toEqual([2, 1]);
  const cards = columns.flat();
  // The tag counts differ (the first card's column is the one that grew), yet every card's name column and fields grid start at one x.
  expect(new Set(cards.map((card) => card.tags)).size).toBeGreaterThan(1);
  expect(cards.map((card) => card.who)).toEqual(cards.map(() => MKTG_PORTRAIT_PAGE.margin));
  expect(new Set(cards.map((card) => card.fields)).size).toBe(1);
  expect(cards[0].fields).toBeGreaterThan(MKTG_PORTRAIT_PAGE.margin + 190);
  await page.screenshot({ path: info.outputPath('foundation-message-print-icp-columns.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});

test('the sources page’s Read, Could not be read and Gaps lists carry the design’s bullets, a disc at a 16 px indent, the lines indented with them', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubMktgPrintFrame(page);
  await openAssetDocument(page, 'foundation-message', 200, true, false, overfullFrameworkRevisionResponse());
  await page.getByTestId('mktg-framework-view-download-pdf').getByRole('button').click();
  await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
  const frame = await layoutMktgPrintFrame(page);
  const print = frame.getByTestId('mktg-framework-print');
  for (const testId of ['mktg-framework-print-sources-read', 'mktg-framework-print-sources-failed', 'mktg-framework-print-gaps']) {
    const list = print.getByTestId(testId);
    await expect(list).toHaveCSS('list-style-type', 'disc');
    await expect(list).toHaveCSS('padding-left', '16px');
    await expect(list.locator('li').first()).toHaveCSS('display', 'list-item');
  }
  // The rows start 16 px in from their column's left edge, the bullet in the indent; the heading above stays flush.
  const indent = await print.getByTestId('mktg-framework-print-sources-read').evaluate((list) => {
    const column = list.parentElement as HTMLElement;
    const row = list.querySelector('li') as HTMLElement;
    return Math.round(row.getBoundingClientRect().left - column.getBoundingClientRect().left);
  });
  expect(indent).toBe(16);
  await page.screenshot({ path: info.outputPath('foundation-message-print-sources-bullets.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
});

// The synthetic approved record plans eight frames (one goal, one profile); the overfull one thirteen (four goals, the profiles two a page, the
// key numbers continued). The twelve of the AAIF record are QA's walk of the served build.
for (const [name, response, planned] of [
  ['the approved framework', columnAssetRevisionResponse('foundation-message'), 8],
  ['an overfull framework', overfullFrameworkRevisionResponse(), 13],
] as const) {
  test(`Google Chrome saves ${name} as exactly its ${planned} planned frames, none blank, under each dialog default`, async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'The proof is the Chrome engine; one run of it is enough');
    await page.setViewportSize({ width: 1280, height: 1000 });
    await stubMktgPrintFrame(page);
    await openAssetDocument(page, 'foundation-message', 200, true, false, response);
    await page.getByTestId('mktg-framework-view-download-pdf').getByRole('button').click();
    await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, 'lfx-mktg-framework-print');
    const frame = await layoutMktgPrintFrame(page);
    await expect(frame.getByTestId('mktg-framework-print').getByTestId('lfx-mktg-portrait-page')).toHaveCount(planned);
    // Google Chrome's own Page.printToPDF on the frame document (the editor's engine: the bundled Chromium does not reproduce the blank sheet an
    // inline host cost in Chrome 156), headers on and off, background on and off, Letter and A4: the paper is the page box, the
    // planned count, no blank page, no browser header or footer on the sheet.
    const prints = await printMktgFrameWithChrome(frame);
    test.skip(prints.length === 0, 'Google Chrome is not installed here; the bundled Chromium does not reproduce the blank sheet');
    expect(prints).toHaveLength(8);
    for (const print of prints) {
      const label = `${print.paper} headers ${print.headers} background ${print.background}`;
      // The paper is the page box (the grammar's `size: auto`), never a Letter box scaled onto A4.
      const paper = MKTG_PORTRAIT_PAPERS[print.paper === 'A4' ? 'a4' : 'letter'];
      expect(print.box.width, label).toBeCloseTo(paper.width, 0);
      expect(print.box.height, label).toBeCloseTo(paper.height, 0);
      expect(print.pages, label).toBe(planned);
      expect(print.blank, label).toEqual([]);
      // The browser's header and footer never reach the sheet: a page's text with them on is its text with them off.
      const off = prints.find((other) => other.paper === print.paper && other.background === print.background && !other.headers);
      expect(print.text, label).toEqual(off?.text);
    }
    await page.emulateMedia({ media: 'screen' });
    await finishMktgPrintFrame(page);
  });
}
