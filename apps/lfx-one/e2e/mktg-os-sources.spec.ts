// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { setupFreshSources, withDesktopSourcesSetup } from './helpers/mktg-os-sources.helper';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DATA_LOAD_TIMEOUT } from './helpers/mktg-os-assets.helper';

test.describe('Marketing OS new run Sources', () => {
  test.beforeEach(async ({ page }) => suppressCookieBanner(page));
  for (const mount of ['project', 'foundation'] as const) {
    test(`${mount}: prefill, edit and explicit Start land the exact new asset`, async ({ page }) => {
      const deviceViewport = page.viewportSize();
      const sources = await setupFreshSources(page);
      expect(page.viewportSize()).toEqual(deviceViewport);
      await sources.open(mount);
      await expect(page.getByTestId('mktg-run-source-website_url')).toContainText(sources.answers.website_url);
      await expect(page.getByTestId('mktg-run-source-notes')).toContainText('From the last run');
      const start = page.getByTestId('mktg-run-start').getByRole('button');
      await expect(start).toBeEnabled();
      expect(sources.generated).toHaveLength(0);
      expect(sources.polls()).toBe(0);
      await page.getByTestId('mktg-run-sources-edit').getByRole('button').click();
      const website = page.locator('[data-test="mktg-intake-website_url"]');
      await expect(website).toHaveValue(sources.answers.website_url);
      await website.fill('https://edited.example');
      await page.locator('[data-test="mktg-intake-notes"]').fill('');
      sources.handoff.finish();
      await start.click();
      await expect(page).toHaveURL(new RegExp('revision=' + sources.handoff.revision.id), { timeout: DATA_LOAD_TIMEOUT });
      expect(sources.generated).toHaveLength(1);
      expect(sources.generated[0]).toMatchObject({ answers: { website_url: 'https://edited.example', notes: '' } });
      await expect(page.getByTestId('mktg-document-view-run-again')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('fresh-run-exact-asset.png'), fullPage: true });
    });
  }

  test('reload restores durable scalar values but requires an explicit decision about previous logos', async ({ page }) => {
    const sources = await setupFreshSources(page, { logoCount: 1 });
    await sources.open();
    await expect(page.getByTestId('mktg-run-reattach-logos')).toContainText('(1)');
    // Reload the shell to discard service memory; SPA entry keeps synthetic project reads in page.route.
    await withDesktopSourcesSetup(page, async () => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    });
    await sources.open();
    await expect(page.getByTestId('mktg-run-source-notes')).toContainText(sources.answers.notes);
    await expect(page.getByTestId('mktg-run-start').getByRole('button')).toBeDisabled();
    expect(sources.generated).toHaveLength(0);
    await page.getByTestId('mktg-run-drop-missing').getByRole('button').click();
    await expect(page.getByTestId('mktg-run-start').getByRole('button')).toBeEnabled();
    expect(sources.generated).toHaveLength(0);
    await page.screenshot({ path: test.info().outputPath('reload-reattachment-explicit-choice.png'), fullPage: true });
  });

  for (const state of ['empty', 'error', 'denied', 'loading'] as const) {
    test(`${state} history remains an honest no-auto-start state`, async ({ page }) => {
      const sources = await setupFreshSources(page, { state });
      await sources.open();
      if (state === 'loading') {
        await expect(page.getByTestId('mktg-run-sources-loading')).toBeVisible();
        await expect(page.getByTestId('mktg-run-start').getByRole('button')).toBeDisabled();
        sources.releaseHistory();
        await expect(page.getByTestId('mktg-run-source-notes')).toContainText(sources.answers.notes);
      } else if (state === 'denied') {
        await expect(page.getByTestId('mktg-run-sources-denied')).toContainText('write access');
        await expect(page.getByTestId('mktg-run-start').getByRole('button')).toBeDisabled();
        await expect(page.getByTestId('mktg-run-source-notes')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('mktg-run-sources-note')).toContainText(state === 'empty' ? 'Suggested defaults' : 'could not be loaded');
      }
      expect(sources.generated).toHaveLength(0);
      expect(sources.polls()).toBe(0);
      await page.screenshot({ path: test.info().outputPath(`sources-${state}.png`), fullPage: true });
    });
  }
});
