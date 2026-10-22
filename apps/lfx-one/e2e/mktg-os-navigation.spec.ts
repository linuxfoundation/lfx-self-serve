// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { FOUNDATION_MESSAGE_INTAKE, MKTG_DOCUMENT_TYPES } from '@lfx-one/shared/constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { DOCUMENT_PROJECT, DOCUMENTS_URL, DOCUMENT_TYPE, DOCUMENT_VIEW_URL, setupDocuments, openDocuments } from './helpers/mktg-os-documents.helper';
import { ASSET_PROJECT, openAssetDocument, openUnapprovedAssetDocument } from './helpers/mktg-os-asset-views.helper';

test.describe('Marketing OS fixed-parent navigation', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('navigation-final.png'), fullPage: true });
  });

  test('Kit → Family → asset has the same linked parents as a shared asset URL', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page, DOCUMENT_VIEW_URL);
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
    await expect(crumb).toContainText(`${DOCUMENT_PROJECT.name} kit`);
    await expect(crumb).toContainText('Positioning & brand');
    const familyHref = await crumb.getByTestId('mktg-breadcrumb-link-1').getAttribute('href');
    await crumb.getByTestId('mktg-breadcrumb-link-0').click();
    await page.getByTestId('mktg-kit-family-link-positioning-brand').click();
    await page.getByTestId(`mktg-family-open-${DOCUMENT_TYPE.agentKey}`).click();
    await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveAttribute('href', familyHref ?? '');
    await page.getByTestId('mktg-breadcrumb-link-1').click();
    await expect(page.getByTestId('mktg-family-page')).toBeVisible();
  });

  test('Documents is the fifth tab, lists all assets and filters by type in the URL', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page);
    await page.getByTestId('mktg-kit-tab-documents').click();
    await expect(page.getByTestId('mktg-kit-tabs').getByRole('link')).toHaveCount(5);
    await expect(page.getByTestId('mktg-documents-all')).toContainText(DOCUMENT_TYPE.label);
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.kind === 'run');
    if (!type) throw new Error('Synthetic navigation test requires a catalog run type');
    await page.getByTestId(`mktg-documents-nav-${type.agentKey}`).click();
    await expect(page).toHaveURL(new RegExp(`type=${type.agentKey}`));
    await expect(page.getByTestId('mktg-documents-empty-runs')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('mktg-documents-all')).toBeVisible();
  });

  test('user state filters push history and Back returns through each filter without bouncing', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page);
    await page.getByTestId('mktg-breadcrumb-link-0').click();
    await page.getByTestId('filter-pill-draft').click();
    await expect(page).toHaveURL(/state=draft/);
    await page.getByTestId('filter-pill-approved').click();
    await expect(page).toHaveURL(/state=approved/);
    await page.goBack();
    await expect(page).toHaveURL(/state=draft/);
    await page.goBack();
    await expect(page.getByTestId('mktg-kit-page')).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]state=/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(DOCUMENTS_URL.split('?')[0]));
    await expect(page.getByTestId('mktg-documents-page')).toBeVisible();
  });

  test('Agents → generic run has linked Family and Kit parents', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page);
    await page.getByTestId('mktg-kit-tab-agents').click();
    await page.getByTestId(`mktg-os-agents-tile-${FOUNDATION_MESSAGE_INTAKE.agentId}`).click();
    await expect(page.getByTestId('mktg-agent-run-page')).toBeVisible();
    await expect(page.getByTestId('mktg-breadcrumb-link-1')).toContainText('Positioning & brand');
    await expect(page.getByTestId('mktg-agent-run-back-button')).toHaveCount(0);
    await page.goBack();
    await expect(page.getByTestId('mktg-os-agents-page')).toBeVisible();
  });

  test('unrunnable redirects replace the rejected URL', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page);
    await page.evaluate((project) => {
      history.pushState({}, '', `/project/mktg-os-agents/not-catalogued?project=${project}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, DOCUMENT_PROJECT.slug);
    await expect(page.getByTestId('mktg-os-agents-page')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('mktg-documents-page')).toBeVisible();
  });

  for (const key of ['boilerplates', 'faq'] as const) {
    test(`${key} loads a tab URL, pushes switches and returns to the previous tab with Back`, async ({ page }) => {
      await openAssetDocument(page, key);
      await page.evaluate(() => {
        const url = new URL(location.href);
        url.searchParams.set('tab', 'sources');
        url.searchParams.set('profile', 'edit');
        history.pushState({}, '', url);
        dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(page.getByTestId(`mktg-${key}-view-tab-sources`)).toHaveAttribute('aria-selected', 'true');
      const length = await page.evaluate(() => history.length);
      await page.getByTestId(`mktg-${key}-view-tab-${key}`).click();
      await expect(page).not.toHaveURL(/[?&]tab=/);
      await expect(page).toHaveURL(/profile=edit/);
      expect(await page.evaluate(() => history.length)).toBe(length + 1);
      await expect(page.getByTestId(`mktg-${key}-view-tab-${key}`)).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId(`mktg-${key}-view-panel-${key}`)).toBeFocused();
      await page.goBack();
      await expect(page).toHaveURL(/tab=sources/);
      await expect(page.getByTestId(`mktg-${key}-view-tab-sources`)).toHaveAttribute('aria-selected', 'true');
    });
  }

  test('Brand Kit pushes chapter switches and Back returns to the previous chapter', async ({ page }) => {
    await openUnapprovedAssetDocument(page, 'brand-kit');
    await page.evaluate(() => {
      const url = new URL(location.href);
      url.searchParams.set('tab', 'color');
      history.pushState({}, '', url);
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByTestId('brand-kit-web-view-tab-color')).toHaveAttribute('aria-selected', 'true');
    const length = await page.evaluate(() => history.length);
    await page.getByTestId('brand-kit-web-view-tab-logo').click();
    await expect(page).toHaveURL(/tab=logo/);
    expect(await page.evaluate(() => history.length)).toBe(length + 1);
    await expect(page.getByTestId('brand-kit-web-view-tab-logo')).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await expect(page.getByTestId('brand-kit-web-view-tab-color')).toHaveAttribute('aria-selected', 'true');
  });

  test('framework tabs push shareable URLs and Back restores each previous panel', async ({ page }) => {
    await openUnapprovedAssetDocument(page, 'foundation-message');
    await expect(page.getByTestId('mktg-framework-view')).toBeVisible();
    await page.getByTestId('mktg-framework-view-tab-icps').click();
    await expect(page).toHaveURL(/tab=icps/);
    await expect(page.getByTestId('mktg-framework-view-panel-icps')).toBeFocused();
    await page.getByTestId('mktg-framework-view-tab-sources').click();
    await expect(page).toHaveURL(/tab=sources/);
    await expect(page).toHaveURL(new RegExp(`project=${ASSET_PROJECT.slug}`));
    await page.goBack();
    await expect(page).toHaveURL(/tab=icps/);
    await expect(page.getByTestId('mktg-framework-view-tab-icps')).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await expect(page).not.toHaveURL(/[?&]tab=/);
    await expect(page.getByTestId('mktg-framework-view-tab-framework')).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await expect(page).toHaveURL(/documents\/faq\/living/);
    await expect(page.getByTestId('mktg-document-view-page')).toBeVisible();
  });
});
