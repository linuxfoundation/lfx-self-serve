// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_INTAKE } from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, fillRunIntake, RUN_REVISION_ID, setupRunPage } from './helpers/mktg-os-runs.helper';

test.describe('Marketing OS runs land on documents', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.beforeEach(() => test.skip(!process.env['TEST_USERNAME'] || !process.env['TEST_PASSWORD'], 'Test session credentials are not configured.'));

  test('first run opens progress only, then the exact produced document', async ({ page }, testInfo) => {
    const run = await setupRunPage(page);
    await run.open();
    await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
    await fillRunIntake(page);
    await page.getByTestId('mktg-agent-run-submit-button').click();
    await expect(page).toHaveURL(/\/documents\/brand-kit\/living/);
    await expect(page.getByTestId('mktg-document-view-generating')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-about')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-generating-title')).toHaveText('Writing the Synthetic Orbit Brand Kit');
    await expect(page.getByTestId('mktg-document-view-generating-meta')).toContainText(/Started \d{1,2} [A-Za-z]+, \d{2}:\d{2}/);
    await expect(page.getByTestId('mktg-document-view-generating-meta')).toContainText(
      '· usually three to five minutes · you can leave this page; the result lands in Documents'
    );
    await expect(page.getByTestId('mktg-document-view-generating-note')).toHaveText(
      'On a first run there is nothing below this card until the revision lands.'
    );
    await expect(page.getByTestId('mktg-document-view-writing-step')).toContainText('● Writing the document');
    run.finish();
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Synthetic revision 1', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-generating')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`revision=${RUN_REVISION_ID}`));
    expect(Object.keys(run.submitted()?.['answers'] as object)).toEqual(
      expect.arrayContaining(BRAND_KIT_INTAKE.fields.filter((field) => !field.optional).map((field) => field.key))
    );
    await testInfo.attach('generated-document', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('later run keeps its previous revision visible while writing and storing', async ({ page }, testInfo) => {
    const run = await setupRunPage(page, { existing: true, holdPersistence: true });
    await run.open();
    await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
    await fillRunIntake(page);
    await page.getByTestId('mktg-agent-run-submit-button').click();
    await expect(page.getByTestId('mktg-document-view-generating')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Synthetic revision 1');
    await expect(page.getByTestId('mktg-document-view-generating-note')).toHaveText('Below this card, revision 1 stays readable until revision 2 lands.');
    await expect(page.getByTestId('mktg-document-view-writing-step')).toContainText('● Writing the document');
    const started = await page.getByTestId('mktg-document-view-generating-meta').innerText();
    await testInfo.attach('generating-with-previous-revision', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    run.finish();
    await expect(page.getByTestId('mktg-document-view-storing-step')).toHaveAttribute('aria-current', 'step', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-writing-step')).toContainText('✓ Writing the document');
    await expect(page.getByTestId('mktg-document-view-generating-meta')).toHaveText(started);
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Synthetic revision 1');
    await expect(page.getByTestId('mktg-document-view-generating')).not.toContainText('Sources read');
    await expect(page.getByTestId('mktg-document-view-generating')).not.toContainText('Building the slides');
    await expect(page.getByTestId('mktg-document-view-storing-step')).toContainText('● Storing revision 2');
    run.persist();
    await testInfo.attach('after-persist-released', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Synthetic revision 2', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-generating')).toHaveCount(0);
    await testInfo.attach('stored-revision', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('generation failure is visible without presenting the prior revision as a new result', async ({ page }, testInfo) => {
    const run = await setupRunPage(page, { existing: true, fail: true });
    await run.open();
    await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
    await fillRunIntake(page);
    await page.getByTestId('mktg-agent-run-submit-button').click();
    await expect(page.getByTestId('mktg-document-view-error')).toContainText('could not finish', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-generating')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Synthetic revision 1');
    await testInfo.attach('generation-error', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('README-less explanation lives in About this document', async ({ page }, testInfo) => {
    const run = await setupRunPage(page, { existing: true });
    await run.open('documents/foundation-message/living');
    await expect(page.getByTestId('mktg-document-view-about')).toContainText('Generated without a README');
    await expect(page.getByTestId('mktg-agent-run-feedback')).toHaveCount(0);
    await testInfo.attach('document-about', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
});
