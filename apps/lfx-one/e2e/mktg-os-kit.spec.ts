// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_KIT_FAMILIES } from '@lfx-one/shared/constants';
import { expect } from '@playwright/test';
import { kitTest as test, openKit, setupKit } from './helpers/mktg-kit.helper';

test.describe('Marketing kit home content', () => {
  test('loads real drafts and run counts, filters rows without hiding any family', async ({ page }) => {
    await setupKit(page, { loaded: true });
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(9);
    await expect(page.getByTestId('mktg-kit-level')).toHaveText('—');
    await expect(page.getByTestId('mktg-kit-level-empty')).toHaveText('No approved assets yet');
    await expect(page.getByTestId('mktg-kit-core-floor')).toHaveText('0 of 9');
    await expect(page.getByTestId('mktg-kit-in-kit')).toHaveText('0 assets');
    await expect(page.getByTestId('mktg-kit-asset-icp')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-asset-boilerplates')).toContainText('Draft');
    await expect(page.getByTestId('mktg-kit-asset-messaging-framework')).toContainText('Draft');
    await expect(page.getByTestId('mktg-kit-families').locator('article h2')).toHaveText(MKTG_KIT_FAMILIES.map((family) => family.name));
    await expect(page.getByTestId('mktg-kit-asset-quarterly-plan')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-asset-linkedin-post')).toContainText('1 this month');
    await page.getByTestId('filter-pill-approved').click();
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(9);
    await expect(page.getByTestId('mktg-kit-family-positioning-brand')).toContainText('No assets in this state');
    await page.getByTestId('filter-pill-draft').click();
    await expect(page.getByTestId('mktg-kit-asset-brand-kit')).toContainText('Draft');
  });
  test('empty projects distinguish missing, unbuilt and zero runs', async ({ page }) => {
    await setupKit(page);
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-in-kit')).toHaveText('0 assets');
    await expect(page.getByTestId('mktg-kit-asset-messaging-framework')).toContainText('Missing');
    await expect(page.getByTestId('mktg-kit-asset-boilerplates')).toContainText('Missing');
    await expect(page.getByTestId('mktg-kit-asset-faq')).toContainText('Missing');
    for (const family of MKTG_KIT_FAMILIES.filter((family) => family.assets.every((asset) => !asset.agentKey))) {
      await expect(page.getByTestId(`mktg-kit-family-availability-${family.id}`)).toHaveText('Coming soon');
      await expect(page.getByTestId(`mktg-kit-family-${family.id}`)).toContainText(family.description);
    }
    await expect(page.getByTestId('mktg-kit-asset-linkedin-post')).toContainText('None yet');
  });
  test('loading never claims zero assets', async ({ page }) => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await setupKit(page, { hold, loaded: true });
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-loading')).toBeVisible();
    await expect(page.getByTestId('mktg-kit-in-kit')).toHaveText('—');
    release();
    await expect(page.getByTestId('mktg-kit-in-kit')).toHaveText('0 assets');
  });
  test('failed read is not an empty kit and can be retried', async ({ page }) => {
    await setupKit(page, { status: 500 });
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-error')).toContainText('could not be loaded');
    await expect(page.getByTestId('mktg-kit-families')).toHaveCount(0);
    await page.getByTestId('mktg-kit-error-retry').getByRole('button').click();
    await expect(page.getByTestId('mktg-kit-error')).toBeVisible();
  });
  test('no write access has its own message', async ({ page }) => {
    await setupKit(page, { writer: false });
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-error')).toContainText('write access');
    await expect(page.getByTestId('mktg-kit-in-kit')).toHaveText('—');
  });
  test('Requests and Access are honest routed placeholders', async ({ page }) => {
    await setupKit(page);
    await openKit(page);
    for (const tab of ['requests', 'access']) {
      await page.getByTestId(`mktg-kit-tab-${tab}`).click();
      await expect(page.getByTestId('mktg-kit-placeholder-empty')).toContainText('comes with its own item');
      await expect(page.getByTestId('mktg-kit-header')).toContainText('Marketing kit');
      await expect(page.getByTestId('mktg-kit-placeholder-title')).toHaveText('Synthetic Kit Project');
      await expect(page.getByTestId(`mktg-kit-tab-${tab}`)).toHaveAttribute('aria-current', 'page');
    }
  });
});
