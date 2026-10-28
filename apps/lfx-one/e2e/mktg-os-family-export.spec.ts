// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { MKTG_FAMILY_EXPORT_API_PATH, MKTG_FAMILY_PRINT_BODY_CLASS } from '@lfx-one/shared/constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { openFamilyExports } from './helpers/mktg-os-family-export.helper';

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
  await expect(page.getByTestId('family-export-empty')).toContainText('Approve a revision first');
  for (const action of ['pdf', 'slides']) await expect(page.getByTestId(`family-export-${action}`).getByRole('button')).toBeDisabled();
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

test('unsupported family explains its export state and disables both actions', async ({ page }, info) => {
  await openFamilyExports(page, { familyId: 'website-web' });
  await expect(page.getByTestId('family-export-unsupported')).toContainText('no assets supported by the exporter');
  for (const action of ['pdf', 'slides']) await expect(page.getByTestId(`family-export-${action}`).getByRole('button')).toBeDisabled();
  await page.screenshot({ path: info.outputPath('unsupported-family-export.png'), fullPage: true });
});

test('Download PDF prints all four approved assets with one family cover and contents', async ({ page }, info) => {
  await openFamilyExports(page, { allAssets: true });
  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset['familyPrintClass'] = document.body.className;
    };
  });
  await page.getByTestId('family-export-pdf').getByRole('button').click();
  await expect(page.locator('body')).toHaveAttribute('data-family-print-class', new RegExp(MKTG_FAMILY_PRINT_BODY_CLASS), { timeout: 15_000 });
  const printDocument = page.getByTestId('family-export-print-document');
  for (const selector of ['lfx-mktg-framework-print', 'lfx-brand-kit-view', 'lfx-mktg-boilerplates-print', 'lfx-mktg-faq-print']) {
    await expect(printDocument.locator(selector)).toHaveCount(1);
  }
  await expect(page.getByTestId('family-export-print-contents').locator('dd')).toHaveText(['Messaging framework', 'Brand kit', 'Boilerplates', 'FAQ']);
  await expect(page.getByTestId('mktg-boilerplates-print-length')).toHaveCount(4);
  await expect(page.getByTestId('mktg-faq-print')).toContainText('Needs an answer');
  await expect(printDocument).toBeHidden();
  await expect(page.getByTestId('family-export-pdf-note')).toHaveText('PDF: framework, brand kit, boilerplates and FAQ (approved current).');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('family-export-print-cover')).toBeVisible();
  await expect(page.getByTestId('mktg-framework-print-cover')).toBeHidden();
  await expect(page.getByTestId('brand-kit-page-cover')).toBeHidden();
  await expect(page.getByTestId('brand-kit-page-contents')).toBeHidden();
  await page.screenshot({ path: info.outputPath('four-assets-print-document.png'), fullPage: true });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.screenshot({ path: info.outputPath('family-pdf-ready.png'), fullPage: true });
});
