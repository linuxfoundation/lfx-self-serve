// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_KIT_FAMILIES } from '../../../packages/shared/src/constants';
import { isMktgKitFamilyLive } from '../../../packages/shared/src/utils/mktg-kit.utils';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { expect } from '@playwright/test';
import { kitTest as test, kitDocuments, openKit, setupKit } from './helpers/mktg-kit.helper';

test.describe('Marketing kit home content', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test('a started run replaces the asset badge with quiet writing progress', async ({ page }) => {
    const listing = kitDocuments(false);
    listing.runs = [
      {
        agentKey: 'foundation-message',
        project: listing.project,
        documentId: 'living',
        runId: 'synthetic-run',
        state: 'writing',
        startedAt: '2026-10-28T12:00:00Z',
      },
    ];
    await setupKit(page, { listing });
    await openKit(page);
    const row = page.getByTestId('mktg-kit-asset-messaging-framework');
    await expect(row.getByTestId('mktg-kit-run-status')).toContainText('Writing…');
    await expect(row.getByTestId('mktg-kit-run-status-link')).toHaveAttribute('href', /documents\/foundation-message\/living\?project=.*&run=synthetic-run$/);
    await expect(page.getByTestId('mktg-kit-next-step-action')).toContainText('Create messaging framework');
    await page.screenshot({ path: test.info().outputPath('kit-writing.png'), fullPage: true });
  });
  test('Not run yet filters include never-run one-offs but not coming-soon assets', async ({ page }) => {
    await setupKit(page);
    await openKit(page);
    await page.getByTestId('filter-pill-missing').click();
    await expect(page.getByTestId('mktg-kit-asset-linkedin-post')).toContainText('Not run yet');
    await expect(page.getByTestId('mktg-kit-asset-member-360')).toContainText('Not run yet');
    await expect(page.getByTestId('mktg-kit-asset-aeo-geo')).toContainText('Not run yet');
    await expect(page.getByTestId('mktg-kit-asset-one-pager')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('kit-one-off-missing.png'), fullPage: true });
  });
  test('prior-run one-offs have a last-run label and belong to All only', async ({ page }) => {
    const listing = kitDocuments(true);
    for (const group of listing.groups)
      if (group.type.agentKey === 'linkedin-post') for (const document of group.documents) document.createdAt = '2026-09-10T12:00:00Z';
    await page.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));
    await setupKit(page, { listing });
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-asset-linkedin-post')).toContainText('Last run 10 Sep');
    for (const state of ['missing', 'draft', 'approved', 'needs-rebuild']) {
      await page.getByTestId(`filter-pill-${state}`).click();
      await expect(page.getByTestId('mktg-kit-asset-linkedin-post')).toHaveCount(0);
    }
    await page.getByTestId('filter-pill-all').click();
    await expect(page.getByTestId('mktg-kit-asset-linkedin-post')).toContainText('Last run 10 Sep');
    await page.screenshot({ path: test.info().outputPath('kit-prior-one-off.png'), fullPage: true });
  });
  test('loads real drafts and run counts, filters rows without hiding any live family', async ({ page }) => {
    await setupKit(page, { loaded: true });
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4);
    await expect(page.getByTestId('mktg-kit-families').locator('article.border-gray-200')).toHaveCount(4);
    await expect(page.getByTestId('mktg-kit-families').locator('article.border-blue-600')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-level')).toHaveText('—');
    await expect(page.getByTestId('mktg-kit-level-empty')).toHaveText('No approved assets yet');
    await expect(page.getByTestId('mktg-kit-core-floor')).toHaveText('0 of 4');
    await expect(page.getByTestId('mktg-kit-in-kit')).toHaveText('0 assets');
    await expect(page.getByTestId('mktg-kit-asset-icp')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-asset-boilerplates')).toContainText('Draft');
    await expect(page.getByTestId('mktg-kit-asset-messaging-framework')).toContainText('Draft');
    await expect(page.getByTestId('mktg-kit-families').locator('article h2')).toHaveText(
      MKTG_KIT_FAMILIES.filter(isMktgKitFamilyLive).map((family) => family.name)
    );
    await expect(page.getByTestId('mktg-kit-asset-quarterly-plan')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-asset-linkedin-post')).toContainText('1 this month');
    await page.getByTestId('filter-pill-approved').click();
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4);
    await expect(page.getByTestId('mktg-kit-family-positioning-brand')).toContainText('No assets in this state');
    await page.getByTestId('filter-pill-draft').click();
    await expect(page.getByTestId('mktg-kit-asset-brand-kit')).toContainText('Draft');
    const next = page.getByTestId('mktg-kit-next-step-action').getByRole('link');
    await expect(next).toHaveAttribute('href', /documents\/foundation-message\/living/);
    await next.click();
    await expect(page).toHaveURL(/documents\/foundation-message\/living/);
  });
  test('empty projects show never-run assets and hide unbuilt families and assets', async ({ page }) => {
    await setupKit(page);
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-in-kit')).toHaveText('0 assets');
    await expect(page.getByTestId('mktg-kit-asset-messaging-framework')).toContainText('Not run yet');
    await expect(page.getByTestId('mktg-kit-asset-boilerplates')).toContainText('Not run yet');
    await expect(page.getByTestId('mktg-kit-asset-faq')).toContainText('Not run yet');
    for (const family of MKTG_KIT_FAMILIES.filter((family) => !isMktgKitFamilyLive(family))) {
      await expect(page.getByTestId(`mktg-kit-family-${family.id}`)).toHaveCount(0);
    }
    await expect(page.getByTestId('mktg-kit-asset-pitch-deck')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-asset-one-pager')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-page')).not.toContainText('Coming soon');
    await expect(page.getByTestId('mktg-kit-summary')).not.toContainText('Open requests');
    await expect(page.getByTestId('mktg-kit-summary').locator(':scope > div')).toHaveCount(3);
    await expect(page.getByTestId('mktg-kit-asset-linkedin-post')).toContainText('Not run yet');
    await expect(page.getByTestId('mktg-kit-next-step')).toContainText('Nothing in the kit yet; create the messaging framework to start.');
    await expect(page.getByTestId('mktg-kit-next-step-action').getByRole('link')).toHaveAccessibleName('Create messaging framework');
    await expect(page.getByTestId('filter-pill-all')).toHaveCSS('background-color', 'rgb(236, 244, 255)');
    await page.screenshot({ path: test.info().outputPath('kit-next-step-empty.png'), fullPage: true });
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
  test('only Kit and Documents tabs appear; Requests and Access are hidden', async ({ page }) => {
    await setupKit(page);
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-families')).toBeVisible();
    await expect(page.getByTestId('mktg-kit-tabs').getByRole('link')).toHaveText(['Kit', 'Documents']);
    for (const path of ['requests', 'access']) await expect(page.getByTestId(`mktg-kit-tab-${path}`)).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-tab-soon')).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-tab-kit')).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ path: test.info().outputPath('kit-live-tabs.png'), fullPage: true });
  });
  test('Requests and Access deep links remain honest routed placeholders', async ({ page }) => {
    await setupKit(page);
    for (const tab of ['requests', 'access']) {
      await openKit(page, `/${tab}`);
      await expect(page.getByTestId('mktg-kit-placeholder-empty')).toContainText('comes with its own item');
      await expect(page.getByTestId('mktg-kit-header')).toContainText('Marketing kit');
      await expect(page.getByTestId('mktg-kit-placeholder-title')).toHaveText('Synthetic Kit Project');
      await expect(page.getByTestId(`mktg-kit-tab-${tab}`)).toHaveCount(0);
    }
  });
});
