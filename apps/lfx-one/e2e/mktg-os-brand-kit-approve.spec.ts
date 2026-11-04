// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Approving a Brand Kit whose report (brand-kit ≥ 2.2.0) carries colour conflicts and rule bases: the approve dialog shows
// the conflicts (both values with their sources, the one kept) and the chapters whose rules the LF reference supplied, in
// plain words; a clean report with only those asks under its own header; and the overview's chapter cards carry a basis
// pill. Every read and write is stubbed with synthetic data.

import { expect, test } from '@playwright/test';
import { brandKitReportV2RulesFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-report-v2-rules.fixture';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { brandKitDraftRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';

test.beforeEach(async ({ page }) => suppressCookieBanner(page));

test.describe('Brand Kit approval with colour conflicts and LF-reference rules', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('shows the colour conflict with both values, their sources and the one kept, and the rules per chapter; Cancel writes nothing', async ({
    page,
  }, info) => {
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(brandKitReportV2RulesFixture()));
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/approve?')) writes.push(request.url());
    });
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    // The fixture has a failed source and a gap too, so the header stays the open-gaps one and today's list comes first.
    const dialog = page.getByRole('dialog', { name: 'Approve with open gaps?' });
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm')).toBeVisible();
    await expect(dialog).toContainText('https://synthetic-foundation.example/brand-guidelines — HTTP 404');
    await expect(dialog).toContainText('No logo files');

    const conflicts = dialog.getByTestId('mktg-document-view-approve-conflicts');
    await expect(conflicts.getByRole('heading')).toHaveText('Colour conflicts');
    const items = dialog.getByTestId('mktg-document-view-approve-conflict');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('Coral');
    await expect(items.first()).toContainText('#FF702D');
    await expect(items.first()).toContainText('From the brand page — synthetic-foundation.example');
    await expect(items.first()).toContainText('#FF7D2D');
    await expect(items.first()).toContainText('From the site’s CSS — synthetic-foundation.example');
    await expect(items.first()).toContainText('kept #FF702D');
    await expect(items.first()).not.toContainText('kept #FF7D2D');
    // No raw source key or stylesheet path reaches the reviewer.
    await expect(dialog).not.toContainText('brand_page:');
    await expect(dialog).not.toContainText('_next/static');

    const rules = dialog.getByTestId('mktg-document-view-approve-rules');
    await expect(rules.getByRole('heading')).toHaveText('Rules from the LF reference, not the project');
    await expect(dialog.getByTestId('mktg-document-view-approve-rule')).toHaveText([
      'Logo: 20 of 21 rules',
      'Color: 4 of 5 rules',
      'Type: 6 of 9 rules',
      'Visual: 9 of 9 rules',
      'Usage: 2 of 2 rules',
    ]);
    await expect(dialog).not.toContainText('chapters.');
    await page.screenshot({ path: info.outputPath('approve-dialog-conflicts-and-rules.png'), fullPage: true });

    await dialog.getByTestId('mktg-document-view-approve-cancel').getByRole('button').click();
    await expect(dialog).toBeHidden();
    expect(writes).toHaveLength(0);
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Draft');
  });

  test('asks under "Approve this version?" when a clean report has only conflicts and LF-reference rules, and Approve anyway writes once', async ({
    page,
  }, info) => {
    const report = { ...brandKitReportV2RulesFixture(), sources_failed: [], gaps: [] };
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(report));
    await expect(page.getByTestId('mktg-document-view-readiness')).toHaveText('Ready.');
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/approve?')) writes.push(request.url());
    });
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    const dialog = page.getByRole('dialog', { name: 'Approve this version?' });
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm')).toBeVisible();
    // Nothing failed and nothing is open: no list before the two sections.
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm').locator(':scope > ul')).toHaveCount(0);
    await expect(dialog.getByTestId('mktg-document-view-approve-conflict')).toHaveCount(1);
    await expect(dialog.getByTestId('mktg-document-view-approve-rule')).toHaveCount(5);
    await page.screenshot({ path: info.outputPath('approve-dialog-review-header.png'), fullPage: true });

    await dialog.getByTestId('mktg-document-view-approve-anyway').getByRole('button').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Approved');
    expect(writes).toHaveLength(1);
    await page.screenshot({ path: info.outputPath('approved.png'), fullPage: true });
  });

  test('approves a Brand Kit directly when its report has no failed source, gap, conflict or LF-reference rule', async ({ page }, info) => {
    const report = {
      ...brandKitReportV2RulesFixture(),
      sources_failed: [],
      gaps: [],
      color_conflicts: [],
      rules: [{ path: 'chapters.voice', basis: 'project' as const }],
    };
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(report));
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Approved');
    await page.screenshot({ path: info.outputPath('approved-directly.png'), fullPage: true });
  });

  test('the Overview’s chapter cards say where each chapter’s rules come from: the project, the LF reference, or how many of them', async ({ page }, info) => {
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(brandKitReportV2RulesFixture()));
    const chapters = page.getByTestId('brand-kit-web-view-chapters');
    await expect(chapters).toBeVisible();
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-logo')).toHaveText('LF reference default for 20 of 21 rules');
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-color')).toHaveText('LF reference default for 4 of 5 rules');
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-type')).toHaveText('LF reference default for 6 of 9 rules');
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-visual')).toHaveText('LF reference default');
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-usage')).toHaveText('LF reference default');
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-voice')).toHaveText('From the project');
    // Beside the chapter's number, not instead of it.
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-logo')).toContainText('01');
    await page.screenshot({ path: info.outputPath('overview-basis-pills.png'), fullPage: true });
  });
});
