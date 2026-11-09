// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Every agent's report findings, shown like the Brand Kit's: on a messaging framework, boilerplates or FAQ document whose
// stored report is v2 (`report.findings`), the Sources tab lists the failed source in the agent's words with its detail
// and adds the kit's Missing assets and Warnings cards; Approve opens the kit's dialog under "Approve with open gaps?"
// with the same Failed sources and Missing assets items and, under Gaps, the report's gaps no missing asset mirrors; Cancel
// writes nothing and Approve anyway writes once. A clean
// v2 report shows the kit's empty lines and approves without a dialog; a v1 report adds no card. Every read and write is
// stubbed with the agents' real AAIF v2 envelopes (Agentic AI Foundation, each lane's recorded replay).

import type { MktgAssetReport } from '@lfx-one/shared/interfaces';
import { expect, test, type Page } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { openAssetDocument, reportV2DraftRevisionResponse, type ReportV2AgentKey } from './helpers/mktg-os-asset-views.helper';

/**
 * Each agent's view and its test-id prefix (the Sources tab and the failed-sources list are the view's own, the findings
 * cards are shared), and what its real envelope carries: the framework's one failed source (its press link answered
 * 404), the boilerplates' and FAQ's one open question. The strings are the agents' own, asserted as written.
 */
interface ViewCase {
  key: ReportV2AgentKey;
  prefix: string;
  failed: { source: string; detail: string } | null;
  missing: { reason: string; fix: string } | null;
  /** The warnings' texts, in order; none names a source, so each prints as text alone. */
  warnings: string[];
  /** The report's gaps lines no missing asset mirrors: the approve dialog's Gaps group, as written. */
  gaps: string[];
}
const FAILED_REASON = 'This page does not exist on the site (the server answered 404).';
const VIEWS: readonly ViewCase[] = [
  {
    key: 'foundation-message',
    prefix: 'mktg-framework-view',
    failed: { source: 'https://aaif.io/press', detail: 'HTTP 404' },
    missing: null,
    warnings: [],
    gaps: [],
  },
  {
    key: 'boilerplates',
    prefix: 'mktg-boilerplates-view',
    failed: null,
    missing: {
      reason: 'The question "Should the 100-word boilerplate name individual member companies?" was not answered, so the boilerplates were written without it.',
      fix: 'Fix: Answer it on a redraft, or add the fact to the request notes.',
    },
    warnings: [],
    // The open question's gap is mirrored by its reason (which wraps the question), so only the other gap is listed under Gaps.
    gaps: ['Whether to name the Gold and Silver members: the framework names none.'],
  },
  {
    key: 'faq',
    prefix: 'mktg-faq-view',
    failed: null,
    missing: {
      reason: 'How do I propose a new project to AAIF?',
      fix: 'Fix: Answer it in a comment on this question and redraft, or remove the question.',
    },
    warnings: [
      "The requester kept the suggested answer in the question round, so this answer rests on the agent's research, not on a source the requester supplied: Is AAIF controlled by one AI company?",
      "The requester kept the suggested answer in the question round, so this answer rests on the agent's research, not on a source the requester supplied: How much does membership cost, and what does each tier include?",
    ],
    // Its one gap is the open question itself: mirrored, so no Gaps group.
    gaps: [],
  },
];
const MISSING_LABEL = 'Open question';

/** A v1 report in the kit's legacy shape: one failed source by name, one gap, nothing of v2. */
const V1_REPORT = {
  sources_read: ['https://aaif.io'],
  sources_failed: [{ name: 'Press page', reason: 'Not found.' }],
  gaps: ['The member count is not stated.'],
  notes: '',
};
/** The framework agent's clean AAIF report (its `aaif-envelope` replay): v2 with nothing in any group and no gap. */
const CLEAN_V2_REPORT: MktgAssetReport = {
  sources_read: [
    'https://aaif.io/',
    'https://aaif.io/members',
    'https://aaif.io/projects',
    'LF press release: formation of the Agentic AI Foundation',
    'LFX record: Agentic AI Foundation (agentic-ai-foundation)',
  ],
  sources_failed: [],
  gaps: [],
  notes: 'The member organization count comes from LFX; the pages state no figure to check it against.',
  version: 2,
  findings: { sources_failed: [], missing_assets: [], warnings: [] },
};

/** The approve POSTs the page makes, so a test can tell Cancel (none) from Approve anyway (one). */
function recordApproveWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/approve?')) writes.push(request.url());
  });
  return writes;
}

test.beforeEach(async ({ page }) => suppressCookieBanner(page));

