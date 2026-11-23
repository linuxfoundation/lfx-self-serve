// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Approving a Brand Kit whose report (brand-kit ≥ 2.2.0) carries colour conflicts and rule bases: the approve dialog shows
// the conflicts (both values with their sources, the one kept) and the chapters whose rules the LF reference supplied, in
// plain words; a clean report with only those asks under its own header; and the overview's chapter cards carry a basis
// pill. Every read and write is stubbed with synthetic data.

import { expect, test } from '@playwright/test';
import { brandKitCleanReportV2Fixture, brandKitReportV2RulesFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-report-v2-rules.fixture';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { brandKitDraftRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';

test.beforeEach(async ({ page }) => suppressCookieBanner(page));

test.describe('Brand Kit approval with colour conflicts and LF-reference rules', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('lists the failed sources and missing assets like the Sources tab, the colour conflict with the one kept, and the rules per chapter; Cancel writes nothing', async ({
    page,
  }, info) => {
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(brandKitReportV2RulesFixture()));
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/approve?')) writes.push(request.url());
    });
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    // The fixture has failed sources, missing assets and a gap too, so the header stays the open-gaps one and the top list comes
    // first, in the Sources tab's words: each failed source with its plain reason and small detail, each missing asset by its label.
    const dialog = page.getByRole('dialog', { name: 'Approve with open gaps?' });
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm')).toBeVisible();
    const failed = dialog.getByTestId('mktg-document-view-approve-failed');
    await expect(failed.getByRole('heading')).toHaveText('Failed sources');
    const firstFailed = dialog.getByTestId('mktg-document-view-approve-failed-item').first();
    await expect(firstFailed.getByTestId('mktg-document-view-approve-failed-item-title')).toHaveText('https://synthetic-foundation.example/brand-guidelines');
    await expect(firstFailed.getByTestId('mktg-document-view-approve-failed-item-reason')).toHaveText(
      'This page does not exist on the site (the server answered 404).'
    );
    await expect(firstFailed.getByTestId('mktg-document-view-approve-failed-item-detail')).toHaveText('HTTP 404');
    await expect(dialog.getByTestId('mktg-document-view-approve-failed-item-title').nth(1)).toHaveText('Logo package (ZIP) — cdn.synthetic-foundation.example');
    await expect(dialog.getByTestId('mktg-document-view-approve-failed-item-detail').nth(1)).toHaveText('linked ZIP, not readable from a link');
    const missing = dialog.getByTestId('mktg-document-view-approve-missing');
    await expect(missing.getByRole('heading')).toHaveText('Missing assets');
    await expect(dialog.getByTestId('mktg-document-view-approve-missing-item-title')).toHaveText(['Primary logo', 'Stacked logo', 'Symbol', 'Reversed logo']);
    const firstMissing = dialog.getByTestId('mktg-document-view-approve-missing-item').first();
    await expect(firstMissing.getByTestId('mktg-document-view-approve-missing-item-reason')).toContainText('was not read in this run');
    await expect(firstMissing.getByTestId('mktg-document-view-approve-missing-item-fix')).toContainText('Fix: Upload the primary file as SVG in the form');
    // Today's one-line form is gone for a v2 report; the gaps bullets are not repeated on a v2 report, Missing assets stands for them.
    await expect(dialog).not.toContainText('brand-guidelines — HTTP 404');
    await expect(dialog).not.toContainText('No logo files');

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
    // The kept pill sits in the same row as the value it marks, never beside the other value.
    const valueRows = items.first().getByRole('listitem');
    await expect(valueRows.filter({ hasText: '#FF702D' })).toContainText('kept #FF702D');
    await expect(valueRows.filter({ hasText: '#FF7D2D' })).not.toContainText('kept');
    // No raw source key or stylesheet path reaches the reviewer.
    await expect(dialog).not.toContainText('brand_page:');
    await expect(dialog).not.toContainText('_next/static');

    const rules = dialog.getByTestId('mktg-document-view-approve-rules');
    await expect(rules.getByRole('heading')).toHaveText('Rules from the LF reference, not the project');
    await expect(dialog.getByTestId('mktg-document-view-approve-rule')).toHaveText([
      'Logo: 20 of 21 rules',
      'Color: 4 of 5 rules',
      'Type: 5 of 11 rules',
      'Visual: 9 of 9 rules',
      'Usage: 2 of 2 rules',
      'Voice: 1 of 8 rules',
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
    const report = brandKitCleanReportV2Fixture();
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(report));
    await expect(page.getByTestId('mktg-document-view-readiness')).toHaveText('Ready.');
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/approve?')) writes.push(request.url());
    });
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    const dialog = page.getByRole('dialog', { name: 'Approve this version?' });
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm')).toBeVisible();
    // Nothing failed, nothing missing and nothing open: neither findings group nor a gaps list before the two sections.
    await expect(dialog.getByTestId('mktg-document-view-approve-failed')).toHaveCount(0);
    await expect(dialog.getByTestId('mktg-document-view-approve-missing')).toHaveCount(0);
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm').locator(':scope > ul')).toHaveCount(0);
    await expect(dialog.getByTestId('mktg-document-view-approve-conflict')).toHaveCount(1);
    await expect(dialog.getByTestId('mktg-document-view-approve-rule')).toHaveCount(6);
    await page.screenshot({ path: info.outputPath('approve-dialog-review-header.png'), fullPage: true });

    await dialog.getByTestId('mktg-document-view-approve-anyway').getByRole('button').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Approved');
    expect(writes).toHaveLength(1);
    await page.screenshot({ path: info.outputPath('approved.png'), fullPage: true });
  });

  test('approves a Brand Kit directly when its report has no failed source, gap, conflict or LF-reference rule', async ({ page }, info) => {
    const report = { ...brandKitCleanReportV2Fixture(), color_conflicts: [], rules: [{ path: 'chapters.voice', basis: 'project' as const }] };
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(report));
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/approve?')) writes.push(request.url());
    });
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    // The approval is written and shown without a dialog: the write first, then the state, then no dialog ever opened.
    await expect.poll(() => writes.length).toBe(1);
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Approved');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('approved-directly.png'), fullPage: true });
  });

  test('a v1 report keeps today’s dialog: the open-gaps header and the failed source, no conflicts or rules section', async ({ page }, info) => {
    const report = { ...brandKitTestRevision().report, sources_failed: [{ name: 'https://synthetic-foundation.example/brand', reason: 'HTTP 404' }] };
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(report));
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    const dialog = page.getByRole('dialog', { name: 'Approve with open gaps?' });
    await expect(dialog).toContainText('https://synthetic-foundation.example/brand — HTTP 404');
    await expect(dialog).not.toContainText('Failed sources');
    await expect(dialog).not.toContainText('Missing assets');
    await expect(dialog).not.toContainText('Colour conflicts');
    await expect(dialog).not.toContainText('Rules from the LF reference, not the project');
    await page.screenshot({ path: info.outputPath('approve-dialog-v1.png'), fullPage: true });
  });

  test('the Overview’s chapter cards say where each chapter’s rules come from: the project, the LF reference, or how many of them', async ({ page }, info) => {
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(brandKitReportV2RulesFixture()));
    const chapters = page.getByTestId('brand-kit-web-view-chapters');
    await expect(chapters).toBeVisible();
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-logo')).toHaveText('LF reference default for 20 of 21 rules');
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-color')).toHaveText('LF reference default for 4 of 5 rules');
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-type')).toHaveText('LF reference default for 5 of 11 rules');
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-visual')).toHaveText('LF reference default');
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-usage')).toHaveText('LF reference default');
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-basis-voice')).toHaveText('LF reference default for 1 of 8 rules');
    // Under the chapter's title and number, not instead of them.
    await expect(chapters.getByTestId('brand-kit-web-view-chapter-logo')).toContainText('01');
    await page.screenshot({ path: info.outputPath('overview-basis-pills.png'), fullPage: true });
  });
});
