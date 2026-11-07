// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { AUDIT_PROJECT, PAGE_LOAD_TIMEOUT, setupAudit } from './helpers/mktg-os-aeo-geo.helper';
import { aeoGeoEnvelopeFixture } from '@lfx-one/shared/utils/aeo-geo.fixture';
import { FOUNDATION_MESSAGE_PRINT_BODY_CLASS } from '@lfx-one/shared/constants';
import { expectMktgPrintFrame, finishMktgPrintFrame, mktgPrintFrame, stubMktgPrintFrame } from './helpers/mktg-print.helper';

test.describe('AEO/GEO audit content', () => {
  test('empty intake history, normalized domain, and blank or 2–5 key pages', async ({ page }, testInfo) => {
    const app = await setupAudit(page); // Includes suppressCookieBanner(page) and synthetic API/writer stubs.
    await app.go('/aeo-geo');
    await expect(page.getByTestId('mktg-aeo-run-empty')).toBeVisible();
    await expect(page.getByText('Audited as project.example;', { exact: false })).toBeVisible();
    const submit = page.getByTestId('mktg-aeo-run-submit').getByRole('button', { name: 'Start the audit', exact: true });
    await expect(submit).toBeEnabled();
    await expect(page.getByTestId('mktg-aeo-run-page').getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Synthetic Audit Project kit');
    await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveText('Website & web');
    for (const [index, url] of [
      [0, /\/mktg-os-agents\?project=/],
      [1, /\/families\/website-web\?project=/],
    ] as const) {
      await page.getByTestId(`mktg-breadcrumb-link-${index}`).click();
      await expect(page).toHaveURL(url);
      await page.goBack();
      await expect(page.getByTestId('mktg-aeo-run-form')).toBeVisible();
    }
    await page.getByLabel('Key page 1', { exact: true }).fill('https://project.example/about');
    await expect(submit).toBeEnabled();
    await submit.click();
    expect(app.sessions.size).toBe(0);
    await expect(page.getByTestId('mktg-aeo-run-pages-error')).toContainText('Add at least one more');
    await page.getByLabel('Key page 2', { exact: true }).fill('https://project.example/about');
    await expect(page.getByTestId('mktg-aeo-run-pages-error')).toContainText('repeats');
    await page.getByLabel('Key page 2', { exact: true }).fill('ftp://project.example/faq');
    await expect(page.getByTestId('mktg-aeo-run-pages-error')).toContainText('http(s)');
    await page.getByLabel('Key page 2', { exact: true }).fill('https://project.example/faq');
    await expect(submit).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('valid-intake.png'), fullPage: true });
  });

  test('Generate opens the document, waits for storage, and every new audit is a separate document', async ({ page }, testInfo) => {
    const app = await setupAudit(page);
    await app.go('/aeo-geo');
    const submission = page.waitForRequest((request) => request.url().endsWith('/aeo-geo/generate'));
    await page.getByTestId('mktg-aeo-run-submit').click();
    expect((await submission).postDataJSON().answers).toMatchObject({ project_name: AUDIT_PROJECT.name, project_uid: AUDIT_PROJECT.uid });
    await expect(page).toHaveURL(/\/aeo-geo\?project=/);
    await expect(page.getByTestId('mktg-aeo-run-activity')).toBeVisible();
    await expect(page).not.toHaveURL(/ownerToken|sessionId|synthetic-owner-proof/);
    app.state.reportReady = true;
    await expect(page).toHaveURL(/\/documents\/aeo-geo\/run-/, { timeout: PAGE_LOAD_TIMEOUT });
    await page.waitForResponse((response) => response.url().endsWith('/aeo-geo/result'));
    await expect(page.getByTestId('mktg-document-view-generating')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    app.state.persisted = true;
    await expect(page.getByTestId('mktg-document-view-verdict')).toHaveText('Strong basics, thin external authority', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-overall')).toContainText('6.5');
    await expect(page.getByTestId('mktg-document-view-audit-subline')).toContainText('no key pages named, 5 audited');
    const firstUrl = page.url();
    await page.getByTestId('mktg-document-view-run-again').click();
    await expect(page.getByTestId('mktg-aeo-run-previous-row')).toHaveCount(1);
    await page.getByTestId('mktg-aeo-run-submit').click();
    await expect(page.getByTestId('mktg-document-view-verdict')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    expect(page.url()).not.toBe(firstUrl);
    expect(app.documents.size).toBe(2);
    await expect(page.getByTestId('mktg-document-view-revisions')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('stored-new-report.png'), fullPage: true });
  });

  test('keeps the live research feed on the run page before the report is ready', async ({ page }, testInfo) => {
    const app = await setupAudit(page);
    app.state.showActivity = true;
    await app.go('/aeo-geo');
    await page.getByTestId('mktg-aeo-run-submit').click();
    await expect(page.getByTestId('mktg-aeo-run-activity')).toContainText('Reading project.example', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    await expect(page.getByTestId('mktg-run-activity-phase-questions')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('audit-live-feed.png'), fullPage: true });
  });

  test('opens an earlier report, prints PDF in an isolated frame instead of Markdown, and offers a fresh run', async ({ page }, testInfo) => {
    await stubMktgPrintFrame(page);
    const app = await setupAudit(page, { previous: true });
    await app.go('/aeo-geo');
    await expect(page.getByTestId('mktg-aeo-run-history-label')).toContainText('1 previous run');
    await expect(page.getByTestId('mktg-aeo-run-history-label')).not.toContainText('1 previous runs');
    await page.getByRole('link', { name: 'Open report from', exact: false }).click();
    await expect(page.getByTestId('mktg-document-view-verdict')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-audit-subline')).toContainText('2 key pages named, 5 audited');
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Add a detailed FAQ');
    await expect(page.getByTestId('mktg-breadcrumb-link-0')).toHaveText(`${AUDIT_PROJECT.name} kit`);
    await expect(page.getByTestId('mktg-breadcrumb-link-0')).toHaveAttribute('href', `/project/mktg-os-agents?project=${AUDIT_PROJECT.slug}`);
    await expect(page.getByTestId('mktg-breadcrumb-link-1')).toHaveAttribute(
      'href',
      `/project/mktg-os-agents/families/website-web?project=${AUDIT_PROJECT.slug}`
    );
    const downloads: string[] = [];
    page.on('download', (download) => downloads.push(download.suggestedFilename()));
    await expect(page.getByTestId('mktg-document-view-download')).toHaveText('Download PDF');
    const frameCreatedSynchronously = await page
      .getByTestId('mktg-document-view-download')
      .getByRole('button')
      .evaluate((button) => {
        if (!(button instanceof HTMLButtonElement)) throw new Error('Missing synthetic report PDF action');
        button.click();
        return document.querySelector<HTMLIFrameElement>('[data-testid="lfx-print-frame"]')?.contentDocument?.body.className ?? '';
      });
    expect(frameCreatedSynchronously).toContain(FOUNDATION_MESSAGE_PRINT_BODY_CLASS);
    await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, '[data-testid="mktg-document-view-print"]');
    await expect(page.getByTestId('mktg-document-view-print')).toContainText('Add a detailed FAQ');
    // The report prints through one flowing sheet row: the sheet's head gives every page its top room and the row its
    // bottom room (Chromium), or the page margins do (WebKit), as for the asset prints.
    const printArticle = mktgPrintFrame(page).locator('[data-testid="mktg-document-view-print"] article.lfx-framework-print');
    await expect(
      printArticle.locator(':scope > lfx-mktg-print-sheet > .lfx-print-sheet-body > lfx-mktg-print-sheet-row.lfx-print-sheet-row-flows')
    ).toHaveCount(1);
    await expect(printArticle.getByTestId('mktg-print-sheet-head')).toHaveCount(1);
    await expect(printArticle.getByTestId('mktg-print-sheet-foot')).toHaveCount(0);
    // The row holds the print hero and the report: this fixture's earlier report is Markdown (no typed report), so the
    // document view's @else renders it through lfx-markdown-renderer; a typed one would render lfx-aeo-geo-report.
    await expect(printArticle.locator('lfx-mktg-print-sheet-row [data-testid="mktg-document-view-print-overall"]')).toHaveCount(1);
    await expect(printArticle.locator('lfx-mktg-print-sheet-row :is(lfx-aeo-geo-report, lfx-markdown-renderer)')).toHaveCount(1);
    expect(downloads).toHaveLength(0);
    await finishMktgPrintFrame(page);
    await expect(page.getByTestId('mktg-document-view-run-again')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('reopened-report.png'), fullPage: true });
  });

  test('prints the typed report with its title first, the running head, code spans as code and a spaced source role', async ({ page }, testInfo) => {
    await stubMktgPrintFrame(page);
    const app = await setupAudit(page, { previous: true, typed: true });
    const recorded = aeoGeoEnvelopeFixture().report;
    if (!recorded) {
      throw new Error('Recorded report fixture is missing.');
    }
    await app.go('/aeo-geo');
    await page.getByRole('link', { name: 'Open report from', exact: false }).click();
    await expect(page.getByTestId('mktg-document-view-verdict')).toHaveText(recorded.verdict);
    // The web view renders the finding's Markdown code span as code, with no literal backtick (the same renderer prints).
    const webDetail = page.getByTestId('mktg-document-view-report-summary').getByTestId('mktg-aeo-typed-finding-detail-0');
    await expect(webDetail.locator('code')).toHaveText('User-agent: *');
    await expect(webDetail).not.toContainText('`');
    await page.getByTestId('mktg-document-view-download').getByRole('button').click();
    await expectMktgPrintFrame(page, FOUNDATION_MESSAGE_PRINT_BODY_CLASS, '[data-testid="mktg-document-view-print"]');
    const printArticle = mktgPrintFrame(page).locator('[data-testid="mktg-document-view-print"] article.lfx-framework-print');
    // The title opens the report: the first text of the sheet's body (its head group carries the running head), before the
    // score card the web view leads with.
    const headline = printArticle.getByTestId('mktg-document-view-print-headline');
    await expect(headline).toHaveText(recorded.headline);
    await expect(printArticle.locator('lfx-aeo-geo-report h2')).toHaveCount(0);
    expect(
      await headline.evaluate((title) => {
        const body = title.closest('.lfx-print-sheet-body');
        const overall = body?.querySelector('[data-testid="mktg-document-view-print-overall"]');
        const walker = body && body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let firstText: Node | null = null;
        while (walker && (firstText = walker.nextNode())) {
          if (firstText.textContent?.trim()) break;
        }
        return {
          firstTextInTitle: !!firstText && title.contains(firstText),
          titleBeforeOverall: !!overall && !!(title.compareDocumentPosition(overall) & Node.DOCUMENT_POSITION_FOLLOWING),
        };
      })
    ).toEqual({ firstTextInTitle: true, titleBeforeOverall: true });
    await expect(printArticle.getByTestId('mktg-document-view-print-subline')).toContainText('AEO/GEO report — 15 Oct 2026 · 2 key pages named');
    await expect(printArticle.getByTestId('mktg-document-view-print-subline')).not.toContainText('stored under');
    // The running head sits in the sheet's head group (repeated per page by Chromium): project, document, date; no version.
    const runningHead = printArticle.getByTestId('mktg-print-sheet-head').getByTestId('mktg-print-running-head');
    await expect(runningHead).toHaveText(`${AUDIT_PROJECT.name} AEO/GEO report · 15 Oct 2026`);
    await expect(runningHead).not.toContainText(/version|v1/i);
    await expect(printArticle.getByTestId('mktg-print-sheet-foot')).toHaveCount(0);
    // The code span prints as code, and the article's text carries no literal backtick: neither in the text nor drawn by the
    // typography plugin's `code::before`/`code::after` pseudo-content, which the report's stylesheet switches off.
    const printedCode = printArticle.getByTestId('mktg-aeo-typed-finding-detail-0').locator('code');
    await expect(printedCode).toHaveText('User-agent: *');
    await expect(printArticle).not.toContainText('`');
    expect(
      await printedCode.evaluate((code) => ({
        before: getComputedStyle(code, '::before').content,
        after: getComputedStyle(code, '::after').content,
      }))
    ).toEqual({ before: 'none', after: 'none' });
    // A space between the source link and its role, and the finding and recommendation blocks are kept whole on a page.
    await expect(printArticle.getByTestId('mktg-aeo-typed-sources').locator('li').first()).toHaveText(
      `${recorded.sources[0].url} (${recorded.sources[0].role})`
    );
    await expect(printArticle.getByTestId('mktg-aeo-typed-findings').locator('.lfx-aeo-report-block').first()).toHaveCSS('break-inside', 'avoid');
    await expect(printArticle.getByTestId('mktg-aeo-typed-findings').locator('h3')).toHaveCSS('break-after', 'avoid');
    await page.screenshot({ path: testInfo.outputPath('typed-report-print.png'), fullPage: true });
  });

  test('asks one round on the run page, resumes it on re-entry, then writes and renders a typed report on the document', async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile-chrome';
    await page.setViewportSize({ width: mobile ? 390 : 1440, height: 900 });
    const app = await setupAudit(page, { questions: true, typed: true });
    await app.go('/aeo-geo');
    await page.getByTestId('mktg-aeo-run-submit').click();
    await expect(page.getByTestId('mktg-run-questions-progress')).toContainText('Question 1 of 4', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page).toHaveURL(/\/aeo-geo\?project=/);
    await app.go('');
    await app.go('/aeo-geo');
    await expect(page.getByTestId('mktg-run-questions-progress')).toContainText('Question 1 of 4', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByRole('button', { name: /skip/i })).toHaveCount(0);
    await page.getByTestId('mktg-run-questions-next').click();
    await expect(page.getByTestId('mktg-run-questions-progress')).toContainText('Question 2 of 4');
    await page.getByTestId('mktg-run-questions-back').click();
    await expect(page.getByTestId('mktg-run-questions-progress')).toContainText('Question 1 of 4');
    await page.getByTestId('mktg-run-questions-next').click();
    await expect(page.getByTestId('mktg-run-questions-progress')).toContainText('Question 2 of 4');
    await page.locator('textarea[data-test="mktg-run-questions-answer-aeo-comparison-targets"]').fill('Another synthetic comparison target.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('mktg-run-questions-progress')).toContainText('Question 2 of 4', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.locator('textarea[data-test="mktg-run-questions-answer-aeo-comparison-targets"]')).toHaveValue('Another synthetic comparison target.');
    await page.getByTestId('mktg-run-questions-next').click();
    await expect(page.getByTestId('mktg-run-questions-progress')).toContainText('Question 3 of 4');
    await page.getByTestId('mktg-run-questions-next').click();
    await expect(page.getByTestId('mktg-run-questions-progress')).toContainText('Question 4 of 4');
    await page.getByTestId('mktg-run-questions-send').click();
    await expect(page).toHaveURL(/\/documents\/aeo-geo\/run-/, { timeout: PAGE_LOAD_TIMEOUT });
    expect(app.answers).toHaveLength(1);
    expect(app.sessions.size).toBe(1);
    expect(app.sessions.get(app.answers[0].sessionId)).toBe(app.answers[0].documentId);
    expect(app.answers[0].answers.map((answer) => answer.id)).toEqual(['audience', 'comparison-targets', 'priority-queries', 'project-identity']);
    expect(app.answers[0].answers.map((answer) => answer.origin)).toEqual(['accepted', 'edited', 'accepted', 'accepted']);
    await expect(page.getByTestId('mktg-document-view-generating')).toBeVisible();
    const documentPath = new URL(page.url()).pathname.replace('/project/mktg-os-agents', '');
    await app.go('');
    await app.go(documentPath);
    await expect(page.getByTestId('mktg-document-view-generating')).toBeVisible();
    app.state.reportReady = true;
    app.state.persisted = true;
    const recorded = aeoGeoEnvelopeFixture().report;
    if (!recorded) {
      throw new Error('Recorded report fixture is missing.');
    }
    const report = page.getByTestId('mktg-document-view-report-summary').getByTestId('mktg-aeo-typed-report');
    await expect(report.getByTestId('mktg-aeo-typed-findings')).toContainText(recorded.findings[0].title, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(report.getByTestId('mktg-aeo-typed-findings').getByRole('heading', { level: 4 })).toHaveCount(5);
    await expect(page.getByTestId('mktg-document-view-overall')).toContainText(recorded.overall_score.toFixed(1));
    await expect(page.getByTestId('mktg-document-view-verdict')).toHaveText(recorded.verdict);
    for (const row of recorded.scorecard) await expect(page.getByTestId(`mktg-document-view-score-${row.key}`)).toContainText(`${row.score}/10`);
    await expect(page.getByTestId('mktg-document-view-print-overall')).toContainText(recorded.overall_score.toFixed(1));
    await expect(page.getByTestId('mktg-document-view-about')).toBeVisible();
    const reportBox = await page.getByTestId('mktg-document-view-report-summary').boundingBox();
    const aboutBox = await page.getByTestId('mktg-document-view-about').boundingBox();
    if (!reportBox || !aboutBox) throw new Error('Audit report and About must have visible layout boxes.');
    if (mobile) expect(aboutBox.y).toBeGreaterThanOrEqual(reportBox.y + reportBox.height);
    else expect(aboutBox.x).toBeGreaterThanOrEqual(reportBox.x + reportBox.width);
    await expect(report.getByTestId('mktg-aeo-typed-recommendations')).toContainText(recorded.recommendations[0].title);
    await expect(report.getByTestId('mktg-aeo-typed-caveats')).toContainText(recorded.caveats[0]);
    await expect(report.getByTestId('mktg-aeo-typed-sources')).toContainText('https://project.example/');
    await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('typed-audit-report.png'), fullPage: true });
  });

  test('a document-side refusal clears writing recovery and permits a fresh audit', async ({ page }, testInfo) => {
    const app = await setupAudit(page);
    app.state.reportReady = true;
    await app.go('/aeo-geo');
    await page.getByTestId('mktg-aeo-run-submit').click();
    await expect(page).toHaveURL(/\/documents\/aeo-geo\/run-/, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-generating')).toBeVisible();
    app.state.refused = true;
    await expect(page.getByTestId('mktg-document-view-error')).toContainText('confirm the domain?', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-document-view-generating')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-retry')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('document-refusal.png'), fullPage: true });
    await page.getByTestId('mktg-document-view-run-again').click();
    await expect(page.getByTestId('mktg-aeo-run-submit').getByRole('button')).toBeEnabled();
    await expect(page).toHaveURL(/\/aeo-geo\?project=/);
    expect(app.sessions.size).toBe(1);
    await page.screenshot({ path: testInfo.outputPath('fresh-audit-after-refusal.png'), fullPage: true });
  });

  test('a domain-confirmation refusal stays on the run page with the actual failure text', async ({ page }, testInfo) => {
    const app = await setupAudit(page);
    app.state.refused = true;
    await app.go('/aeo-geo');
    await page.getByTestId('mktg-aeo-run-submit').click();
    await expect(page.getByTestId('mktg-aeo-run-error')).toContainText('confirm the domain?', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mktg-run-questions')).toHaveCount(0);
    expect(app.documents.size).toBe(0);
    await expect(page).toHaveURL(/\/aeo-geo\?project=/);
    await page.screenshot({ path: testInfo.outputPath('domain-refusal.png'), fullPage: true });
  });

  test('submission and previous-run failures remain explicit, preserving entered answers', async ({ page }, testInfo) => {
    const app = await setupAudit(page);
    app.state.generateError = true;
    app.state.documentsError = true;
    await app.go('/aeo-geo');
    await expect(page.getByTestId('mktg-aeo-run-previous-error')).toBeVisible();
    await expect(page.getByTestId('mktg-aeo-run-empty')).toHaveCount(0);
    await page.getByLabel('The website to audit', { exact: false }).fill('other-project.example');
    await page.getByTestId('mktg-aeo-run-submit').click();
    await expect(page.getByTestId('mktg-aeo-run-error')).toContainText('inputs are kept');
    await expect(page.getByLabel('The website to audit', { exact: false })).toHaveValue('other-project.example');
    await page.screenshot({ path: testInfo.outputPath('generation-error.png'), fullPage: true });
  });

  test('non-writers see an access message and cannot submit an audit', async ({ page }, testInfo) => {
    const app = await setupAudit(page, { writer: false });
    await app.go('/aeo-geo');
    await expect(page.getByTestId('mktg-aeo-run-no-access')).toContainText('write access');
    await expect(page.getByTestId('mktg-aeo-run-form')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('no-access.png'), fullPage: true });
  });
});