test.describe('Report findings on every agent’s document', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  for (const { key, prefix, failed, missing, warnings, gaps } of VIEWS) {
    test(`${key}: the Sources tab shows the real v2 report’s findings as the Brand Kit does: what failed in the agent’s words with its detail, the Missing assets and Warnings cards, and the kit’s empty lines where a group is empty`, async ({
      page,
    }, info) => {
      await openAssetDocument(page, key, 200, true, false, reportV2DraftRevisionResponse(key));
      await page.getByTestId(`${prefix}-tab-sources`).click();
      // The failed source, as the kit's Failed sources card lays it out: the source, the agent's reason, the small detail.
      if (failed) {
        const failedList = page.getByTestId(`${prefix}-sources-failed`);
        await expect(failedList.getByRole('listitem')).toHaveCount(1);
        await expect(failedList).toContainText(failed.source);
        await expect(failedList).toContainText(FAILED_REASON);
        await expect(page.getByTestId(`${prefix}-sources-failed-detail`)).toHaveText(failed.detail);
      } else {
        await expect(page.getByTestId(`${prefix}-sources-failed`)).toHaveCount(0);
        await expect(page.getByTestId(`${prefix}-sources-failed-empty`)).toHaveText('No source failed.');
      }
      // The kit's two cards, rendered by the shared component: the missing asset by its family label with its reason and fix,
      // each warning in the agent's words (none names a source, so no link and no grey source line), or the kit's empty line.
      const missingCard = page.getByTestId('mktg-report-findings-missing');
      await expect(missingCard.getByRole('heading')).toHaveText('Missing assets');
      if (missing) {
        await expect(page.getByTestId('mktg-report-findings-missing-item')).toHaveCount(1);
        await expect(page.getByTestId('mktg-report-findings-missing-item')).toContainText(MISSING_LABEL);
        await expect(page.getByTestId('mktg-report-findings-missing-reason')).toHaveText(missing.reason);
        await expect(page.getByTestId('mktg-report-findings-missing-fix')).toHaveText(missing.fix);
        await expect(page.getByTestId('mktg-report-findings-missing-empty')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('mktg-report-findings-missing-item')).toHaveCount(0);
        await expect(page.getByTestId('mktg-report-findings-missing-empty')).toHaveText('Nothing is missing.');
      }
      const warningsCard = page.getByTestId('mktg-report-findings-warnings');
      await expect(warningsCard.getByRole('heading')).toHaveText('Warnings');
      await expect(page.getByTestId('mktg-report-findings-warnings-item')).toHaveCount(warnings.length);
      await expect(page.getByTestId('mktg-report-findings-warnings-source-link')).toHaveCount(0);
      if (warnings.length) {
        await expect(page.getByTestId('mktg-report-findings-warnings-text')).toHaveText(warnings);
        await expect(page.getByTestId('mktg-report-findings-warnings-empty')).toHaveCount(0);
      } else {
        await expect(page.getByTestId('mktg-report-findings-warnings-empty')).toHaveText('No warnings.');
      }
      await page.screenshot({ path: info.outputPath(`${key}-sources-v2.png`), fullPage: true });
    });

    test(`${key}: Approve asks under "Approve with open gaps?" with the real envelope’s Failed sources and Missing assets items as the Brand Kit does, then the gaps no asset mirrors under Gaps, and nothing of the kit’s own`, async ({
      page,
    }, info) => {
      await openAssetDocument(page, key, 200, true, false, reportV2DraftRevisionResponse(key));
      await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
      const dialog = page.getByRole('dialog', { name: 'Approve with open gaps?' });
      await expect(dialog.getByTestId('mktg-document-view-approve-confirm')).toBeVisible();
      if (failed) {
        await expect(dialog.getByTestId('mktg-document-view-approve-failed').getByRole('heading')).toHaveText('Failed sources');
        await expect(dialog.getByTestId('mktg-document-view-approve-failed-item')).toHaveCount(1);
        await expect(dialog.getByTestId('mktg-document-view-approve-failed-item-title')).toHaveText(failed.source);
        await expect(dialog.getByTestId('mktg-document-view-approve-failed-item-reason')).toHaveText(FAILED_REASON);
        await expect(dialog.getByTestId('mktg-document-view-approve-failed-item-detail')).toHaveText(failed.detail);
        // The legacy one-line form of the same failed source is not printed twice.
        await expect(dialog).not.toContainText(`${failed.source} — ${failed.detail}`);
      } else {
        await expect(dialog.getByTestId('mktg-document-view-approve-failed')).toHaveCount(0);
      }
      if (missing) {
        await expect(dialog.getByTestId('mktg-document-view-approve-missing').getByRole('heading')).toHaveText('Missing assets');
        await expect(dialog.getByTestId('mktg-document-view-approve-missing-item')).toHaveCount(1);
        await expect(dialog.getByTestId('mktg-document-view-approve-missing-item-title')).toHaveText(MISSING_LABEL);
        await expect(dialog.getByTestId('mktg-document-view-approve-missing-item-reason')).toHaveText(missing.reason);
        await expect(dialog.getByTestId('mktg-document-view-approve-missing-item-fix')).toHaveText(missing.fix);
      } else {
        await expect(dialog.getByTestId('mktg-document-view-approve-missing')).toHaveCount(0);
      }
      // A gap the open question mirrors is not repeated; one no asset stands for is listed under Gaps, as the agent wrote it.
      if (gaps.length) {
        await expect(dialog.getByTestId('mktg-document-view-approve-gaps').getByRole('heading')).toHaveText('Gaps');
        await expect(dialog.getByTestId('mktg-document-view-approve-gaps-item')).toHaveText(gaps);
      } else {
        await expect(dialog.getByTestId('mktg-document-view-approve-gaps')).toHaveCount(0);
      }
      await expect(dialog.getByRole('listitem')).toHaveCount((failed ? 1 : 0) + (missing ? 1 : 0) + gaps.length);
      // The kit-only sections stay out.
      await expect(dialog.getByTestId('mktg-document-view-approve-conflicts')).toHaveCount(0);
      await expect(dialog.getByTestId('mktg-document-view-approve-rules')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`${key}-approve-dialog.png`), fullPage: true });
    });

    test(`${key}: a v1 report lists its failed sources as before and adds no findings card`, async ({ page }, info) => {
      await openAssetDocument(page, key, 200, true, false, reportV2DraftRevisionResponse(key, V1_REPORT));
      await page.getByTestId(`${prefix}-tab-sources`).click();
      const failed = page.getByTestId(`${prefix}-sources-failed`);
      await expect(failed).toContainText('Press page');
      await expect(failed).toContainText('Not found.');
      await expect(page.getByTestId(`${prefix}-sources-failed-detail`)).toHaveCount(0);
      await expect(page.getByTestId(`${prefix}-gaps`)).toContainText('The member count is not stated.');
      await expect(page.locator('[data-testid^="mktg-report-findings-"]')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`${key}-sources-v1.png`), fullPage: true });
    });
  }

  test('in the dialog, Cancel writes nothing and the document stays a draft; Approve anyway writes the approval once', async ({ page }, info) => {
    await openAssetDocument(page, 'foundation-message', 200, true, false, reportV2DraftRevisionResponse('foundation-message'));
    const writes = recordApproveWrites(page);
    const approve = page.getByTestId('mktg-document-view-approve').getByRole('button');
    await approve.click();
    const dialog = page.getByRole('dialog', { name: 'Approve with open gaps?' });
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm')).toBeVisible();
    await dialog.getByTestId('mktg-document-view-approve-cancel').getByRole('button').click();
    await expect(dialog).toBeHidden();
    expect(writes).toHaveLength(0);
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Draft');

    await approve.click();
    await dialog.getByTestId('mktg-document-view-approve-anyway').getByRole('button').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Approved');
    expect(writes).toHaveLength(1);
    await page.screenshot({ path: info.outputPath('framework-approved.png'), fullPage: true });
  });

  test('a clean v2 report (nothing failed, missing or warned) shows the kit’s empty lines on the Sources tab and approves without a dialog', async ({
    page,
  }, info) => {
    await openAssetDocument(page, 'foundation-message', 200, true, false, reportV2DraftRevisionResponse('foundation-message', CLEAN_V2_REPORT));
    await page.getByTestId('mktg-framework-view-tab-sources').click();
    await expect(page.getByTestId('mktg-framework-view-sources-failed')).toHaveCount(0);
    await expect(page.getByTestId('mktg-framework-view-sources-failed-empty')).toHaveText('No source failed.');
    await expect(page.getByTestId('mktg-report-findings-missing').getByRole('heading')).toHaveText('Missing assets');
    await expect(page.getByTestId('mktg-report-findings-missing-item')).toHaveCount(0);
    await expect(page.getByTestId('mktg-report-findings-missing-empty')).toHaveText('Nothing is missing.');
    await expect(page.getByTestId('mktg-report-findings-warnings').getByRole('heading')).toHaveText('Warnings');
    await expect(page.getByTestId('mktg-report-findings-warnings-item')).toHaveCount(0);
    await expect(page.getByTestId('mktg-report-findings-warnings-empty')).toHaveText('No warnings.');
    await page.screenshot({ path: info.outputPath('framework-sources-clean-v2.png'), fullPage: true });

    const writes = recordApproveWrites(page);
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    // The approval is written and shown without a dialog: the write first, then the state, then no dialog ever opened.
    await expect.poll(() => writes.length).toBe(1);
    await expect(page.getByTestId('mktg-document-view-approval-state')).toHaveText('Approved');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('framework-approved-directly.png'), fullPage: true });
  });
});
