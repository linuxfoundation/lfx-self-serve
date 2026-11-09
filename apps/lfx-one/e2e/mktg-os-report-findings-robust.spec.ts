// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Structural contract of the shared report-findings cards and the generic approve dialog on the family's documents: the
// `mktg-report-findings-*` and `<view>-sources-failed-detail` test ids on each of the three Sources tabs, the dialog
// found by its confirm test id (never its words, which are the content spec's) carrying each agent's Failed, Missing and
// Gaps items, a clean v2 report rendering the empty-state ids, and a v1 report rendering none of the findings ids. Every read
// and write is stubbed with the agents' real AAIF v2 envelopes.

import type { MktgAssetReport } from '@lfx-one/shared/interfaces';
import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { openAssetDocument, reportV2DraftRevisionResponse, type ReportV2AgentKey } from './helpers/mktg-os-asset-views.helper';

/**
 * Each agent's view, and how many failed sources, missing assets, warnings and unmirrored gaps its real envelope carries (no
 * warning names a source; one of the boilerplates' two gaps is its open question, mirrored, the FAQ's one gap is its open question).
 */
const VIEWS: readonly { key: ReportV2AgentKey; prefix: string; failed: number; missing: number; warnings: number; gaps: number }[] = [
  { key: 'foundation-message', prefix: 'mktg-framework-view', failed: 1, missing: 0, warnings: 0, gaps: 0 },
  { key: 'boilerplates', prefix: 'mktg-boilerplates-view', failed: 0, missing: 1, warnings: 0, gaps: 1 },
  { key: 'faq', prefix: 'mktg-faq-view', failed: 0, missing: 1, warnings: 2, gaps: 0 },
];

const V1_REPORT = { sources_read: [], sources_failed: [{ name: 'Press page', reason: 'Not found.' }], gaps: [], notes: '' };
/** A v2 report with nothing in any group and no gap: the empty-state ids, and no dialog on Approve. */
const CLEAN_V2_REPORT: MktgAssetReport = { ...V1_REPORT, sources_failed: [], version: 2, findings: { sources_failed: [], missing_assets: [], warnings: [] } };

test.beforeEach(async ({ page }) => suppressCookieBanner(page));

