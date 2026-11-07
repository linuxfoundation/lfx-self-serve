// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import {
  MKTG_FAMILY_EXPORT_API_PATH,
  MKTG_FAMILY_PRINT_BODY_CLASS,
  MKTG_PORTRAIT_PAGE_NAME,
  MKTG_PRINT_PAGE_SETUPS,
} from '../../../packages/shared/src/constants';
import { buildBrandKitBookView } from '@lfx-one/shared/utils/brand-kit-book.utils';
import { brandKitPortraitPlan, mktgPortraitSectionLabel } from '@lfx-one/shared/utils/mktg-portrait-plan.utils';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DOCUMENT_PROJECT } from './helpers/mktg-os-documents.helper';
import { expectFamilyBookFrames, openFamilyExports } from './helpers/mktg-os-family-export.helper';
import { expectMktgPrintFrame, finishMktgPrintFrame, layoutMktgPrintFrame, stubMktgPrintFrame } from './helpers/mktg-print.helper';

test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ page }) => suppressCookieBanner(page));

test('export stays on the Family URL and Back returns to Kit, never to an export action', async ({ page }, info) => {
  await openFamilyExports(page, { existing: true });
  await page.getByTestId('mktg-breadcrumb-link-0').click();
  await expect(page.getByTestId('mktg-kit-page')).toBeVisible();
  await page.getByTestId('mktg-kit-family-link-positioning-brand').click();
  await expect(page.getByTestId('family-export-last-link')).toBeVisible();
  const url = page.url();
  const entries = await page.evaluate(() => history.length);
  await page.getByTestId('family-export-slides').getByRole('button').click();
  await page.getByTestId('family-export-update').getByRole('button').click();
  await expect(page.getByTestId('family-export-success')).toBeVisible({ timeout: 15_000 });
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await expect(page.getByTestId('family-export-last-link')).toHaveAttribute('target', '_blank');
  await page.goBack();
  await expect(page.getByTestId('mktg-kit-page')).toBeVisible();
  await page.screenshot({ path: info.outputPath('export-back-to-kit.png'), fullPage: true });
});

test('no earlier export creates a deck, shows progress, then the dated revision-linked last export', async ({ page }, info) => {
  const controls = await openFamilyExports(page, { result: 'pending' });
  const sent = page.waitForRequest((request) => request.url().endsWith('/family/start'));
  await page.getByTestId('family-export-slides').getByRole('button').click();
  expect((await sent).postDataJSON().mode).toBe('create');
  await expect(page.getByTestId('family-export-progress')).toBeVisible();
  await expect(page.getByTestId('family-export-slides').getByRole('button')).toBeDisabled();
  controls.complete();
  await expect(page.getByTestId('family-export-success')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('family-export-last-link')).toHaveAttribute('href', 'https://docs.google.com/presentation/d/synthetic_new_deck_123/edit');
  await expect(page.getByTestId('family-export-last')).toContainText('20 Oct 2026');
  await expect(page.getByTestId('family-export-last')).toContainText('v1');
  await page.screenshot({ path: info.outputPath('created-family-deck.png'), fullPage: true });
});

for (const mode of ['update', 'create'] as const) {
  test(`existing deck offers both choices and honours ${mode}`, async ({ page }, info) => {
    await openFamilyExports(page, { existing: true });
    await expect(page.getByTestId('family-export-last-link')).toHaveAttribute('href', 'https://docs.google.com/presentation/d/synthetic_deck_123/edit');
    await page.getByTestId('family-export-slides').getByRole('button').click();
    await expect(page.getByTestId('family-export-update').getByRole('button')).toBeVisible();
    await expect(page.getByTestId('family-export-create').getByRole('button')).toBeVisible();
    const sent = page.waitForRequest((request) => request.url().endsWith('/family/start'));
    await page.getByTestId(`family-export-${mode}`).getByRole('button').click();
    expect((await sent).postDataJSON().mode).toBe(mode);
    await expect(page.getByTestId('family-export-success')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('family-export-last-link')).toHaveAttribute(
      'href',
      mode === 'update'
        ? 'https://docs.google.com/presentation/d/synthetic_deck_123/edit'
        : 'https://docs.google.com/presentation/d/synthetic_new_deck_123/edit'
    );
    await page.screenshot({ path: info.outputPath(`${mode}-family-deck.png`), fullPage: true });
  });
}

