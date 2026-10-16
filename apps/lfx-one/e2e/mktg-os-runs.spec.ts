// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BRAND_KIT_INTAKE, FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MKTG_OS_AGENTS_ENABLED_FLAG, MKTG_RUN_STORAGE_KEY_PREFIX } from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, FAILED_RUN_REPLY, fillRunIntake, RUN_REVISION_ID, runRevision, setupRunPage } from './helpers/mktg-os-runs.helper';

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

  test('a left run appears in Documents and lands from a fresh browser with no local run record', async ({ page, browser }, testInfo) => {
    const origin = await setupRunPage(page);
    await origin.open();
    await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
    await fillRunIntake(page);
    await page.getByTestId('mktg-agent-run-submit-button').click();
    await expect(page.getByTestId('mktg-document-view-generating')).toBeVisible();
    await origin.open('');
    await expect(page.getByTestId('mktg-os-agents-page')).toBeVisible();

    const freshContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      storageState: testInfo.project.use.storageState,
      viewport: { width: 1440, height: 900 },
    });
    try {
      const freshPage = await freshContext.newPage();
      await freshPage.addInitScript(
        ([key, flag]) => {
          localStorage.clear();
          localStorage.setItem(key, JSON.stringify({ [flag]: true }));
        },
        [FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MKTG_OS_AGENTS_ENABLED_FLAG]
      );
      const submissions: string[] = [];
      const readModes: (string | null)[] = [];
      freshPage.on('request', (request) => {
        const url = new URL(request.url());
        if (request.method() === 'GET' && url.pathname.startsWith('/api/mktg-agents/documents')) {
          readModes.push(url.searchParams.get('poll'));
        }
        if (request.method() === 'POST' && /\/api\/mktg-agents\/(?:chat|[^/]+\/(?:generate|result))$/.test(new URL(request.url()).pathname)) {
          submissions.push(request.url());
        }
      });
      const visitor = await setupRunPage(freshPage, { serverState: origin.serverState });
      await visitor.open('documents');
      await expect(freshPage.getByTestId('mktg-documents-started-runs')).toContainText('Writing the document');
      await expect(freshPage.getByTestId('mktg-documents-empty-living')).toHaveCount(0);
      expect(await freshPage.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)), MKTG_RUN_STORAGE_KEY_PREFIX)).toEqual([]);
      await testInfo.attach('fresh-browser-started-run-list', { body: await freshPage.screenshot({ fullPage: true }), contentType: 'image/png' });
      await freshPage.getByTestId('mktg-documents-open-started-' + 'c'.repeat(64)).click();
      await expect(freshPage.getByTestId('mktg-document-view-generating-title')).toHaveText('Writing the Synthetic Orbit Brand Kit');
      await expect(freshPage.getByTestId('mktg-document-view-document')).toHaveCount(0);
      await testInfo.attach('fresh-browser-generating', { body: await freshPage.screenshot({ fullPage: true }), contentType: 'image/png' });
      origin.finish();
      await expect(freshPage.getByTestId('mktg-document-view-document')).toContainText('Synthetic revision 1', { timeout: DATA_LOAD_TIMEOUT });
      await expect(freshPage.getByTestId('mktg-document-view-generating')).toHaveCount(0);
      expect(submissions).toEqual([]);
      expect(readModes).toContain(null); // Initial/navigation reads keep full discovery.
      expect(readModes).toContain('1'); // Automatic reads use the bounded hot path.
      expect(await freshPage.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)), MKTG_RUN_STORAGE_KEY_PREFIX)).toEqual([]);
      await testInfo.attach('fresh-browser-landed', { body: await freshPage.screenshot({ fullPage: true }), contentType: 'image/png' });
    } finally {
      await freshContext.close();
    }
  });

  test('generation failure is visible without presenting the prior revision as a new result', async ({ page }, testInfo) => {
    const run = await setupRunPage(page, { existing: true, fail: true });
    await run.open();
    await expect(page.getByTestId('mktg-agent-run-form')).toBeVisible();
    await fillRunIntake(page);
    await page.getByTestId('mktg-agent-run-submit-button').click();
    await expect(page.getByTestId('mktg-document-view-error')).toContainText(FAILED_RUN_REPLY, { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-error').locator('b')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-generating')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Synthetic revision 1');
    await testInfo.attach('generation-error', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('suggested llms.txt stays intact in a legible fenced block', async ({ page }, testInfo) => {
    const run = await setupRunPage(page, { existing: true });
    const response = runRevision('foundation-message', 1);
    response.markdown =
      '# Synthetic Messaging Document\n\n## Suggested llms.txt\n\nKeep `llms.txt` as a suggested file.\n\n```llms.txt\n# Synthetic Orbit\n> A synthetic open source project.\n- Documentation: https://docs.example.org/\n```';
    await page.route('**/api/mktg-agents/documents/foundation-message/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
    );
    await run.open('documents/foundation-message/living');
    const document = page.getByTestId('mktg-document-view-document');
    const pre = document.locator('pre');
    const code = pre.locator('code');
    await expect(code).toHaveAttribute('class', 'language-llms.txt');
    await expect(code).toContainText('# Synthetic Orbit');
    await expect(code).toContainText('Documentation: https://docs.example.org/');
    await expect(document.locator('p > code')).toHaveText('llms.txt');
    await expect(code).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(code).toHaveCSS('padding', '0px');
    await expect(code).toHaveCSS('border-radius', '0px');
    await expect(code).toHaveCSS('color', await pre.evaluate((element) => getComputedStyle(element).color));
    await expect(code).toHaveCSS('font-size', await pre.evaluate((element) => getComputedStyle(element).fontSize));
    const contrast = await pre.evaluate((element) => {
      const luminance = (color: string): number => {
        const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
          const channel = Number(value) / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => sum + weight * (channels[index] ?? 0), 0);
      };
      const style = getComputedStyle(element);
      const text = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
    await testInfo.attach('legible-llms-txt-document', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });

  test('README-less explanation lives in About this document', async ({ page }, testInfo) => {
    const run = await setupRunPage(page, { existing: true });
    await run.open('documents/foundation-message/living');
    await expect(page.getByTestId('mktg-document-view-about')).toContainText('Generated without a README');
    await expect(page.getByTestId('mktg-agent-run-feedback')).toHaveCount(0);
    await testInfo.attach('document-about', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
});