for (const { key, prefix, failed, missing, warnings } of VIEWS) {
  test(`${key}: the Sources tab carries the findings cards’ test ids on a v2 report, and none of them on a v1 report`, async ({ page }, info) => {
    await openAssetDocument(page, key, 200, true, false, reportV2DraftRevisionResponse(key));
    await page.getByTestId(`${prefix}-tab-sources`).click();
    await expect(page.getByTestId(`${prefix}-sources-failed`)).toHaveCount(failed);
    await expect(page.getByTestId(`${prefix}-sources-failed-detail`)).toHaveCount(failed);
    await expect(page.getByTestId(`${prefix}-sources-failed-empty`)).toHaveCount(1 - failed);
    const counts: [string, number][] = [
      ['mktg-report-findings-missing', 1],
      ['mktg-report-findings-missing-item', missing],
      ['mktg-report-findings-missing-reason', missing],
      ['mktg-report-findings-missing-fix', missing],
      ['mktg-report-findings-missing-empty', 1 - missing],
      ['mktg-report-findings-warnings', 1],
      ['mktg-report-findings-warnings-item', warnings],
      ['mktg-report-findings-warnings-text', warnings],
      ['mktg-report-findings-warnings-source-link', 0],
      ['mktg-report-findings-warnings-empty', warnings ? 0 : 1],
    ];
    for (const [id, count] of counts) {
      await expect(page.getByTestId(id), id).toHaveCount(count);
    }
    // The cards are grid items of the tab's own grid: each sits inside the viewport, none wider than the tab panel.
    const panel = page.getByTestId(`${prefix}-panel-sources`);
    const panelBox = await panel.boundingBox();
    const cardBox = await page.getByTestId('mktg-report-findings-warnings').boundingBox();
    if (!panelBox || !cardBox) throw new Error('The Sources panel and the Warnings card must be rendered');
    expect(cardBox.x, JSON.stringify({ panelBox, cardBox })).toBeGreaterThanOrEqual(panelBox.x - 1);
    expect(cardBox.x + cardBox.width, JSON.stringify({ panelBox, cardBox })).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
    await page.screenshot({ path: info.outputPath(`${key}-sources-v2.png`), fullPage: true });

    await openAssetDocument(page, key, 200, true, false, reportV2DraftRevisionResponse(key, V1_REPORT));
    await page.getByTestId(`${prefix}-tab-sources`).click();
    await expect(page.getByTestId(`${prefix}-sources-failed`)).toBeVisible();
    await expect(page.getByTestId(`${prefix}-sources-failed-detail`)).toHaveCount(0);
    await expect(page.locator('[data-testid^="mktg-report-findings-"]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${key}-sources-v1.png`), fullPage: true });
  });
}

for (const { key, failed, missing, gaps } of VIEWS) {
  test(`${key}: the approve dialog carries the Failed, Missing and Gaps test ids its real envelope calls for, and no kit-only section`, async ({
    page,
  }, info) => {
    await openAssetDocument(page, key, 200, true, false, reportV2DraftRevisionResponse(key));
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('mktg-document-view-approve-confirm') });
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm')).toBeVisible();
    const counts: [string, number][] = [
      ['mktg-document-view-approve-failed', failed],
      ['mktg-document-view-approve-failed-item', failed],
      ['mktg-document-view-approve-failed-item-title', failed],
      ['mktg-document-view-approve-failed-item-reason', failed],
      ['mktg-document-view-approve-failed-item-detail', failed],
      ['mktg-document-view-approve-missing', missing],
      ['mktg-document-view-approve-missing-item', missing],
      ['mktg-document-view-approve-missing-item-title', missing],
      ['mktg-document-view-approve-missing-item-reason', missing],
      ['mktg-document-view-approve-missing-item-fix', missing],
      ['mktg-document-view-approve-gaps', gaps ? 1 : 0],
      ['mktg-document-view-approve-gaps-item', gaps],
      ['mktg-document-view-approve-conflicts', 0],
      ['mktg-document-view-approve-rules', 0],
      ['mktg-document-view-approve-cancel', 1],
      ['mktg-document-view-approve-anyway', 1],
    ];
    for (const [id, count] of counts) {
      await expect(dialog.getByTestId(id), id).toHaveCount(count);
    }
    await page.screenshot({ path: info.outputPath(`${key}-approve-dialog.png`), fullPage: true });
    await dialog.getByTestId('mktg-document-view-approve-cancel').getByRole('button').click();
    await expect(dialog).toBeHidden();
  });
}

test('a clean v2 report renders the empty-state ids under both cards and opens no dialog on Approve', async ({ page }, info) => {
  await openAssetDocument(page, 'foundation-message', 200, true, false, reportV2DraftRevisionResponse('foundation-message', CLEAN_V2_REPORT));
  await page.getByTestId('mktg-framework-view-tab-sources').click();
  const counts: [string, number][] = [
    ['mktg-framework-view-sources-failed', 0],
    ['mktg-framework-view-sources-failed-empty', 1],
    ['mktg-report-findings-missing-item', 0],
    ['mktg-report-findings-missing-empty', 1],
    ['mktg-report-findings-warnings-item', 0],
    ['mktg-report-findings-warnings-empty', 1],
  ];
  for (const [id, count] of counts) {
    await expect(page.getByTestId(id), id).toHaveCount(count);
  }
  await page.screenshot({ path: info.outputPath('framework-sources-clean-v2.png'), fullPage: true });
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/approve?')) writes.push(request.url());
  });
  await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
  // The write, then no dialog ever opened: the state's words are the content spec's.
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('framework-approved-directly.png'), fullPage: true });
});
