// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { MKTG_FAMILY_EXPORT_API_PATH, MKTG_FAMILY_PRINT_BODY_CLASS } from '../../../packages/shared/src/constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DOCUMENT_PROJECT } from './helpers/mktg-os-documents.helper';
import { openFamilyExports } from './helpers/mktg-os-family-export.helper';
import {
  expectMktgPortraitPageSetup,
  expectMktgPrintCover,
  expectMktgPrintFrame,
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
  // The framework prints as part of the family book: its plan's frames for this fixture (one goal, one ICP), no cover,
  // each under the family's running head and foot, numbered on from the family cover (page 1), its band off.
  const frameworkFrames = printDocument.locator('lfx-mktg-framework-print [data-testid="lfx-mktg-portrait-page"]');
  await expect(frameworkFrames).toHaveCount(7);
  expect(await frameworkFrames.evaluateAll((frames) => frames.map((frame) => frame.getAttribute('data-page-id')))).toEqual([
    'framework',
    'goal-1',
    'say-avoid',
    'icps-1',
    'message-house',
    'key-numbers',
    'sources',
  ]);
  expect(await frameworkFrames.evaluateAll((frames) => frames.map((frame) => frame.getAttribute('data-page')))).toEqual(['2', '3', '4', '5', '6', '7', '8']);
  await expect(frameworkFrames.first().getByTestId('mktg-portrait-page-number')).toHaveText('02');
  await expect(frameworkFrames.first()).toHaveAttribute('data-section', 'Messaging framework · Framework');
  await expect(frameworkFrames.locator('[data-testid="mktg-portrait-page-doc"]')).toHaveText(Array(7).fill(`${DOCUMENT_PROJECT.name} positioning & brand`));
  await expect(frameworkFrames.first().getByTestId('mktg-portrait-page-foot')).toContainText(`${DOCUMENT_PROJECT.name} · a Linux Foundation project`);
  await expect(printDocument.locator('lfx-mktg-framework-print [data-testid="mktg-portrait-page-band"]')).toHaveCount(0);
  await expect(printDocument.getByTestId('mktg-framework-print-cover')).toHaveCount(0);
  await expect(printDocument.getByTestId('mktg-framework-print-goals')).toBeVisible();
  await expect(printDocument.getByTestId('mktg-framework-print-pillars')).toHaveCount(1);
  await expect(printDocument.locator('[data-testid^="mktg-framework-print-icp-"]')).toHaveCount(1);
  // The family passes the framework no report, approval or read date today (its follow-up), so its Sources & gaps page prints
  // the approval card alone: no intro, no lists, no empty-state line, and a card without a version or approval lead.
  await expect(frameworkFrames.last()).toHaveAttribute('data-page-id', 'sources');
  await expect(printDocument.getByTestId('mktg-framework-print-sources-intro')).toHaveCount(0);
  await expect(printDocument.getByTestId('mktg-framework-print-sources-read')).toHaveCount(0);
  await expect(printDocument.getByTestId('mktg-framework-print-sources-failed-empty')).toHaveCount(0);
  await expect(printDocument.getByTestId('mktg-framework-print-gaps-empty')).toHaveCount(0);
  await expect(printDocument.getByTestId('mktg-framework-print-approval')).toHaveText('A later run re-reads the sources and refreshes the LFX figures.');
  for (const frame of await frameworkFrames.all()) {
    const box = await frame.boundingBox();
    expect({ x: Math.round(box?.x ?? -1), width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) }).toEqual({
      x: 0,
      width: 816,
      height: 1056,
    });
  }
  await expect(printDocument.locator('lfx-mktg-boilerplates-print h2 > span')).toHaveText('03');
  await expect(printDocument.locator('lfx-mktg-faq-print h2 > span')).toHaveText('04');
  for (const selector of ['lfx-mktg-boilerplates-print', 'lfx-mktg-faq-print']) {
    await expect(printDocument.locator(selector).getByTestId('mktg-print-running-head')).toBeVisible();
    await expect(printDocument.locator(selector).getByTestId('mktg-print-running-head').locator('img')).toBeVisible();
  }
  await expect(printDocument.locator('lfx-mktg-brand-kit-print .kit-chapter')).toHaveCount(5);
  // The kit's Logo chapter and palette are portrait frames (one frame, one sheet; the synthetic kit has no symbol, so
  // no symbol page); four kit chapters still flow.
  await expect(printDocument.locator('lfx-mktg-brand-kit-print [data-testid="lfx-mktg-portrait-page"]')).toHaveCount(6);
  await expect(printDocument.locator('lfx-mktg-brand-kit-print .kit-chapter > thead')).toHaveCount(4);
  // The page's room is in the document, not the @page margin (none, so no browser header or footer): every kit chapter
  // repeats its head's 0.55in per page and pads its last row, and the other sections print in sheets that repeat a head
  // and pad their last row, one row per block — no footer group anywhere, for which Chromium prints an empty page per
  // table: the family cover 1; the boilerplates 4 lengths; the FAQ its header + 4 pairs (the framework prints in
  // portrait frames, not sheets). 3 sheets, all shown.
  await expect(printDocument.locator('tfoot, [data-testid="mktg-print-sheet-foot"]')).toHaveCount(0);
  await expect(printDocument.locator('lfx-mktg-brand-kit-print .kit-chapter > thead')).toHaveCount(5);
  await expect(printDocument.getByTestId('mktg-print-sheet-head')).toHaveCount(3);
  await expect(printDocument.locator('lfx-mktg-print-sheet')).toHaveCount(3);
  await expect(printDocument.locator('lfx-mktg-print-sheet').locator('visible=true')).toHaveCount(3);
  await expect(printDocument.locator('lfx-mktg-print-sheet-row')).toHaveCount(1 + 4 + 5);
  // The page setup: the kit's and the framework's portrait frames make the family a document of frames, US Letter with
  // no margin in both engines and the room in the document (never the page margins, which would shift a frame off its
  // sheet); the framework's root lifts the flowing documents' side padding and its frames sit at the sheet's edge.
  await expectMktgPortraitPageSetup(printFrame, printDocument.locator('lfx-mktg-framework-print .lfx-framework-print'));
  // The last rows' bottom room, to a tenth (mktgPrintComputedPx): the kit's calc(10pt + 0.55in) = 66.13px; a sheet's
  // 0.55in = 52.8px.
  expect(
    await mktgPrintComputedPx(printDocument.locator('lfx-mktg-brand-kit-print .kit-chapter > tbody > tr:last-child > td').first(), 'padding-bottom')
  ).toBeCloseTo(66.133, 1);
  expect(
    await mktgPrintComputedPx(printDocument.locator('lfx-mktg-faq-print lfx-mktg-print-sheet-row:last-child > .lfx-print-sheet-cell'), 'padding-bottom')
  ).toBeCloseTo(52.8, 1);
  await expect(printDocument.locator('lfx-mktg-brand-kit-print .kit-usage-frame')).toHaveCount(4);
  const kitPrint = printDocument.locator('lfx-mktg-brand-kit-print');
  // This fixture's short contrast table stays whole: no one/two-row Letter tail.
  expect(await kitPrint.getByTestId('kit-print-contrast').locator('tbody > tr').count()).toBeLessThanOrEqual(12);
  await expect(kitPrint.locator('.kit-contrast-block')).toHaveCSS('break-inside', 'avoid');
  await expect(kitPrint.getByTestId('kit-print-contrast')).toHaveCSS('break-inside', 'avoid');
  await expect(kitPrint.getByTestId('kit-print-contrast').locator('thead')).toHaveCSS('display', 'table-header-group');
  await expect(kitPrint.getByTestId('kit-print-type')).toContainText('Source: one.example.org site CSS');
  await expect(kitPrint.getByTestId('kit-print-type')).not.toContainText('https://');
  await expect(kitPrint.getByTestId('kit-print-voice').locator('.kit-eyebrow')).toHaveText(['Umbrella message', 'Brand line']);
  await expect(kitPrint.getByTestId('kit-print-voice').locator('.kit-voice-source')).toHaveText('From the messaging framework');
  await expect(kitPrint.getByTestId('brand-kit-watchouts-tiles').locator('.kp-watchout')).toHaveCount(6);
  await expect(kitPrint.locator('[data-testid="lfx-mktg-portrait-page"]').first()).toHaveCSS('break-after', 'page');
  for (const frame of await kitPrint.locator('.kit-usage-frame').all()) {
    await expect(frame).toHaveCSS('position', 'relative');
    await expect(frame).toHaveCSS('overflow', 'hidden');
    await expect(frame).toHaveCSS('break-inside', 'avoid');
    await expect(frame.locator('.kit-usage-inner')).toHaveCSS('position', 'absolute');
    for (const child of await frame.locator('.kit-usage-inner > img, .kit-usage-inner > p').all()) {
      await expect(child).toHaveCSS('position', 'absolute');
    }
    const contained = await frame.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll('img, p')).every((child) => {
        const content = child.getBoundingClientRect();
        return content.left >= box.left - 0.5 && content.top >= box.top - 0.5 && content.right <= box.right + 0.5 && content.bottom <= box.bottom + 0.5;
      });
    });
    expect(contained, 'Family print logo/line must remain inside its own bounded frame').toBe(true);
  }
  const firstUsageFrame = printDocument.locator('lfx-mktg-brand-kit-print .kit-usage-frame').first();
  await expect(firstUsageFrame).toHaveCSS('aspect-ratio', 'auto');
  const usageBox = await firstUsageFrame.boundingBox();
  if (!usageBox) throw new Error('Missing synthetic usage frame');
  expect(usageBox.height).toBeCloseTo((36 * 96) / 25.4, 0);
  await expect(printDocument.getByTestId('kit-print-usage-pair')).toHaveCount(2);
  await expect(printDocument.locator('lfx-mktg-brand-kit-print')).not.toContainText('SVG supplied');
  await expect(printDocument.locator('lfx-mktg-brand-kit-print')).not.toContainText('V1.0');
  await expect(printDocument.locator('lfx-brand-kit-view, .lfx-brand-kit-page')).toHaveCount(0);
  await expect(printDocument.locator('lfx-mktg-brand-kit-print')).toContainText('02.5 Voice in brief');
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
