// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Download PDF behind `mktg-os-pdf-download-enabled` (#5302): with the flag off every Download PDF entry point is
 * gone and the screen looks finished (no empty slot, the remaining action in the row's primary place); with it on the
 * screens are today's. One check per place, off and on: the AEO/GEO report row, the messaging framework view, the brand
 * kit web view (and its footer), and the family export card (its PDF note, its approval note and its PDF preparation).
 * The print renderings themselves are the print specs' business.
 */

import { MKTG_OS_PDF_DOWNLOAD_ENABLED_FLAG } from '@lfx-one/shared/constants/feature-flags.constants';
import { expect, Page, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { setupAudit } from './helpers/mktg-os-aeo-geo.helper';
import { columnAssetRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { openFamilyExports } from './helpers/mktg-os-family-export.helper';
import { pinMktgOsFlags } from './helpers/mktg-os-flags.helper';

const KIT_FOOTER_PDF = 'PDF in portrait pages: logo, colour, typography, visual and voice.';
const KIT_FOOTER_SLIDES = 'Export to Google Slides builds the kit as a deck in Google Drive, in the kit’s colours, typeface and logo.';

test.use({ viewport: { width: 1440, height: 1000 } });
test.beforeEach(async ({ page }) => suppressCookieBanner(page));

/** Before the page helper, whose own default pin leaves a stored value alone (see `pinMktgOsFlags`). */
async function pdfFlagOff(page: Page): Promise<void> {
  await pinMktgOsFlags(page, { [MKTG_OS_PDF_DOWNLOAD_ENABLED_FLAG]: false });
}

/** Opens the earlier audit's stored report, the document view with the "Audit again" row. */
async function openAuditReport(page: Page): Promise<void> {
  const app = await setupAudit(page, { previous: true });
  const [reportId] = app.documents.keys();
  await app.go(`/documents/aeo-geo/${reportId}`);
  await expect(page.getByTestId('mktg-document-view-run-again')).toHaveText('Audit again');
}

/**
 * The approved asset view with its export row: `foundation-message` is the framework view, `brand-kit` the kit's web view.
 * On the document page the view's title actions are lifted into the document header's row.
 */
async function openApprovedAsset(page: Page, key: 'foundation-message' | 'brand-kit'): Promise<string> {
  await openAssetDocument(page, key, 200, true, false, columnAssetRevisionResponse(key));
  await expect(page.getByTestId('mktg-document-view-title-actions')).toBeVisible();
  return key === 'brand-kit' ? 'brand-kit-web-view' : 'mktg-framework-view';
}

test.describe('AEO/GEO report row', () => {
  test('flag off: Audit again alone in the row, no empty slot where Download PDF was', async ({ page }, info) => {
    await pdfFlagOff(page);
    await openAuditReport(page);
    const row = page.getByTestId('mktg-aeo-report-actions');
    await expect(page.getByTestId('mktg-document-view-download')).toHaveCount(0);
    await expect(row.locator('lfx-button')).toHaveCount(0);
    await expect(row.locator(':scope > *')).toHaveCount(1);
    const rowBox = await row.boundingBox();
    const linkBox = await page.getByTestId('mktg-document-view-run-again').boundingBox();
    if (!rowBox || !linkBox) throw new Error('The report row and its link must be laid out');
    // The link is the whole row: no gap or reserved width survives the hidden button.
    expect(Math.abs(rowBox.width - linkBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(rowBox.x - linkBox.x)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('mktg-document-view-print')).toBeAttached();
    await page.screenshot({ path: info.outputPath('aeo-report-flag-off.png'), fullPage: true });
  });

  test('flag on: Download PDF follows Audit again, as today', async ({ page }, info) => {
    await openAuditReport(page);
    const row = page.getByTestId('mktg-aeo-report-actions');
    await expect(row.getByTestId('mktg-document-view-download')).toHaveText('Download PDF');
    await expect(row.getByTestId('mktg-document-view-download').getByRole('button')).toBeEnabled();
    await expect(row.locator(':scope > *')).toHaveCount(2);
    await page.screenshot({ path: info.outputPath('aeo-report-flag-on.png'), fullPage: true });
  });
});

for (const key of ['foundation-message', 'brand-kit'] as const) {
  const surface = key === 'brand-kit' ? 'brand kit web view' : 'messaging framework view';
  test.describe(surface, () => {
    test('flag off: Export to Google Slides alone and solid, no Download PDF', async ({ page }, info) => {
      await pdfFlagOff(page);
      const prefix = await openApprovedAsset(page, key);
      const actions = page.getByTestId('mktg-document-view-title-actions');
      await expect(page.getByTestId(`${prefix}-download-pdf`)).toHaveCount(0);
      await expect(actions.locator('lfx-button')).toHaveText(['Export to Google Slides']);
      const slides = actions.getByTestId(`${prefix}-export-slides`).getByRole('button');
      await expect(slides).toBeVisible();
      await expect(slides).not.toHaveClass(/p-button-outlined/);
      const actionsBox = await actions.boundingBox();
      const slidesBox = await slides.boundingBox();
      if (!actionsBox || !slidesBox) throw new Error('The header row and its one export action must be laid out');
      // The one export action ends the right-aligned row: no gap or reserved width survives the hidden button.
      expect(Math.abs(actionsBox.x + actionsBox.width - (slidesBox.x + slidesBox.width))).toBeLessThanOrEqual(1);
      if (key === 'brand-kit') {
        await expect(page.getByTestId('brand-kit-web-view-footer-pdf')).toHaveCount(0);
        await expect(page.getByTestId('brand-kit-web-view-footer')).toHaveText(KIT_FOOTER_SLIDES);
      }
      await page.screenshot({ path: info.outputPath(`${key}-flag-off.png`), fullPage: true });
    });

    test('flag on: outlined Export to Google Slides then solid Download PDF, as today', async ({ page }, info) => {
      const prefix = await openApprovedAsset(page, key);
      const actions = page.getByTestId('mktg-document-view-title-actions');
      await expect(actions.locator('lfx-button')).toHaveText(['Export to Google Slides', 'Download PDF']);
      await expect(actions.getByTestId(`${prefix}-export-slides`).getByRole('button')).toHaveClass(/p-button-outlined/);
      const pdf = actions.getByTestId(`${prefix}-download-pdf`).getByRole('button');
      await expect(pdf).toBeEnabled();
      await expect(pdf).not.toHaveClass(/p-button-outlined/);
      if (key === 'brand-kit') {
        await expect(page.getByTestId('brand-kit-web-view-footer-pdf')).toHaveText(KIT_FOOTER_PDF);
        await expect(page.getByTestId('brand-kit-web-view-footer')).toHaveText(`${KIT_FOOTER_PDF} ${KIT_FOOTER_SLIDES}`);
      }
      await page.screenshot({ path: info.outputPath(`${key}-flag-on.png`), fullPage: true });
    });
  });
}

test.describe('family export card', () => {
  test('flag off: Export to Google Slides is the card’s one button, under its note, with no PDF note', async ({ page }, info) => {
    await pdfFlagOff(page);
    await openFamilyExports(page, { existing: true });
    const card = page.getByTestId('family-export-actions');
    await expect(page.getByTestId('family-export-pdf')).toHaveCount(0);
    await expect(page.getByTestId('family-export-pdf-note')).toHaveCount(0);
    await expect(card.locator(':scope > lfx-button')).toHaveCount(1);
    const slides = card.getByTestId('family-export-slides');
    await expect(slides.getByRole('button')).toBeEnabled();
    await expect(slides.getByRole('button')).toHaveClass(/p-button-outlined/);
    // The Slides note sits directly above the Slides button: nothing is left of the PDF button's place.
    expect(await slides.evaluate((element) => element.previousElementSibling?.textContent?.trim())).toContain('Google Slides:');
    const contentWidth = await card.evaluate((element) => {
      const style = getComputedStyle(element);
      return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    const slidesBox = await slides.getByRole('button').boundingBox();
    if (!slidesBox) throw new Error('The export card’s one button must be laid out');
    // Still the card's fluid button: it spans the card's content width on its own.
    expect(Math.abs(contentWidth - slidesBox.width)).toBeLessThanOrEqual(1);
    await expect(card).not.toContainText('PDF');
    // No PDF is prepared while its button is hidden: the checking line is gone and the print document stays unprepared.
    await expect(card.getByTestId('family-export-loading')).toHaveCount(0);
    await expect(page.getByTestId('family-export-print-document')).toHaveAttribute('data-prepared', 'false');
    await page.screenshot({ path: info.outputPath('family-export-flag-off.png'), fullPage: true });
  });

  test('flag off, nothing approved yet: the approval note names Slides alone', async ({ page }, info) => {
    await pdfFlagOff(page);
    await openFamilyExports(page, { empty: true });
    const card = page.getByTestId('family-export-actions');
    await expect(card.getByTestId('family-export-empty')).toHaveText('Available once the framework is approved: Slides uses the approved current.');
    await expect(card.getByTestId('family-export-slides').getByRole('button')).toBeDisabled();
    await expect(card).not.toContainText('PDF');
    await page.screenshot({ path: info.outputPath('family-export-empty-flag-off.png'), fullPage: true });
  });

  test('flag on: Download PDF above Export to Google Slides, both outlined, with the PDF note, as today', async ({ page }, info) => {
    await openFamilyExports(page, { existing: true });
    const card = page.getByTestId('family-export-actions');
    await expect(card.locator(':scope > lfx-button')).toHaveText(['Download PDF', 'Export to Google Slides']);
    for (const action of ['pdf', 'slides']) {
      await expect(card.getByTestId(`family-export-${action}`).getByRole('button')).toHaveClass(/p-button-outlined/);
    }
    await expect(page.getByTestId('family-export-pdf-note')).toHaveText('PDF: framework, brand kit, boilerplates and FAQ (approved current).');
    await page.screenshot({ path: info.outputPath('family-export-flag-on.png'), fullPage: true });
  });
});