test('shows the stale badge without hiding the last link', async ({ page }, info) => {
  await openFamilyExports(page, { existing: true, stale: true });
  await expect(page.getByTestId('family-export-stale')).toContainText('Out of date');
  await expect(page.getByTestId('family-export-last-link')).toHaveAttribute('target', '_blank');
  await expect(page.getByTestId('family-export-last-link')).toHaveAttribute('rel', 'noopener noreferrer');
  await page
    .context()
    .route('https://docs.google.com/presentation/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Synthetic deck</title>' }));
  const opened = page.waitForEvent('popup');
  await page.getByTestId('family-export-last-link').click();
  const deck = await opened;
  await expect(deck).toHaveURL('https://docs.google.com/presentation/d/synthetic_deck_123/edit');
  await deck.close();
  await page.screenshot({ path: info.outputPath('stale-family-export.png'), fullPage: true });
});

test('empty approved family disables both actions and explains approval', async ({ page }, info) => {
  await openFamilyExports(page, { empty: true });
  await expect(page.getByTestId('family-export-empty')).toHaveText('Available once the framework is approved: PDF and Slides use the approved current.');
  for (const action of ['pdf', 'slides']) {
    const button = page.getByTestId(`family-export-${action}`).getByRole('button');
    await expect(button).toBeDisabled();
    await expect(button).toHaveClass(/p-button-outlined/);
    await button.hover({ force: true });
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  }
  await page.screenshot({ path: info.outputPath('no-approved-family.png'), fullPage: true });
});

test('reader sees disabled actions even when the document-list API denies access', async ({ page }, info) => {
  await openFamilyExports(page, { writer: false });
  await expect(page.getByTestId('family-export-access')).toContainText('write access');
  for (const action of ['pdf', 'slides']) await expect(page.getByTestId(`family-export-${action}`).getByRole('button')).toBeDisabled();
  await page.screenshot({ path: info.outputPath('reader-family-export.png'), fullPage: true });
});

test('failed last lookup blocks Create and exposes retry', async ({ page }, info) => {
  await openFamilyExports(page, { lookupStatus: 500 });
  await expect(page.getByTestId('family-export-lookup-error')).toContainText('no second deck');
  await expect(page.getByTestId('family-export-slides').getByRole('button')).toBeDisabled();
  await page.route(`**${MKTG_FAMILY_EXPORT_API_PATH}/last?*`, (route) =>
    route.fulfill({ json: { last: null, currentMembers: [], skippedMembers: [], stale: false } })
  );
  await page.getByTestId('family-export-check-again').getByRole('button').click();
  await expect(page.getByTestId('family-export-empty')).toBeVisible();
  await page.screenshot({ path: info.outputPath('lookup-recovered.png'), fullPage: true });
});

test('export failure is actionable and does not leave a spinner', async ({ page }, info) => {
  await openFamilyExports(page, { result: 'failed' });
  await page.getByTestId('family-export-slides').getByRole('button').click();
  await expect(page.getByTestId('family-export-error')).toContainText('Try again', { timeout: 15_000 });
  await expect(page.getByTestId('family-export-slides').getByRole('button')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('failed-family-export.png'), fullPage: true });
});

test('last-export lookup starts even while family document listing is held', async ({ page }, info) => {
  const controls = await openFamilyExports(page, { holdList: true });
  await expect(page.getByTestId('mktg-family-loading')).toBeVisible();
  await expect.poll(controls.lookupReads).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('eager-family-lookup.png'), fullPage: true });
});

test('unsupported family shows one line without export buttons or Positioning notes', async ({ page }, info) => {
  await openFamilyExports(page, { familyId: 'website-web' });
  await expect(page.getByTestId('family-export-unsupported')).toContainText('no assets supported by the exporter');
  for (const action of ['pdf', 'slides', 'pdf-note']) await expect(page.getByTestId(`family-export-${action}`)).toHaveCount(0);
  for (const state of ['access', 'loading', 'empty', 'pdf-note', 'skipped']) await expect(page.getByTestId(`family-export-${state}`)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('unsupported-family-export.png'), fullPage: true });
});

