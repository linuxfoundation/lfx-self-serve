// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { MKTG_FAMILY_EXPORT_API_PATH, MKTG_FAMILY_PRINT_BODY_CLASS } from '../../../packages/shared/src/constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { openFamilyExports } from './helpers/mktg-os-family-export.helper';
import {
  expectMktgPrintCover,
  expectMktgPrintFrame,
  expectMktgPortraitPageSetup,
  finishMktgPrintFrame,
  layoutMktgPrintFrame,
  mktgPrintComputedPx,
  stubMktgPrintFrame,
} from './helpers/mktg-print.helper';

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
  for (const selector of ['lfx-mktg-framework-print', 'lfx-mktg-brand-kit-print', 'lfx-mktg-boilerplates-print', 'lfx-mktg-faq-print']) {
    await expect(printDocument.locator(selector)).toHaveCount(1);
  }
  await expect(printFrame.getByTestId('family-export-print-contents').locator('dd')).toHaveText(['Messaging framework', 'Brand kit', 'Boilerplates', 'FAQ']);
  await expect(printFrame.getByTestId('mktg-boilerplates-print-length')).toHaveCount(4);
  await expect(printFrame.getByTestId('mktg-faq-print')).toContainText('Needs an answer');
  // Only the wrapper travels: the card's controls are not in the frame.
  await expect(printFrame.getByTestId('family-export-actions')).toHaveCount(0);
  const cover = printFrame.getByTestId('family-export-print-cover');
  await expectMktgPrintCover(cover);
  // The cover's 0.6in at the sides is its own: with the kit's portrait frames in the family the page has no margin in
  // either engine.
  await expect(cover).toHaveCSS('margin-left', '57.6px');
  await expect(printFrame.getByTestId('family-export-print-title')).toHaveText('Positioning & brand');
  await expect(printFrame.getByTestId('family-export-print-title')).toHaveCSS('text-wrap', 'balance');
  await expect(printFrame.getByTestId('family-export-print-logo')).toBeVisible();
  const coverColors = await cover.evaluate((element) => ({ ink: getComputedStyle(element).color, ground: getComputedStyle(element).backgroundColor }));
  expect(coverColors.ground).toBe('rgb(255, 255, 255)');
  expect(coverColors.ink).not.toBe(coverColors.ground);
  // No screen canvas may bleed through below a short print section.
  await expect(printFrame.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const ancestorBackgrounds = await printDocument.evaluate((element) => {
    const backgrounds: string[] = [];
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) backgrounds.push(getComputedStyle(ancestor).backgroundColor);
    return backgrounds;
  });
  expect(ancestorBackgrounds.every((color) => color === 'rgb(255, 255, 255)')).toBe(true);
  await expect(printFrame.getByTestId('family-export-print-contents').locator('dt')).toHaveText(['01', '02', '03', '04']);
  await expect(printDocument.locator('lfx-mktg-framework-print h2 > span')).toHaveText(['01.1', '01.2']);
  await expect(printDocument.getByTestId('mktg-framework-print-goals')).toBeVisible();
  await expect(printDocument.getByTestId('mktg-framework-print-pillars')).toHaveCount(0);
  await expect(printDocument.locator('[data-testid^="mktg-framework-print-icp-"]')).toHaveCount(0);
  await expect(printDocument.locator('lfx-mktg-boilerplates-print h2 > span')).toHaveText('03');
  await expect(printDocument.locator('lfx-mktg-faq-print h2 > span')).toHaveText('04');
  for (const selector of ['lfx-mktg-boilerplates-print', 'lfx-mktg-faq-print']) {
    await expect(printDocument.locator(selector).getByTestId('mktg-print-running-head')).toBeVisible();
    await expect(printDocument.locator(selector).getByTestId('mktg-print-running-head').locator('img')).toBeVisible();
  }
  await expect(printFrame.getByTestId('mktg-framework-print-cover')).toBeHidden();
  // The cover's whole sheet goes with it: its head and foot room alone would print as a blank page.
  await expect(printDocument.locator('lfx-mktg-print-sheet:has([data-testid="mktg-framework-print-cover"])')).toBeHidden();
  // The kit is thirteen portrait frames inside the family (no cover, contents or back cover; no symbol page: the
  // synthetic kit has no symbol), one frame one sheet; nothing of it flows. Its frames are numbered from 1 until the
  // family passes its own book (the family lane's fold-in gives the kit its first page number).
  const kitPrint = printDocument.locator('lfx-mktg-brand-kit-print');
  await expect(kitPrint.locator('[data-testid="lfx-mktg-portrait-page"]')).toHaveCount(13);
  await expect(kitPrint.locator('.kit-chapter, lfx-mktg-print-chapter-header, .lfx-brand-kit-page')).toHaveCount(0);
  await expect(kitPrint.locator('[data-testid="lfx-mktg-portrait-page"]').first()).toHaveAttribute('data-page-id', 'logo-system');
  await expect(kitPrint.locator('[data-testid="lfx-mktg-portrait-page"]').last()).toHaveAttribute('data-page-id', 'sources');
  await expect(kitPrint.getByTestId('mktg-portrait-page-doc').first()).toContainText('positioning & brand');
  // The page's room is in the document, not the @page margin (none, so no browser header or footer): the other sections
  // print in sheets that repeat a head and pad their last row, one row per block — no footer group anywhere, for which
  // Chromium prints an empty page per table: the family cover 1; the framework 1 + 5 + 3 (its cover sheet is in the DOM,
  // hidden above, and counted here); the boilerplates 4 lengths; the FAQ its header + 4 pairs. toHaveCount counts hidden
  // elements: 6 sheets, 5 shown.
  await expect(printDocument.locator('tfoot, [data-testid="mktg-print-sheet-foot"]')).toHaveCount(0);
  await expect(printDocument.getByTestId('mktg-print-sheet-head')).toHaveCount(6);
  await expect(printDocument.locator('lfx-mktg-print-sheet')).toHaveCount(6);
  await expect(printDocument.locator('lfx-mktg-print-sheet').locator('visible=true')).toHaveCount(5);
  await expect(printDocument.locator('lfx-mktg-print-sheet-row')).toHaveCount(1 + 9 + 4 + 5);
  // The page setup: the kit's portrait frames make the family a document of frames, US Letter with no margin in both
  // engines and the room in the document (never the page margins, which would shift a frame off its sheet).
  await expectMktgPortraitPageSetup(printFrame);
  await expect(printDocument.locator('lfx-mktg-framework-print .lfx-framework-print')).toHaveCSS('padding-left', '57.6px');
  // A sheet's last row's bottom room, 0.55in = 52.8px, to a tenth (mktgPrintComputedPx).
  expect(
    await mktgPrintComputedPx(printDocument.locator('lfx-mktg-faq-print lfx-mktg-print-sheet-row:last-child > .lfx-print-sheet-cell'), 'padding-bottom')
  ).toBeCloseTo(52.8, 1);
  // The kit's pages read from the kit's own record: the four usage cards, the six watch-outs, the type source as a host.
  await expect(kitPrint.locator('.kp-usage-card')).toHaveCount(4);
  await expect(kitPrint.getByTestId('brand-kit-watchouts-tiles').locator('.kp-watchout')).toHaveCount(6);
  await expect(kitPrint.getByTestId('brand-kit-type-source')).toContainText('Named on one.example.org');
  await expect(kitPrint.getByTestId('brand-kit-type-source')).not.toContainText('https://');
  await expect(kitPrint.getByTestId('brand-kit-voice-messages').locator('.pp-lab')).toHaveText(['Umbrella message', 'Brand line']);
  await expect(kitPrint.locator('[data-testid="lfx-mktg-portrait-page"]').first()).toHaveCSS('break-after', 'page');
  // Every frame is a whole sheet: 816 × 1056 at the sheet's left edge, in the family as alone.
  for (const frame of await kitPrint.locator('[data-testid="lfx-mktg-portrait-page"]').all()) {
    const box = await frame.boundingBox();
    if (!box) throw new Error('Missing synthetic kit frame');
    expect({ x: Math.round(box.x), width: Math.round(box.width), height: Math.round(box.height) }).toEqual({ x: 0, width: 816, height: 1056 });
  }
  await expect(kitPrint).not.toContainText('SVG supplied');
  await expect(kitPrint).not.toContainText('V1.0');
  await expect(printDocument.locator('lfx-brand-kit-view, .lfx-brand-kit-page')).toHaveCount(0);
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
