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
    run.finish();
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Synthetic revision 1', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-generating')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`revision=${RUN_REVISION_ID}`));
    expect(Object.keys(run.submitted()?.['answers'] as object)).toEqual(
      expect.arrayContaining(BRAND_KIT_INTAKE.fields.filter((field) => !field.optional).map((field) => field.key))
    );
    await testInfo.attach('generated-document', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('later run keeps its previous revision visible while generating', async ({ page }, testInfo) => {
    const run = await setupRunPage(page, { existing: true });
    await run.open();
    await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
    await fillRunIntake(page);
    await page.getByTestId('mktg-agent-run-submit-button').click();
    await expect(page.getByTestId('mktg-document-view-generating')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Synthetic revision 1');
    await testInfo.attach('generating-with-previous-revision', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
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
