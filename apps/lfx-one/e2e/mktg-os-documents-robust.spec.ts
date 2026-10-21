// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

import {
  DOCUMENT_PROJECT,
  DOCUMENT_TYPE,
  DOCUMENTS_URL,
  DOCUMENT_VIEW_URL,
  documentFixture,
  fulfillDocumentJson,
  openDocuments,
  setupDocuments,
  startedDocumentRun,
} from './helpers/mktg-os-documents.helper';

test.describe('Marketing OS Documents structure', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test.afterEach(async ({ page }, testInfo) => {
    await page.screenshot({ path: testInfo.outputPath('final-structure.png'), fullPage: true });
  });

  for (const width of [390, 1024]) {
    test(`recorded progress is a labelled, keyboard-accessible section at ${width}px`, async ({ page }) => {
      const run = startedDocumentRun('questions');
      await setupDocuments(page, { empty: true, runs: [run] });
      await page.setViewportSize({ width, height: 1000 });
      await openDocuments(page);
      const section = page.getByRole('region', { name: 'Started runs', exact: true });
      await expect(section).toBeVisible();
      await expect(section.getByRole('heading', { level: 2 })).toHaveText('Started runs');
      const open = section.getByTestId(`mktg-documents-open-started-${run.runId}`);
      await expect(open).toHaveAttribute('href', new RegExp(`run=${run.runId}`));
      await open.focus();
      await expect(open).toBeFocused();
      await open.press('Enter');
      await expect(page.getByTestId('mktg-document-view-live-state')).toHaveAttribute('aria-live', 'polite');
      await expect(page.getByTestId('mktg-document-view-live-state')).toHaveText('Waiting for your answers.');
      const intake = page.getByTestId('mktg-document-view-intake-link');
      await intake.focus();
      await expect(intake).toBeFocused();
      await expect(page.getByTestId('mktg-document-view-page').locator('h1')).toHaveCount(1);
      await expect(page.locator('main main')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    });
  }

  test('progress read failures have a retry warning, not fabricated active rows or an empty-history error', async ({ page }) => {
    await setupDocuments(page, { progressUnavailable: true });
    await openDocuments(page);
    await expect(page.getByTestId('mktg-documents-refresh-warning')).toContainText('Retrying');
    const refresh = page.getByTestId('mktg-documents-refresh-progress').getByRole('button');
    await expect(refresh).toHaveAttribute('type', 'button');
    await refresh.focus();
    await expect(refresh).toBeFocused();
    await expect(page.getByTestId('mktg-documents-started-runs')).toHaveCount(0);
    await expect(page.getByTestId('mktg-documents-revisions')).toBeVisible();
    await expect(page.getByTestId('mktg-documents-error')).toHaveCount(0);
  });

  test('uses one layout main, labelled sections, and a real revision list', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page, DOCUMENT_VIEW_URL);
    const root = page.getByTestId('mktg-document-view-page');
    // Wait for rendered document content, not just the shell: otherwise the h1
    // count can pass before the Markdown renderer has added its headings.
    await expect(page.getByTestId('mktg-document-view-document').getByRole('heading', { level: 2 })).toHaveText('Revision 2');
    await expect(root.locator('h1')).toHaveCount(1);
    await expect(root.locator('main, aside')).toHaveCount(0);
    await expect(page.locator('main main')).toHaveCount(0);
    await expect(root.getByRole('region', { name: 'Document content' })).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-revisions').locator('ol > li')).toHaveCount(3);
    await expect(page.getByTestId('mktg-document-view-restore-current')).toHaveCount(0);
  });

  test('loading does not claim empty counts; success produces semantic table headers', async ({ page }) => {
    await setupDocuments(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      /\/api\/mktg-agents\/documents\?/,
      async (route) => {
        await gate;
        await fulfillDocumentJson(route, { project: 'synthetic', groups: [] });
      },
      { times: 1 }
    );
    await openDocuments(page);
    await expect(page.getByTestId('mktg-documents-loading')).toBeVisible();
    await expect(page.getByTestId('mktg-documents-empty-living')).toHaveCount(0);
    release();
    await expect(page.getByTestId('mktg-documents-empty-living')).toBeVisible();
    await openDocuments(page, DOCUMENT_VIEW_URL);
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 2');
    await page.getByTestId('mktg-breadcrumb-link-0').click();
    await expect(page).toHaveURL(`/project/mktg-os-agents?project=${DOCUMENT_PROJECT.slug}`);
    // Enter via the fourth tab, then select the type to exercise content-ready scrolling.
    await page.getByTestId('mktg-kit-tab-documents').click();
    await page.getByTestId(`mktg-documents-nav-${DOCUMENT_TYPE.agentKey}`).click();
    await expect(page.getByTestId('mktg-documents-revisions').locator('th[scope="col"]')).toHaveCount(5);
    await expect(page.getByTestId('mktg-documents-page').locator('main, aside')).toHaveCount(0);
  });

  for (const width of [390, 1280, 1440]) {
    test(`the history bar stays slim and pinned above long content at ${width}px`, async ({ page }) => {
      await setupDocuments(page, { revisionCount: 9, currentRevisionNumber: 9, longDocument: true });
      await page.setViewportSize({ width, height: 1000 });
      await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture(9, 9).revisions[2].id}`);
      const bar = page.getByTestId('mktg-document-view-history-bar');
      const article = page.getByTestId('mktg-document-view-document');
      await expect(article.getByRole('heading', { level: 3 })).toHaveCount(24);
      await expect(bar).toBeVisible();
      const barBox = await bar.boundingBox();
      const articleBox = await article.boundingBox();
      if (!barBox || !articleBox) throw new Error('The bar and document must be rendered before measuring');
      expect(barBox.height).toBeGreaterThanOrEqual(32);
      expect(barBox.height).toBeLessThanOrEqual(36);
      expect(articleBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);
      if (width === 390) {
        await expect(page.getByTestId('mktg-document-view-history-bar-mobile-summary')).toBeVisible();
        await expect(page.getByTestId('mktg-document-view-history-bar-summary')).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      } else {
        await expect(page.getByTestId('mktg-document-view-history-bar-summary')).toBeVisible();
      }
      await bar.evaluate((element) => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top + 200));
      const expectedTop = width === 390 ? 57 : 0;
      await expect.poll(async () => Math.round((await bar.boundingBox())?.y ?? -1)).toBe(expectedTop);
      await expect(page.getByTestId('mktg-document-view-history-bar-make-current')).toBeInViewport();
      await expect(page.getByTestId('mktg-document-view-history-bar-back')).toBeInViewport();
      await expect(page.getByTestId('mktg-document-view-restore-current')).toHaveCount(0);
    });
  }

  for (const width of [390, 768, 1000, 1024, 1264, 1280, 1440]) {
    test(`revision actions and body remain visible at ${width}px`, async ({ page }) => {
      await setupDocuments(page);
      await page.setViewportSize({ width, height: 1000 });
      await openDocuments(page, DOCUMENT_VIEW_URL);
      await expect(page.getByTestId('mktg-document-view-document')).toBeVisible();
      await expect(page.getByTestId('mktg-document-view-revisions')).toBeVisible();
      await expect(page.getByTestId('mktg-document-view-open-1')).toBeVisible();
      if (width >= 1024) await expect(page.getByTestId('sidebar')).toBeVisible();
      const sideBySide = width === 1000 || width >= 1264;
      const root = page.getByTestId('mktg-document-view-page');
      const content = await root.getByRole('region', { name: 'Document content' }).boundingBox();
      const details = await root.getByRole('region', { name: 'Revision details' }).boundingBox();
      const label = await page.getByTestId('mktg-document-view-revision-label-3').boundingBox();
      const open = await page.getByTestId('mktg-document-view-open-3').boundingBox();
      if (!content || !details || !label || !open) throw new Error('Document layout must be rendered before measuring it');
      const availableWidth = await page.getByTestId('mktg-document-view-width').evaluate((element) => element.clientWidth);
      const viewDiagnostic = `viewport ${width}px, document-view host ${availableWidth}px`;
      if (sideBySide) {
        expect(details.x, viewDiagnostic).toBeGreaterThanOrEqual(content.x + content.width);
        expect(Math.abs(details.y - content.y), viewDiagnostic).toBeLessThan(2);
      } else {
        expect(details.y, viewDiagnostic).toBeGreaterThanOrEqual(content.y + content.height);
      }
      expect(Math.abs(open.y - label.y)).toBeLessThan(2);
      await expect(page.getByTestId('mktg-document-view-current-2')).toBeAttached();
      const actions = await page.getByTestId('mktg-document-view-row-actions-3').boundingBox();
      if (!actions) throw new Error('Revision actions must be rendered before measuring their column');
      expect(actions.width).toBeGreaterThan(40);
      expect(actions.width).toBeLessThanOrEqual(64);
      await page.getByTestId('mktg-breadcrumb-link-0').click();
      await expect(page).toHaveURL(`/project/mktg-os-agents?project=${DOCUMENT_PROJECT.slug}`);
      // Keep the Kit URL assertion, then exercise the real tab → type-pick scroll path.
      await page.getByTestId('mktg-kit-tab-documents').click();
      await page.getByTestId(`mktg-documents-nav-${DOCUMENT_TYPE.agentKey}`).click();
      await expect(page).toHaveURL(new RegExp(DOCUMENTS_URL.split('?')[0]));
      await expect(page.getByTestId('mktg-documents-revisions')).toBeVisible();
      await expect(page.getByTestId('mktg-documents-page').locator('main')).toHaveCount(0);
      await expect(page.getByTestId('mktg-documents-revision-when-2').getByTestId('mktg-documents-current-2')).toHaveCount(0);
      await expect(page.getByTestId('mktg-documents-revision-actions-2').getByTestId('mktg-documents-current-2')).toBeAttached();
      const documentsWidth = await page.getByTestId('mktg-documents-width').evaluate((element) => element.clientWidth);
      const navigation = await page.getByTestId('mktg-documents-nav').boundingBox();
      const documentPanel = await page.getByRole('region', { name: 'Documents and revisions' }).boundingBox();
      if (!navigation || !documentPanel) throw new Error('Documents navigation and content must be rendered before measuring');
      const documentsDiagnostic = `viewport ${width}px, documents host ${documentsWidth}px`;
      if (sideBySide) expect(documentPanel.x, documentsDiagnostic).toBeGreaterThanOrEqual(navigation.x + navigation.width);
      else expect(documentPanel.y, documentsDiagnostic).toBeGreaterThanOrEqual(navigation.y + navigation.height);
      if (width === 1280) {
        const scroller = page.getByTestId('mktg-documents-revisions-scroll');
        const visible = await scroller.boundingBox();
        const actionsCell = await page.getByTestId('mktg-documents-revision-actions-3').boundingBox();
        const makeCurrent = await page.getByTestId('mktg-documents-restore-3').boundingBox();
        if (!visible || !actionsCell || !makeCurrent) throw new Error('Desktop table actions must be rendered before measuring');
        expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(0);
        expect(await scroller.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        expect(actionsCell.x).toBeGreaterThanOrEqual(visible.x);
        expect(actionsCell.x + actionsCell.width).toBeLessThanOrEqual(visible.x + visible.width + 1);
        expect(makeCurrent.x + makeCurrent.width).toBeLessThanOrEqual(visible.x + visible.width + 1);
      }
      if (width === 390) {
        const pageWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
        expect(pageWidth).toBeLessThanOrEqual(width);
        const scroller = page.getByTestId('mktg-documents-revisions-scroll');
        expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
        await scroller.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        await expect(page.getByTestId('mktg-documents-current-2')).toBeInViewport();
        await scroller.evaluate((element) => {
          element.scrollLeft = 0;
        });
      }
    });
  }
});
