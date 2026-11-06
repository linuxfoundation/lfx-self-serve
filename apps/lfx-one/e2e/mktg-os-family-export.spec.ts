// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import {
  MKTG_FAMILY_EXPORT_API_PATH,
  MKTG_FAMILY_PRINT_BODY_CLASS,
  MKTG_PRINT_DECK_PAGE_NAME,
  MKTG_PRINT_LANDSCAPE_PAGE_SETUP,
} from '../../../packages/shared/src/constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { draftFrameworkAsset } from './helpers/mktg-os-asset-views.helper';
import { DOCUMENT_PROJECT } from './helpers/mktg-os-documents.helper';
import { familyPrintPlan, openFamilyExports } from './helpers/mktg-os-family-export.helper';
import { expectMktgPrintFrame, finishMktgPrintFrame, layoutMktgPrintFrame, PRINT_FRAME_LANDSCAPE, stubMktgPrintFrame } from './helpers/mktg-print.helper';

test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ page }) => suppressCookieBanner(page));

/** The deck-wide page numbers of the stubbed family: mktgPrintFamilyPlan over the stub's own assets, as the assembly plans them (never guessed). */
const PLAN = familyPrintPlan(draftFrameworkAsset().content, DOCUMENT_PROJECT.name);

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
  // The geometry proof measures the frame's document: the one the dialog prints, sized for the landscape deck pages.
  const printFrame = await layoutMktgPrintFrame(page, PRINT_FRAME_LANDSCAPE);
  const printDocument = printFrame.getByTestId('family-export-print-document');
  // The family deck's order: the cover, the framework, the kit, a divider and the pages of each appendix part, the back cover last.
  await expect(printDocument.locator(':scope > *')).toHaveCount(8);
  expect(await printDocument.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => node.tagName.toLowerCase()))).toEqual([
    'lfx-mktg-print-family-cover',
    'lfx-mktg-framework-print',
    'lfx-mktg-brand-kit-print',
    'lfx-mktg-print-divider',
    'lfx-mktg-boilerplates-print',
    'lfx-mktg-print-divider',
    'lfx-mktg-faq-print',
    'lfx-mktg-print-back-cover',
  ]);
  // Only the wrapper travels: the card's controls are not in the frame.
  await expect(printFrame.getByTestId('family-export-actions')).toHaveCount(0);
  // The cover is the deck's: one landscape frame on the dark ground, the eyebrow in capitals, the newest revision's month,
  // the family's name, the brand line, the versions of the parts present and the reversed lockup; no page number.
  const cover = printFrame.getByTestId('family-export-print-cover');
  const coverFrame = cover.getByTestId('mktg-print-page');
  await expect(coverFrame).toBeVisible();
  await expect(coverFrame).toHaveAttribute('data-layout', 'cover');
  await expect(cover.getByTestId('mktg-print-page-title')).toHaveText('Positioning & brand');
  const coverEls = cover.getByTestId('mktg-print-page-el');
  await expect(coverEls).toHaveCount(5);
  await expect(coverEls.nth(0)).toHaveText(/^[A-Z0-9 .&'-]+ · A LINUX FOUNDATION PROJECT$/);
  await expect(coverEls.nth(1)).toHaveText(/^[A-Z][a-z]+ \d{4}$/);
  await expect(coverEls.nth(2)).toHaveText(/ · a Linux Foundation project$/);
  await expect(coverEls.nth(3)).toHaveText('Messaging Framework v1 · Brand Kit V1.0 · Boilerplates v1 · FAQ v1');
  await expect(coverEls.nth(4).locator('img')).toBeVisible();
  await expect(cover.getByTestId('mktg-print-page-footer')).toHaveCount(0);
  const coverColors = await cover
    .getByTestId('mktg-print-page-slide')
    .evaluate((element) => ({ ink: getComputedStyle(element).color, ground: getComputedStyle(element).backgroundColor }));
  expect(coverColors.ground).not.toBe('rgb(255, 255, 255)');
  expect(coverColors.ink).not.toBe(coverColors.ground);
  // The dividers: dark section pages with the part's number and the family in capitals, the title, the count line and the
  // lockup; counted but unnumbered.
  const dividers = printDocument.locator('lfx-mktg-print-divider');
  await expect(dividers.getByTestId('mktg-print-page')).toHaveAttribute('data-layout', 'cover');
  await expect(dividers.getByTestId('mktg-print-page-el')).toHaveText([
    '03 · POSITIONING & BRAND',
    'Boilerplates',
    '4 boilerplates',
    '',
    '04 · POSITIONING & BRAND',
    'Questions and answers',
    '4 questions and answers',
    '',
  ]);
  await expect(dividers.locator('img')).toHaveCount(2);
  await expect(dividers.getByTestId('mktg-print-page-footer')).toHaveCount(0);
  // The boilerplates: one page of two-column bordered cards, each headed "LABEL · N WORDS", the body in the dark.
  const cards = printDocument.locator('lfx-mktg-boilerplates-print');
  await expect(cards.getByTestId('mktg-boilerplates-print-page')).toHaveCount(1);
  await expect(cards.getByTestId('mktg-print-page-head')).toHaveText(['03 Boilerplates', / Positioning & brand$/]);
  await expect(cards.getByTestId('mktg-print-page-title')).toHaveText('Boilerplates');
  await expect(cards.getByTestId('mktg-boilerplates-print-card')).toHaveCount(4);
  await expect(cards.getByTestId('mktg-boilerplates-print-card-head')).toHaveText([
    /^ONE-LINER · \d+ WORDS$/,
    /^25 WORDS · \d+ WORDS$/,
    /^50 WORDS · \d+ WORDS$/,
    /^100 WORDS · \d+ WORDS$/,
  ]);
  await expect(cards.getByTestId('mktg-boilerplates-print-card').first()).toHaveCSS('border-top-style', 'solid');
  await expect(cards.getByTestId('mktg-boilerplates-print-grid')).toHaveCSS('grid-template-columns', /^\d+(\.\d+)?px \d+(\.\d+)?px$/);
  await expect(cards).not.toContainText('Source');
  // The FAQ: one page of a two-column grid, the question bold over its answer, the unanswered one labelled, a real list for a lead-in with items.
  const faq = printDocument.locator('lfx-mktg-faq-print');
  await expect(faq.getByTestId('mktg-faq-print-page')).toHaveCount(1);
  await expect(faq.getByTestId('mktg-print-page-title')).toHaveText('Questions and answers');
  await expect(faq.getByTestId('mktg-faq-print-pair')).toHaveCount(4);
  await expect(faq.getByTestId('mktg-faq-print-pair').first().locator('h3')).toHaveCSS('font-weight', '700');
  await expect(faq).toContainText('Needs an answer');
  await expect(faq.getByTestId('mktg-faq-print-source').first()).toHaveText('Source · Website');
  // A list prints as real items: no paragraph or item opens with a Markdown dash.
  await expect(faq.locator('[data-testid="mktg-faq-print-answer"] ul > li').first()).toBeVisible();
  expect(
    await faq
      .locator('[data-testid="mktg-faq-print-answer"] :is(p, li)')
      .evaluateAll((nodes) => nodes.some((node) => (node.textContent ?? '').trimStart().startsWith('- ')))
  ).toBe(false);
  await expect(faq.getByTestId('mktg-faq-print-grid')).toHaveCSS('grid-template-columns', /^\d+(\.\d+)?px \d+(\.\d+)?px$/);
  // The back cover closes the file: the kit's brand line in capitals on the dark ground, the host and the trademark notice.
  const back = printDocument.getByTestId('family-export-print-back-cover');
  await expect(back.getByTestId('mktg-print-page')).toHaveAttribute('data-layout', 'back');
  await expect(back.getByTestId('mktg-print-page-title')).not.toBeEmpty();
  await expect(back).toContainText('trademarks of the Linux Foundation');
  // The framework inside the family is the deck's landscape framework numbered from the family's plan: its cover at 2
  // (the deck's cover: the title, the tagline, no logo), then its content pages with the deck's numbers in their
  // footers and no footer line; none of the portrait framework's sheets.
  const frameworkPrint = printDocument.getByTestId('mktg-framework-print');
  await expect(frameworkPrint).toHaveAttribute('data-pages', String(PLAN.frameworkPages));
  const frameworkCover = frameworkPrint.getByTestId('framework-print-cover');
  await expect(frameworkCover.getByTestId('mktg-print-page')).toHaveAttribute('data-layout', 'cover');
  await expect(frameworkCover.getByTestId('mktg-print-page-title')).toHaveText('Messaging Framework');
  await expect(frameworkCover.getByTestId('mktg-print-page-subtitle')).toHaveText(draftFrameworkAsset().content.mf.tagline);
  await expect(frameworkCover.locator('img')).toHaveCount(0);
  const frameworkPages = frameworkPrint.getByTestId('framework-print-page');
  await expect(frameworkPages).toHaveCount(PLAN.frameworkPages - 1);
  await expect(frameworkPages.first().getByTestId('mktg-print-page-head').first()).toHaveText('01 Framework');
  await expect(frameworkPages.first().getByTestId('mktg-print-page-footer')).toHaveText(['', String(PLAN.frameworkFirstPage + 1)]);
  await expect(printDocument.locator('lfx-mktg-framework-print lfx-mktg-print-sheet, lfx-mktg-framework-print table')).toHaveCount(0);
  // The kit inside the family is the deck's landscape kit numbered from the family's plan: its cover after the framework,
  // its fourteen content pages (the contents list the family's numbers), no back cover of its own (the family's closes
  // the file).
  const kitPrint = printDocument.getByTestId('mktg-brand-kit-print');
  await expect(kitPrint).toHaveAttribute('data-pages', String(PLAN.kitPages));
  await expect(kitPrint.getByTestId('kit-print-cover')).toHaveCount(1);
  await expect(kitPrint.getByTestId('kit-print-back-cover')).toHaveCount(0);
  const kitPages = kitPrint.getByTestId('kit-print-page');
  await expect(kitPages).toHaveCount(PLAN.kitPages - 1);
  await expect(kitPages.first()).toHaveAttribute('data-page', PLAN.pageNumber(PLAN.kitFirstPage + 1));
  await expect(kitPages.first()).toContainText(`${PLAN.pageNumber(PLAN.kitFirstPage + 2)}   Logo system`);
  await expect(kitPages.nth(1).getByTestId('mktg-print-page-head')).toHaveText(['01 Logo', / Brand Kit$/]);
  await expect(kitPages.last().getByTestId('mktg-print-page-footer').last()).toHaveText(PLAN.pageNumber(PLAN.kitFirstPage + PLAN.kitPages - 1));
  // Every landscape page is one fixed frame holding one 16:9 slide that breaks after itself, numbered deck-wide on the
  // content pages only (the family cover 1, the framework, the kit, the dividers, the cards, the grid, the back cover).
  const landscapePages = printDocument.getByTestId('mktg-print-page');
  await expect(landscapePages).toHaveCount(PLAN.pageCount);
  for (const frame of await landscapePages.all()) {
    await expect(frame).toHaveCSS('position', 'relative');
    await expect(frame).toHaveCSS('overflow', 'hidden');
    await expect(frame).toHaveCSS('break-after', 'page');
    const box = await frame.getByTestId('mktg-print-page-slide').boundingBox();
    if (!box) throw new Error('Missing synthetic landscape slide');
    expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
  }
  const footerLine = / · a Linux Foundation project$/;
  await expect(printDocument.getByTestId('mktg-print-page-footer')).toHaveText([
    ...Array.from({ length: PLAN.frameworkPages - 1 }, (_, i) => ['', String(PLAN.frameworkFirstPage + 1 + i)]).flat(),
    ...Array.from({ length: PLAN.kitPages - 1 }, (_, i) => [footerLine, PLAN.pageNumber(PLAN.kitFirstPage + 1 + i)]).flat(),
    footerLine,
    PLAN.pageNumber(PLAN.boilerplatesFirstPage),
    footerLine,
    PLAN.pageNumber(PLAN.faqFirstPage),
  ]);
  // Nothing leaves its page: every card and every pair sits inside its page's body area.
  for (const pageTestId of ['mktg-boilerplates-print-page', 'mktg-faq-print-page']) {
    const contained = await printDocument
      .getByTestId(pageTestId)
      .first()
      .evaluate((element) => {
        const body = element.querySelector('[data-testid="mktg-print-page-area"]');
        if (!body) return false;
        const area = body.getBoundingClientRect();
        return Array.from(body.querySelectorAll('article')).every((item) => {
          const box = item.getBoundingClientRect();
          return box.left >= area.left - 0.5 && box.top >= area.top - 0.5 && box.right <= area.right + 0.5 && box.bottom <= area.bottom + 0.5;
        });
      });
    expect(contained, `${pageTestId}: every item must remain inside the page's body area`).toBe(true);
  }
  // No screen canvas may bleed through below a short print section.
  await expect(printFrame.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const ancestorBackgrounds = await printDocument.evaluate((element) => {
    const backgrounds: string[] = [];
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) backgrounds.push(getComputedStyle(ancestor).backgroundColor);
    return backgrounds;
  });
  expect(ancestorBackgrounds.every((color) => color === 'rgb(255, 255, 255)')).toBe(true);
  for (const selector of ['lfx-mktg-framework-print', 'lfx-mktg-boilerplates-print', 'lfx-mktg-faq-print']) {
    await expect(printDocument.locator(selector).getByTestId('mktg-print-page-head').first()).toBeVisible();
    await expect(printDocument.locator(selector).getByTestId('mktg-print-page-logo')).toBeVisible();
  }
  // None of the portrait prints' chrome prints: the framework and the kit are their landscape pages (above).
  await expect(printDocument.locator('lfx-mktg-brand-kit-print .kit-chapter, lfx-mktg-brand-kit-print lfx-mktg-print-chapter-header')).toHaveCount(0);
  await expect(printDocument.locator('lfx-mktg-print-sheet, tfoot, [data-testid="mktg-print-sheet-foot"], [data-testid="mktg-print-sheet-head"]')).toHaveCount(
    0
  );
  // The page setup is the deck pages' in both engines: the frame's unnamed rule and the deck's named page, both the
  // landscape setup (margin 0); every page of the family is a deck page.
  expect(await printFrame.locator('head style').last().textContent()).toBe(
    `@page { ${MKTG_PRINT_LANDSCAPE_PAGE_SETUP} }\n@page ${MKTG_PRINT_DECK_PAGE_NAME} { ${MKTG_PRINT_LANDSCAPE_PAGE_SETUP} }`
  );
  await expect(printDocument.locator('lfx-brand-kit-view, .lfx-brand-kit-page, .lfx-framework-print')).toHaveCount(0);
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