test('Download PDF stays disabled behind the checking line until prepared, then the first click prints from the isolated frame', async ({ page }, info) => {
  await stubMktgPrintFrame(page);
  const controls = await openFamilyExports(page, { allAssets: true, holdPrint: true });
  const pdf = page.getByTestId('family-export-pdf').getByRole('button');
  await expect(pdf).toBeDisabled();
  await expect(pdf).toHaveText('Download PDF');
  await expect(page.getByTestId('family-export-slides').getByRole('button')).toBeEnabled();
  await expect(page.getByTestId('family-export-loading')).toHaveText('Checking approved assets and the last export…');
  await expect(page.getByTestId('family-export-actions')).not.toContainText('Preparing PDF');
  await expect(page.getByTestId('lfx-print-frame')).toHaveCount(0);
  controls.releasePrint();
  await expect(page.getByTestId('family-export-loading')).toHaveCount(0);
  await expect(pdf).toBeEnabled();
  await expect(pdf).toHaveText('Download PDF');
  await expect(page.getByTestId('family-export-pdf-ready')).toHaveCount(0);
  await expect(page.getByTestId('lfx-print-frame')).toHaveCount(0);
  // Frame creation remains in the click task. Its own resource wait precedes frame.print().
  const synchronousClass = await pdf.evaluate((button) => {
    if (!(button instanceof HTMLButtonElement)) throw new Error('Missing synthetic PDF button');
    button.click();
    return document.querySelector<HTMLIFrameElement>('[data-testid="lfx-print-frame"]')?.contentDocument?.body.className ?? '';
  });
  expect(synchronousClass).toContain(MKTG_FAMILY_PRINT_BODY_CLASS);
  await expectMktgPrintFrame(page, MKTG_FAMILY_PRINT_BODY_CLASS, '[data-testid="family-export-print-document"]');
  await expect(page.getByTestId('family-export-actions').getByRole('heading')).toHaveText('Export the family');
  await expect(page.getByTestId('family-export-actions')).toContainText('Google Slides: framework, brand kit, boilerplates and FAQ (approved current).');
  // The page keeps its screen presentation: the source document stays hidden and the body unmarked.
  await expect(page.getByTestId('family-export-print-document')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(new RegExp(MKTG_FAMILY_PRINT_BODY_CLASS));
  await expect(page.getByTestId('family-export-pdf-note')).toHaveText('PDF: framework, brand kit, boilerplates and FAQ (approved current).');
  // The geometry proof measures the frame's document: the one the dialog prints.
  const printFrame = await layoutMktgPrintFrame(page);
  const printDocument = printFrame.getByTestId('family-export-print-document');
  // The family prints as one book of the portrait grammar's frames (CSS Paged Media Level 3: `@page { size: 8.5in 11in;
  // margin: 0 }`, one fixed 816×1056 frame per page): the family's own pages, and the framework's and the kit's
  // portrait pages in the family's book.
  const book = printDocument.locator('lfx-mktg-family-print');
  await expect(book).toHaveCount(1);
  await expect(book).toHaveClass(/lfx-mktg-portrait/);
  await expect(printDocument.locator('lfx-mktg-framework-print')).toHaveCount(1);
  await expect(printDocument.locator('lfx-mktg-brand-kit-print')).toHaveCount(1);
  await expect(printDocument.locator('lfx-mktg-boilerplates-print, lfx-mktg-faq-print, tfoot')).toHaveCount(0);
  // No sheet of main's flowing prints anywhere in the book.
  await expect(printDocument.locator('lfx-mktg-print-sheet')).toHaveCount(0);
  // Only the wrapper travels: the card's controls are not in the frame.
  await expect(printFrame.getByTestId('family-export-actions')).toHaveCount(0);
  const frames = await expectFamilyBookFrames(book);
  // Both @page rules, named and unnamed, the same values in every engine; the frame writes them last in its head.
  const setup = MKTG_PRINT_PAGE_SETUPS['mktg-portrait'];
  expect(await printFrame.locator('head style').last().textContent()).toBe(`@page { ${setup} }\n@page ${MKTG_PORTRAIT_PAGE_NAME} { ${setup} }`);
  expect(setup).toBe('size: 8.5in 11in; margin: 0;');
  // The cover: the family's title on the kit's dark, the logo, the four documents' tiles with version and date.
  const cover = frames.byId('cover');
  await expect(cover).toHaveClass(/pp-page--dark/);
  await expect(cover.getByTestId('family-print-cover-title')).toHaveText('Positioning & brand');
  await expect(cover.getByTestId('family-print-cover-title')).toHaveCSS('text-wrap', 'balance');
  await expect(cover.getByTestId('family-print-cover-logo')).toBeVisible();
  await expect(cover.getByTestId('family-print-cover-documents').locator('> *')).toHaveCount(4);
  await expect(cover.getByTestId('family-print-cover-strip')).toContainText('a Linux Foundation project');
  const coverColors = await cover.evaluate((element) => ({ ink: getComputedStyle(element).color, ground: getComputedStyle(element).backgroundColor }));
  expect(coverColors.ground).not.toBe('rgb(255, 255, 255)');
  expect(coverColors.ink).not.toBe(coverColors.ground);
  // The contents page reads the openers' numbers, and the book ends on the page it counts.
  const contents = frames.byId('contents');
  const openerPages = await contents.getByTestId('family-print-contents-opener-page').allTextContents();
  expect(openerPages.map((text) => text.trim())).toEqual(frames.openers.map((opener) => String(opener.page)));
  await expect(contents.getByTestId('family-print-contents-intro')).toContainText(`4 documents, ${frames.total} pages.`);
  await expect(contents.getByTestId('family-print-contents-sources')).toContainText(String(frames.byIdPage('sources')));
  // The openers, in exporter order, each with its version, its approval date alone and its page range.
  await expect(book.locator('[data-testid="mktg-portrait-opener-title"]')).toHaveText(['Messaging framework', 'Brand kit', 'Boilerplates', 'FAQ']);
  const openerMeta = book.locator('[data-testid="mktg-portrait-opener-meta"]').first();
  await expect(openerMeta).toContainText('Version');
  await expect(openerMeta).toContainText('Pages');
  await expect(openerMeta.locator('dd').nth(1)).toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
  // The running head names the chapter left and the family right on every content page; no page is hand-numbered.
  await expect(frames.byId('boilerplates').getByTestId('mktg-portrait-page-doc')).toHaveText(/positioning & brand$/);
  await expect(frames.byId('boilerplates').getByTestId('mktg-portrait-page-section')).toHaveText('03 Boilerplates');
  await expect(frames.byId('boilerplates').getByTestId('mktg-portrait-page-number')).toHaveText(String(frames.byIdPage('boilerplates')).padStart(2, '0'));
  // The framework in the family's book: the pages of its family plan for this fixture (one goal, one ICP), no cover of
  // its own and no band, each under the family's running head, numbered on from its opener, on the kit's look.
  const frameworkPrint = printDocument.locator('lfx-mktg-framework-print');
  const frameworkFrames = frameworkPrint.locator('[data-testid="lfx-mktg-portrait-page"]');
  await expect(frameworkFrames).toHaveCount(frames.frameworkPages);
  expect(await frameworkFrames.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-page-id')))).toEqual([
    'framework',
    'goal-1',
    'say-avoid',
    'icps-1',
    'message-house',
    'key-numbers',
    'sources',
  ]);
  await expect(frameworkFrames.first()).toHaveAttribute('data-page', '4');
  await expect(frameworkFrames.first()).toHaveAttribute('data-section', 'Messaging framework · Framework');
  await expect(frameworkFrames.first().getByTestId('mktg-portrait-page-number')).toHaveText('04');
  await expect(frameworkPrint.getByTestId('mktg-portrait-page-doc')).toHaveText(
    Array(frames.frameworkPages).fill(`${DOCUMENT_PROJECT.name} positioning & brand`)
  );
  await expect(
    frameworkPrint.locator('[data-page-id="cover"], [data-testid="mktg-framework-print-cover"], [data-testid="mktg-portrait-page-band"]')
  ).toHaveCount(0);
  await expect(frameworkPrint.getByTestId('mktg-framework-print-goals')).toBeVisible();
  await expect(frameworkPrint.getByTestId('mktg-framework-print-pillars')).toHaveCount(1);
  await expect(frameworkPrint.locator('[data-testid^="mktg-framework-print-icp-"]')).toHaveCount(1);
  // The family hands the framework its run record, so its Sources & gaps page prints inside the family as it does alone: the
  // intro, the blocks as the fixture's report holds them (nothing read, no source failed, no gap) and the approval card with
  // the version and the approval date the opener prints.
  await expect(frameworkFrames.last()).toHaveAttribute('data-page-id', 'sources');
  await expect(printDocument.getByTestId('mktg-framework-print-sources-intro')).toHaveText(
    'What the framework was built from, what could not be read, and what is still open.'
  );
  await expect(printDocument.getByTestId('mktg-framework-print-sources-read')).toHaveCount(0);
  await expect(printDocument.getByTestId('mktg-framework-print-sources-failed-empty')).toHaveText('No source failed.');
  await expect(printDocument.getByTestId('mktg-framework-print-gaps-empty')).toHaveText('The sources left no gap.');
  await expect(printDocument.getByTestId('mktg-framework-print-approval')).toHaveText(
    'V1.0 · Approved 20 Oct 2026. A later run re-reads the sources and refreshes the LFX figures.'
  );
  // The kit in the family's book: every page of its family plan for this kit (the synthetic kit's record decides the
  // plan: no cover, contents or back cover of its own), in order, numbered on from its opener, under the family's
  // running head, no band; nothing of it flows as a chapter.
  const kitPlan = brandKitPortraitPlan(buildBrandKitBookView(brandKitTestRevision(), 1), { inFamily: true });
  const kitPrint = printDocument.locator('lfx-mktg-brand-kit-print');
  const kitFrames = kitPrint.locator('[data-testid="lfx-mktg-portrait-page"]');
  await expect(kitFrames).toHaveCount(kitPlan.length);
  expect(frames.kitPages).toBe(kitPlan.length);
  expect(await kitFrames.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-page-id')))).toEqual(kitPlan.map((page) => page.id));
  expect(await kitFrames.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-section')))).toEqual(
    kitPlan.map((page) => mktgPortraitSectionLabel(page.section, true, 'Brand kit'))
  );
  await expect(kitFrames.first()).toHaveAttribute('data-page', String(frames.byIdPage('opener-brand-kit') + 1));
  await expect(kitPrint.getByTestId('mktg-portrait-page-doc')).toHaveText(Array(kitPlan.length).fill(`${DOCUMENT_PROJECT.name} positioning & brand`));
  await expect(
    kitPrint.locator('[data-page-id="cover"], [data-page-id="contents"], [data-page-id="back-cover"], [data-testid="mktg-portrait-page-band"]')
  ).toHaveCount(0);
  await expect(kitPrint.locator('.kit-chapter, lfx-mktg-print-chapter-header, .lfx-brand-kit-page')).toHaveCount(0);
  await expect(printDocument.locator('lfx-brand-kit-view, .lfx-brand-kit-page')).toHaveCount(0);
  // The boilerplates as cards, one per length with text; the FAQ's answered questions only.
  await expect(frames.byId('boilerplates').getByTestId('family-print-boilerplate-card')).toHaveCount(4);
  const faq = frames.byId('faq-1');
  await expect(faq.getByTestId('family-print-faq-entry')).toHaveCount(3);
  await expect(faq).not.toContainText('Needs an answer');
  // Built from: each source as a short readable name (the host, never a raw URL); the run's notes never print.
  await expect(frames.byId('boilerplates').getByTestId('family-print-boilerplate-sources')).toContainText('acme-mesh.example');
  await expect(frames.byId('boilerplates').getByTestId('family-print-boilerplate-sources')).not.toContainText('https://');
  await expect(frames.byId('boilerplates').getByTestId('family-print-boilerplate-notes')).toHaveCount(0);
  // The Sources page (the fixture's run left a gap): the four documents' version, approval and data date; the open
  // item under its document's chip; no placeholder, note or bracketed template text anywhere.
  const sources = frames.byId('sources');
  await expect(sources.getByTestId('family-print-sources-row')).toHaveCount(4);
  await expect(sources.getByTestId('family-print-sources-row').first().locator('td').nth(3)).toContainText('figures as of');
  await expect(sources.getByTestId('family-print-sources-open')).toContainText('The launch year is not stated.');
  await expect(book).not.toContainText(/\[[A-Z][a-z]+\]/);
  await expect(book).not.toContainText('SVG supplied');
  // The back cover: the kit's dark, the trademark notice.
  await expect(frames.byId('back-cover')).toHaveClass(/pp-page--dark/);
  await expect(frames.byId('back-cover').getByTestId('mktg-portrait-back-cover-notice')).toContainText('trademarks of the Linux Foundation');
  await page.screenshot({ path: info.outputPath('four-assets-print-document.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await finishMktgPrintFrame(page);
  await page.screenshot({ path: info.outputPath('family-pdf-ready.png'), fullPage: true });
});

test('Export the family reveals and focuses format choices without choosing one or shifting the card', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openFamilyExports(page, { approvedFamily: true });
  const card = page.getByTestId('family-export-actions');
  const pdf = card.getByTestId('family-export-pdf').getByRole('button');
  await expect(pdf).toBeEnabled();
  const before = await card.boundingBox();
  let starts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/family/start')) starts++;
  });
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset['unexpectedPrint'] = 'yes';
    };
  });
  await page.getByTestId('mktg-family-run').getByRole('button', { name: 'Export the family' }).click();
  await expect(card).toHaveClass(/lfx-mktg-export-highlight/);
  await expect(pdf).toBeFocused();
  await expect(card.getByTestId('family-export-format-hint')).toHaveText('Choose a format: Download PDF or Export to Google Slides');
  await expect(card).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(card).toHaveCSS('animation-name', 'none');
  const after = await card.boundingBox();
  expect(after?.height).toBe(before?.height);
  expect(starts).toBe(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-unexpected-print');
  await page.screenshot({ path: info.outputPath('export-format-choices.png'), fullPage: true });
});
