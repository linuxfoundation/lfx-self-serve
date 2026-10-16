// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

import { DOCUMENTS_URL, DOCUMENT_VIEW_URL, documentFixture, openDocuments, setupDocuments } from './helpers/mktg-os-documents.helper';

test.describe('Marketing OS current revisions', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC' });
  test.afterEach(async ({ page }, testInfo) => {
    await page.screenshot({ path: testInfo.outputPath('final-state.png'), fullPage: true });
  });

  test('shows attribution, real comment counts, base and the non-newest Current badge', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page);
    await expect(page.getByTestId('mktg-documents-revision-3')).toContainText('The writer');
    await expect(page.getByTestId('mktg-documents-revision-3')).toContainText('revised from 4 comments · based on v1');
    await expect(page.getByTestId('mktg-documents-revision-2')).toContainText('Current');
    await expect(page.getByTestId('mktg-documents-revision-1')).toContainText('no name (stored before names were recorded)');
    await expect(page.getByTestId('mktg-documents-revision-2')).toContainText('synthetic-writer-without-name');
    await expect(page.getByTestId('mktg-documents-revision-2')).not.toContainText('stored before names were recorded');
    await page.getByTestId('mktg-documents-view-latest').click();
    await expect(page.getByTestId('mktg-document-view-revision-chip')).toContainText('Revision 2 of 3');
    await expect(page.getByTestId('mktg-document-view-revision-3')).toContainText(/revised from 4 comments · based on v1\s*· The writer/);
    await expect(page.getByTestId('mktg-document-view-revision-1')).toContainText('no name (stored before names were recorded)');
    await expect(page.getByTestId('mktg-document-view-revision-2')).toContainText('synthetic-writer-without-name');
    await expect(page.getByTestId('mktg-document-view-revision-2')).not.toContainText('stored before names were recorded');
    await expect(page.getByTestId('mktg-document-view-current-since-2')).toContainText('Current since 14 Oct 2026');
    await expect(page.getByTestId('mktg-document-view-current-since-2')).toContainText('The writer');
    await expect(page.getByTestId('mktg-document-view-current-since-3')).toHaveCount(0);
  });

  test('historical documents default to newest without inventing current-selection attribution', async ({ page }) => {
    await setupDocuments(page, { withoutCurrentRecord: true });
    await openDocuments(page, DOCUMENT_VIEW_URL);
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 3');
    await expect(page.getByTestId('mktg-document-view-revision-3')).toContainText('Current');
    await expect(page.locator('[data-testid^="mktg-document-view-current-since-"]')).toHaveCount(0);
  });

  test('Make current adds no revision and opening another revision clears success', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture().revisions[2].id}`);
    await page.getByTestId('mktg-document-view-history-bar-make-current').click();
    await expect(page.getByTestId('mktg-document-view-history-bar')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-notice')).toContainText('No revision was added');
    await expect(page.getByTestId('mktg-document-view-revision-chip')).toContainText('Revision 1 of 3');
    await expect(page.getByTestId('mktg-document-view-revision-1')).toContainText('Current');
    await expect(page.getByTestId('mktg-document-view-current-since-1')).toContainText('Current since 15 Oct 2026');
    await expect(page.getByTestId('mktg-document-view-current-since-1')).toContainText('The writer');
    await expect(page.getByTestId('mktg-document-view-current-since-2')).toHaveCount(0);
    await page.getByTestId('mktg-document-view-open-3').click();
    await expect(page.getByTestId('mktg-document-view-notice')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 3');
  });

  test('nine revisions keep older open/current rows visible and expand in place', async ({ page }) => {
    await setupDocuments(page, { revisionCount: 9, currentRevisionNumber: 2 });
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture(9, 2).revisions[8].id}`);
    const list = page.getByTestId('mktg-document-view-revisions');
    await expect(list.locator('ol > li')).toHaveCount(7);
    await expect(page.getByTestId('mktg-document-view-revision-1')).toBeVisible();
    await expect(page.getByTestId('mktg-document-view-revision-2')).toContainText('Current');
    await expect(page.getByTestId('mktg-document-view-revision-3')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-show-all-revisions')).toHaveText('Show all 9 ▾');
    await page.getByTestId('mktg-document-view-show-all-revisions').click();
    await expect(list.locator('ol > li')).toHaveCount(9);
    await page.getByTestId('mktg-document-view-open-3').click();
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 3');
    await expect(list.locator('ol > li')).toHaveCount(9);
    await expect(page.getByTestId('mktg-document-view-restore-current')).toHaveCount(0);
  });

  test('the subtle bar goes back to current and makes the open revision current', async ({ page }) => {
    await setupDocuments(page, { revisionCount: 9, currentRevisionNumber: 9 });
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture(9, 9).revisions[2].id}`);
    await expect(page.getByTestId('mktg-document-view-history-bar-summary')).toHaveText("You're viewing v7 · 13 Oct · The writer · v9 is current");
    await expect(page.getByTestId('mktg-document-view-history-bar-make-current')).toHaveAccessibleName('Make v7 current');
    await expect(page.getByTestId('mktg-document-view-history-bar-back')).toHaveAccessibleName('Back to v9');
    await page.getByTestId('mktg-document-view-history-bar-back').click();
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 9');
    await expect(page.getByTestId('mktg-document-view-history-bar')).toHaveCount(0);
    await page.getByTestId('mktg-document-view-open-7').click();
    await page.getByTestId('mktg-document-view-history-bar-make-current').click();
    await expect(page.getByTestId('mktg-document-view-history-bar')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-revision-chip')).toContainText('Revision 7 of 9');
    await expect(page.getByTestId('mktg-document-view-revision-7')).toContainText('Current');
  });

  test('keyboard focus reveals the complete clipped history summary', async ({ page }) => {
    const name = 'The writer responsible for the synthetic document revision and its detailed review notes';
    await setupDocuments(page, { revisionCount: 9, currentRevisionNumber: 9, revisionAuthorName: name });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture(9, 9).revisions[2].id}`);
    const summary = page.getByTestId('mktg-document-view-history-bar-summary');
    await expect(summary).toBeVisible();
    expect(await summary.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.getByTestId('mktg-document-view-back-link').focus();
    await page.keyboard.press('Tab');
    await expect(summary).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText(`You're viewing v7 · 13 Oct · ${name} · v9 is current`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.getByTestId('mktg-document-view-history-bar-back').click();
    await expect(page.getByTestId('mktg-document-view-history-bar')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 9');
  });

  test('the phone bar uses the short copy without losing Make current', async ({ page }) => {
    await setupDocuments(page, { revisionCount: 9, currentRevisionNumber: 9 });
    await page.setViewportSize({ width: 390, height: 1000 });
    await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture(9, 9).revisions[2].id}`);
    await expect(page.getByTestId('mktg-document-view-history-bar-mobile-summary')).toHaveText('Viewing v7');
    await expect(page.getByTestId('mktg-document-view-history-bar-make-current')).toHaveAccessibleName('Make current');
    await expect(page.getByTestId('mktg-document-view-history-bar-back')).toHaveAccessibleName('Back');
    await page.getByTestId('mktg-document-view-history-bar-make-current').click();
    await expect(page.getByTestId('mktg-document-view-history-bar')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-revision-chip')).toContainText('Revision 7 of 9');
  });

  test('a table Make current 404 shows not-found without moving the badge', async ({ page }) => {
    await setupDocuments(page, { writeStatus: 404 });
    await openDocuments(page);
    await page.getByTestId('mktg-documents-restore-1').click();
    await expect(page.getByTestId('mktg-documents-error')).toContainText('This document could not be found.');
    await expect(page.getByTestId('mktg-documents-revision-2')).toContainText('Current');
    await expect(page.getByTestId('mktg-documents-revision-1')).not.toContainText('Current');
    await expect(page.getByTestId('mktg-documents-restore-1')).toBeEnabled();
  });

  test('table Make current moves the badge and keeps all three revisions', async ({ page }) => {
    await setupDocuments(page);
    await openDocuments(page);
    await page.getByTestId('mktg-documents-restore-1').click();
    await expect(page.getByTestId('mktg-documents-notice')).toContainText('No revision was added');
    await expect(page.getByTestId('mktg-documents-revision-1')).toContainText('Current');
    await expect(page.getByTestId('mktg-documents-revisions').locator('tbody tr')).toHaveCount(3);
  });

  test('empty documents link to the agent without running a live session', async ({ page }) => {
    await setupDocuments(page, { empty: true });
    await openDocuments(page);
    await expect(page.getByTestId('mktg-documents-empty-living')).toBeVisible();
    const run = page.locator('[data-testid^="mktg-documents-run-agent-"]');
    await expect(run).toHaveAttribute('href', /mktg-os-agents\//);
    await run.click();
    await expect(page).not.toHaveURL(/\/documents\?/);
  });

  for (const status of [403, 404, 500]) {
    test(`load failure ${status} is distinct from an empty document`, async ({ page }) => {
      await setupDocuments(page, { status, writer: status !== 403 });
      await openDocuments(page, DOCUMENT_VIEW_URL);
      const error = page.getByTestId('mktg-document-view-error');
      if (status === 403) await expect(error).toContainText('write access');
      else if (status === 404) await expect(error).toContainText('This document could not be found');
      else await expect(error).toContainText('could not be loaded');
      await expect(page.getByTestId('mktg-document-view-document')).toHaveCount(0);
    });
  }

  for (const writeStatus of [403, 404, 412]) {
    test(`Make current failure ${writeStatus} preserves the open body`, async ({ page }) => {
      await setupDocuments(page, { writeStatus });
      await openDocuments(page, `${DOCUMENT_VIEW_URL}&revision=${documentFixture().revisions[2].id}`);
      await page.getByTestId('mktg-document-view-history-bar-make-current').click();
      await expect(page.getByTestId('mktg-document-view-error')).toBeVisible();
      await expect(page.getByTestId('mktg-document-view-document')).toContainText('Revision 1');
      await expect(page.getByTestId('mktg-document-view-history-bar-make-current')).toBeEnabled();
    });
  }
});
