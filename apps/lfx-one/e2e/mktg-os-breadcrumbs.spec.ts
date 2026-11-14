// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { kitTest as test, KIT_PROJECT, openKit, setupKit } from './helpers/mktg-kit.helper';

test.describe('Marketing OS absolute breadcrumbs', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('breadcrumbs-final.png'), fullPage: true });
  });
  for (const mount of ['project', 'foundation'] as const) {
    const root = `/${mount}/mktg-os-agents`;
    const project = `?project=${KIT_PROJECT.slug}`;
    const family = `${root}/families/positioning-brand${project}`;
    const asset = `${root}/documents/foundation-message/living${project}`;
    test(`${mount}: Kit → family → asset → family crumb → Kit crumb`, async ({ page }) => {
      await setupKit(page, { loaded: true });
      await openKit(page, '', mount);
      await expect(page.getByTestId('mktg-kit-page')).toBeVisible();
      await expect(page.getByTestId('mktg-breadcrumb')).toHaveCount(0);
      await page.getByTestId('mktg-kit-family-link-positioning-brand').click();
      await expect(page.getByTestId('mktg-breadcrumb-link-0')).toHaveAttribute('href', root + project);
      await expect(page.getByTestId('mktg-breadcrumb-current')).toHaveText('Positioning & brand');
      await page.getByTestId('mktg-family-open-messaging-framework').click();
      await expect(page).toHaveURL(new URL(asset, page.url()).href);
      await expect(page.getByTestId('mktg-breadcrumb-current')).toHaveText('Messaging framework');
      await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveAttribute('href', family);
      await page.getByTestId('mktg-breadcrumb-link-1').click();
      await expect(page).toHaveURL(new URL(family, page.url()).href);
      await page.goBack();
      await expect(page).toHaveURL(new URL(asset, page.url()).href);
      await expect(page.getByTestId('mktg-breadcrumb-link-0')).toHaveText(`${KIT_PROJECT.name} kit`);
      await expect(page.getByTestId('mktg-breadcrumb-link-0')).toHaveAttribute('href', root + project);
      await page.getByTestId('mktg-breadcrumb-link-0').click();
      await expect(page).toHaveURL(new URL(root + project, page.url()).href);
      await expect(page.getByTestId('mktg-kit-page')).toBeVisible();
    });

    test(`${mount}: Documents-entry asset keeps its fixed family, not Documents`, async ({ page }) => {
      await setupKit(page, { loaded: true });
      await openKit(page, '/documents', mount);
      await page.getByTestId('mktg-documents-all-open-foundation-message-living').click();
      await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveText('Positioning & brand');
      await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveAttribute('href', family);
      await page.getByTestId('mktg-breadcrumb-link-1').click();
      await expect(page).toHaveURL(new URL(family, page.url()).href);
      await expect(page.getByTestId('mktg-family-page')).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(new URL(asset, page.url()).href);
      await expect(page.getByTestId('mktg-breadcrumb-current')).toHaveText('Messaging framework');
    });

    for (const [tab, label] of [
      ['documents', 'Documents'],
      ['requests', 'Requests'],
      ['access', 'Access'],
    ]) {
      test(`${mount}: ${label} has one absolute Kit parent`, async ({ page }) => {
        await setupKit(page);
        await openKit(page, `/${tab}`, mount);
        await expect(page.getByTestId('mktg-breadcrumb-current')).toHaveText(label);
        await expect(page.getByTestId('mktg-breadcrumb').getByRole('link')).toHaveCount(1);
        await expect(page.getByTestId('mktg-breadcrumb-link-0')).toHaveAttribute('href', root + project);
        await page.getByTestId('mktg-breadcrumb-link-0').click();
        await expect(page).toHaveURL(new URL(root + project, page.url()).href);
        await page.goBack();
        await expect(page.getByTestId('mktg-breadcrumb-current')).toHaveText(label);
      });
    }

    test(`${mount}: generic run shows its asset label and fixed family links`, async ({ page }) => {
      await setupKit(page);
      await openKit(page, '/foundation-setup', mount);
      await expect(page.getByTestId('mktg-agent-run-page')).toBeVisible();
      await expect(page.getByTestId('mktg-breadcrumb-current')).toHaveText('Messaging framework');
      await expect(page.getByTestId('mktg-breadcrumb-link-0')).toHaveAttribute('href', root + project);
      await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveAttribute('href', family);
      await page.getByTestId('mktg-breadcrumb-link-1').click();
      await expect(page).toHaveURL(new URL(family, page.url()).href);
      await page.goBack();
      await expect(page.getByTestId('mktg-breadcrumb-current')).toHaveText('Messaging framework');
    });
  }
});
