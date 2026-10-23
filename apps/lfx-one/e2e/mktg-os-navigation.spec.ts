// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { BRAND_KIT_INTAKE, FOUNDATION_MESSAGE_INTAKE, MKTG_DOCUMENT_TYPES, MKTG_KIT_FAMILIES, MKTG_RUN_NEW_MODE } from '@lfx-one/shared/constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import {
  DOCUMENT_PROJECT,
  DOCUMENTS_URL,
  DOCUMENT_TYPE,
  DOCUMENT_VIEW_URL,
  setupDocuments,
  openDocuments,
  fulfillDocumentJson,
  documentFixture,
} from './helpers/mktg-os-documents.helper';
import { ASSET_PROJECT, openAssetDocument, openUnapprovedAssetDocument } from './helpers/mktg-os-asset-views.helper';
import { setupNoQuestionsHandoff } from './helpers/mktg-os-handoff.helper';
import { setupQuestionsNavigation } from './helpers/mktg-os-questions-navigation.helper';

test.describe('Marketing OS fixed-parent navigation', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('navigation-final.png'), fullPage: true });
  });

  test('Kit → Family → asset has the same linked parents as a shared asset URL', async ({ page }) => {
    await setupNoQuestionsHandoff(page);
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === FOUNDATION_MESSAGE_INTAKE.agentId);
    const asset = MKTG_KIT_FAMILIES.flatMap((family) => family.assets).find((entry) => entry.agentKey === type?.agentKey);
    if (!type || !asset) throw new Error('Missing registered Family framework asset');
    await openDocuments(page, `/project/mktg-os-agents/documents/${asset.agentKey}/living?project=${DOCUMENT_PROJECT.slug}`);
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb', exact: true });
    await expect(crumb).toContainText(`${DOCUMENT_PROJECT.name} kit`);
    await expect(crumb).toContainText('Positioning & brand');
    const familyHref = await crumb.getByTestId('mktg-breadcrumb-link-1').getAttribute('href');
    await crumb.getByTestId('mktg-breadcrumb-link-0').click();
    await page.getByTestId('mktg-kit-family-link-positioning-brand').click();
    await page.getByTestId(`mktg-family-open-${asset.id}`).click();
    await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveAttribute('href', familyHref ?? '');
    await page.getByTestId('mktg-breadcrumb-link-1').click();
    await expect(page.getByTestId('mktg-family-page')).toBeVisible();
  });

  test('a stored AEO/GEO run has a dated crumb and parents without type state', async ({ page }) => {
    await setupDocuments(page);
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === 'aeo-geo');
    const detail = documentFixture();
    const revision = detail.revisions.find((entry) => entry.latest);
    if (!type || !revision) throw new Error('Missing synthetic report fixture');
    await page.route('**/api/mktg-agents/documents/aeo-geo/**', (route) =>
      fulfillDocumentJson(route, {
        ...detail,
        type,
        documentId: 'run-synthetic-aeo',
        revision,
        markdown: '# Synthetic AEO/GEO report',
        sidecar: null,
      })
    );
    await openDocuments(
      page,
      `/project/mktg-os-agents/documents/aeo-geo/run-synthetic-aeo?project=${DOCUMENT_PROJECT.slug}&type=aeo-geo&revision=${revision.id}`
    );
    await expect(page.getByTestId('mktg-breadcrumb-current')).toHaveText(`${type.itemLabel} · 13 Oct 2026`);
    await expect(page.getByTestId('mktg-breadcrumb-link-0')).toHaveAttribute('href', `/project/mktg-os-agents?project=${DOCUMENT_PROJECT.slug}`);
    await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveAttribute(
      'href',
      `/project/mktg-os-agents/families/website-web?project=${DOCUMENT_PROJECT.slug}`
    );
    await expect(page.getByTestId('mktg-document-view-document')).toBeVisible();
  });

  test('Generate lands on the asset and Back returns to its Family, not the run page', async ({ page }, info) => {
    const fixture = await setupNoQuestionsHandoff(page);
    await openDocuments(page, DOCUMENT_VIEW_URL);
    await page.getByTestId('mktg-breadcrumb-link-0').click();
    await page.getByTestId('mktg-kit-family-link-positioning-brand').click();
    await page.getByTestId('mktg-family-run-brand-kit').getByRole('link').click();
    await fixture.openAndGenerate(false);
    fixture.startChecking();
    await expect(page.getByTestId('mktg-document-view-page')).toBeVisible();
    fixture.finish();
    await expect(page).toHaveURL(new RegExp('revision=' + fixture.revision.id));
    await expect(page.getByTestId('mktg-document-view-brand-kit')).toBeVisible();
    await page.screenshot({ path: info.outputPath('generate-landed-asset.png'), fullPage: true });
    await page.goBack();
    await expect(page.getByTestId('mktg-family-page')).toBeVisible();
  });

  test('Run again pushes a clean run URL and Back restores the asset', async ({ page }, info) => {
    await setupDocuments(page);
    await openDocuments(page, DOCUMENT_VIEW_URL + '&tab=sources&profile=edit');
    const assetUrl = page.url();
    await page.getByTestId('mktg-document-view-run-again').click();
    await expect(page.getByTestId('mktg-agent-run-page')).toBeVisible();
    expect(new URL(page.url()).search).toBe('?project=' + DOCUMENT_PROJECT.slug + '&mode=' + MKTG_RUN_NEW_MODE);
    await page.screenshot({ path: info.outputPath('run-again-intake.png'), fullPage: true });
    await page.goBack();
    await expect(page).toHaveURL(assetUrl);
    await expect(page.getByTestId('mktg-document-view-document')).toBeVisible();
  });

  test('direct Boilerplates questions select recorded progress and Back skips the form and questions', async ({ page }, info) => {
    test.setTimeout(60_000);
    const fixture = await setupQuestionsNavigation(page);
    try {
      await openDocuments(page, DOCUMENT_VIEW_URL);
      await page.getByTestId('mktg-breadcrumb-link-0').click();
      await page.getByTestId('mktg-kit-family-link-positioning-brand').click();
      await page.screenshot({ path: info.outputPath('direct-boilerplates-family.png'), fullPage: true });
      await page.getByTestId('mktg-family-run-boilerplates').getByRole('link').click();
      await page.screenshot({ path: info.outputPath('direct-boilerplates-sources.png'), fullPage: true });
      await page.getByTestId('mktg-run-start').getByRole('button').click();
      await expect(page.getByTestId('mktg-run-questions')).toContainText('Which synthetic goal?');
      await expect(page).not.toHaveURL(/\/documents\//);
      await page.screenshot({ path: info.outputPath('direct-boilerplates-questions.png'), fullPage: true });
      await page.getByTestId('mktg-run-questions-send').getByRole('button').click();
      await expect(page).toHaveURL(new RegExp('run=' + fixture.runId));
      for (const key of ['generation', 'questions', 'revision', 'mode']) expect.soft(new URL(page.url()).searchParams.has(key), key).toBe(false);
      await expect(page.getByTestId('mktg-document-view-run')).toContainText('Started');
      await page.screenshot({ path: info.outputPath('direct-boilerplates-recorded-progress.png'), fullPage: true });
      fixture.finish();
      await expect(page.getByTestId('mktg-document-view-boilerplates')).toBeVisible();
      await page.screenshot({ path: info.outputPath('direct-boilerplates-landed.png'), fullPage: true });
      await page.goBack();
      await expect(page.getByTestId('mktg-family-page')).toBeVisible();
      expect(fixture.posts).toEqual([fixture.intake.endpoints.generate, fixture.intake.endpoints.answers]);
    } finally {
      await info.attach('sanitized-history-trace.json', { body: '[' + fixture.historyTrace.join(',') + ']', contentType: 'application/json' });
    }
  });

  test('an automatic questions round-trip leaves Back pointing before the questions', async ({ page }, info) => {
    test.setTimeout(60_000);
    const fixture = await setupNoQuestionsHandoff(page);
    let ask = false;
    await page.route('**' + BRAND_KIT_INTAKE.endpoints.result, (route) =>
      ask
        ? fulfillDocumentJson(route, {
            status: 'questions',
            questionsId: 'navigation-q',
            questions: [{ key: 'voice', label: 'Voice', question: 'Which voice?', why: '', suggestedAnswer: 'Technical', basis: [] }],
          })
        : route.fallback()
    );
    if (!BRAND_KIT_INTAKE.endpoints.answers) throw new Error('Missing answers fixture endpoint');
    await page.route('**' + BRAND_KIT_INTAKE.endpoints.answers, (route) => {
      ask = false;
      fixture.finish();
      return fulfillDocumentJson(route, { success: true });
    });
    await openDocuments(page, DOCUMENT_VIEW_URL);
    await page.getByTestId('mktg-breadcrumb-link-0').click();
    await page.getByTestId('mktg-kit-family-link-positioning-brand').click();
    await page.getByTestId('mktg-family-run-brand-kit').getByRole('link').click();
    await fixture.openAndGenerate(false);
    fixture.startChecking();
    await expect(page.getByTestId('mktg-document-view-page')).toBeVisible();
    ask = true;
    await expect(page.getByTestId('mktg-run-questions')).toBeVisible();
    await page.getByTestId('mktg-run-questions-send').getByRole('button').click();
    await expect(page).toHaveURL(new RegExp('revision=' + fixture.revision.id));
    expect(fixture.posts).toEqual([BRAND_KIT_INTAKE.endpoints.generate, BRAND_KIT_INTAKE.endpoints.answers]);
    await expect(page.getByTestId('mktg-document-view-brand-kit')).toBeVisible();
    await page.screenshot({ path: info.outputPath('questions-landed-asset.png'), fullPage: true });
    await page.goBack();
    await expect(page.getByTestId('mktg-family-page')).toBeVisible();
  });

  test('Documents is the fourth tab, lists all assets and filters by type in the URL', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page);
    await page.getByTestId('mktg-kit-tab-documents').click();
    await expect(page.getByTestId('mktg-kit-tabs').getByRole('link')).toHaveCount(4);
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

  test('unrunnable redirects replace the rejected URL', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page);
    await page.evaluate((project) => {
      history.pushState({}, '', `/project/mktg-os-agents/not-catalogued?project=${project}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, DOCUMENT_PROJECT.slug);
    // No Agents tab any more: an unrunnable agent URL lands on the Kit.
    await expect(page.getByTestId('mktg-kit-page')).toBeVisible();
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
