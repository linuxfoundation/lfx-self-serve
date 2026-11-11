// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { BrandKitReport, MktgRevisionAccepted, MktgRevisionResponse } from '@lfx-one/shared/interfaces';
import { brandKitReportV2Fixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-report-v2.fixture';
import { mktgAcceptedSnapshotOf } from '@lfx-one/shared/utils/mktg-asset.utils';
import { expect, Page } from '@playwright/test';
import { suppressCookieBanner } from './account-settings-email.helper';
import { columnAssetRevisionResponse, openAssetDocument } from './mktg-os-asset-views.helper';

const TAB_TIMEOUT = 10_000;

export type BrandKitSourcesReport = 'v2' | 'v1';
/** How the opened revision is approved: not yet; before the snapshot existed; with the snapshot of its own report. */
export type BrandKitSourcesApproval = 'none' | 'legacy' | 'snapshot';

export interface BrandKitSourcesPage {
  report: BrandKitReport;
  accepted: MktgRevisionAccepted;
  /** Clicks Approve and the open-gaps dialog's "Approve anyway" (the report always has a gap); the stubbed approval carries the snapshot. */
  approve(): Promise<void>;
}

/** The v1 shape of the agent's report: the same v1 fields, none of the v2 ones. */
export function brandKitReportV1(): BrandKitReport {
  const { version, findings, color_conflicts, rules, ...v1 } = brandKitReportV2Fixture();
  void version;
  void findings;
  void color_conflicts;
  void rules;
  return v1;
}

/**
 * The brand kit document with the agent lane's own v2 report (or its v1 shape), stubbed so no live session is needed,
 * opened on its Sources tab. Synthetic project; no person's name anywhere in the fixture.
 */
export async function openBrandKitSources(
  page: Page,
  options: { report?: BrandKitSourcesReport; approval?: BrandKitSourcesApproval } = {}
): Promise<BrandKitSourcesPage> {
  await suppressCookieBanner(page);
  const report = options.report === 'v1' ? brandKitReportV1() : brandKitReportV2Fixture();
  const accepted = mktgAcceptedSnapshotOf(report);
  const base = columnAssetRevisionResponse('brand-kit');
  const approvals = {
    snapshot: { approvedAt: '2026-11-04T10:00:00Z', approvedBy: null, accepted },
    legacy: { approvedAt: '2026-11-04T10:00:00Z', approvedBy: null },
    none: null,
  };
  const approval = approvals[options.approval ?? 'none'];
  const revision = { ...base.revision, approval };
  const response: MktgRevisionResponse = {
    ...base,
    sidecar: { ...(base.sidecar as Record<string, unknown>), report },
    approval,
    revision,
    revisions: [revision],
    approvedCurrent: approval ? { revisionId: revision.id, number: revision.number } : null,
  };
  await openAssetDocument(page, 'brand-kit', 200, true, false, response);
  // Registered after the generic stub so it wins: an approval made now carries what the report shows now. The stub is
  // stateful: it updates the one response object the GET stubs close over, so a background refresh after the approve
  // reads the approved state too and the markers stay.
  await page.route('**/api/mktg-agents/documents/brand-kit/living/revisions/*/approve?*', (route) => {
    const made = { approvedAt: '2026-11-04T10:00:00Z', approvedBy: { name: 'Project writer' }, accepted };
    const approved = { ...revision, approval: made };
    Object.assign(response, {
      approval: made,
      revision: approved,
      revisions: [approved],
      approvedCurrent: { revisionId: approved.id, number: approved.number },
    });
    return route.fulfill({ json: response });
  });
  await page.getByTestId('brand-kit-web-view-tab-sources').click();
  await expect(page.getByTestId('brand-kit-web-view-panel-sources')).toBeVisible({ timeout: TAB_TIMEOUT });
  return {
    report,
    accepted,
    approve: async () => {
      await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
      await page.getByTestId('mktg-document-view-approve-anyway').getByRole('button').click();
      await expect(page.getByTestId('mktg-document-view-approve')).toHaveCount(0, { timeout: TAB_TIMEOUT });
    },
  };
}
