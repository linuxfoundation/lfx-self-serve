// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
// Imported from the module, not the `utils` barrel: the barrel re-exports form.utils, which pulls
// in @angular/common and fails to load outside the Angular app with a JIT compiler error.
import { ORG_LENS_ROI_METHOD_STORAGE_KEY } from '@lfx-one/shared/constants/org-lens-roi.constants';
import { formatCurrency, formatPercent } from '@lfx-one/shared/utils/number.utils';

import {
  CURRENT_YEAR,
  DETAIL_LOSS_PROJECT,
  DETAIL_PROJECT,
  gotoOrgRoiPage,
  gotoOrgRoiProjectDetail,
  MOCK_ACCOUNT_ID,
  mockProjectAnnual,
  mockProjectDetail,
  NO_VALUE,
  orgRoiProjectDetailUrl,
  stubOrgLensContext,
} from './helpers/org-roi.helper';

test.setTimeout(120_000);

/**
 * Every expected string is derived from the fixture through the same formatter the component uses.
 * The detail payload is built from the same `MOCK_PROJECTS` rows the table renders, so a figure
 * that differs between the table and the drill-down fails here rather than reaching a viewer.
 */
const PROFIT = DETAIL_PROJECT.return - DETAIL_PROJECT.expenditure;
const ROI = PROFIT / DETAIL_PROJECT.expenditure;
const BCR = DETAIL_PROJECT.return / DETAIL_PROJECT.expenditure;

/** A project with no investment: the warehouse returns NULL, never zero, for a ratio it cannot divide. */
const NO_INVESTMENT_DETAIL = {
  orgUid: MOCK_ACCOUNT_ID,
  method: 'logit',
  project: {
    projectId: 'prj-unmeasured',
    projectSlug: 'unmeasured',
    projectName: 'Unmeasured Project',
    totalExpenditure: 0,
    totalReturn: 0,
    profit: 0,
    roi: null,
    bcr: null,
    breakevenMarkup: null,
    categories: [],
  },
  hasOrgLensProject: true,
};

test.describe('Org Lens ROI project detail — figures', () => {
  test('shows all five figures for the project, read from the payload', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    await expect(page.getByTestId('org-roi-project-detail-title')).toHaveText(DETAIL_PROJECT.name);

    const cards = page.getByTestId('org-roi-project-detail-kpi-cards');
    await expect(cards).toContainText(formatCurrency(DETAIL_PROJECT.expenditure));
    await expect(cards).toContainText(formatCurrency(DETAIL_PROJECT.return));
    await expect(cards).toContainText(formatCurrency(PROFIT));
    await expect(cards).toContainText(`${formatPercent(ROI * 100)}%`);
    await expect(cards).toContainText(`${BCR.toFixed(1)}×`);
  });

  test('resolves a mixed-case deep link rather than holding the skeleton', async ({ page }) => {
    // The warehouse stores slugs lowercase and the server normalizes before querying, so the
    // payload comes back lowercase. If the route param were compared raw, the identity guard would
    // never match and this page would skeleton forever on a URL the server answered correctly.
    await stubOrgLensContext(page);
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug.toUpperCase());

    await expect(page.getByTestId('org-roi-project-detail-kpi-cards')).toContainText(formatCurrency(DETAIL_PROJECT.expenditure));
    await expect(page.getByTestId('org-roi-project-detail-loading')).toHaveCount(0);
  });

  test('renders a null ratio as the no-value indicator, never as zero', async ({ page }) => {
    await stubOrgLensContext(page, { projectDetail: NO_INVESTMENT_DETAIL, projectAnnual: mockProjectAnnual('unmeasured') });
    await gotoOrgRoiProjectDetail(page, 'unmeasured');

    const cards = page.getByTestId('org-roi-project-detail-kpi-cards');
    await expect(cards).toContainText(NO_VALUE);
    // The distinction that matters: "we could not compute this" must not render as "broke even".
    await expect(cards).not.toContainText('0.0%');
    await expect(cards).not.toContainText('0.0×');
  });

  test('states a negative net return rather than leaving it to be inferred', async ({ page }) => {
    await stubOrgLensContext(page, {
      projectDetail: mockProjectDetail(DETAIL_LOSS_PROJECT.slug),
      projectAnnual: mockProjectAnnual(DETAIL_LOSS_PROJECT.slug),
    });
    await gotoOrgRoiProjectDetail(page, DETAIL_LOSS_PROJECT.slug);

    const loss = DETAIL_LOSS_PROJECT.return - DETAIL_LOSS_PROJECT.expenditure;
    await expect(page.getByTestId('org-roi-project-detail-kpi-cards')).toContainText(formatCurrency(loss));
    await expect(page.getByTestId('org-roi-project-detail-loss-note')).toBeVisible();
  });

  test('withholds figures whose estimation method is not the one in effect', async ({ page }) => {
    // The stored preference is restored after the first render, so a viewer on `direct` issues a
    // `logit` request first. If that payload were rendered, the heading would read "Direct markup"
    // over logit return and ratios — and because investment is method-invariant, only some of the
    // figures would be wrong, which is harder to notice than all of them.
    await stubOrgLensContext(page, { projectDetail: { ...(mockProjectDetail(DETAIL_PROJECT.slug) as object), method: 'logit' } });
    await page.addInitScript((key) => window.localStorage.setItem(key as string, 'direct'), ORG_LENS_ROI_METHOD_STORAGE_KEY);
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    await expect(page.getByTestId('org-roi-project-detail-subtitle')).toContainText('Direct markup');
    await expect(page.getByTestId('org-roi-project-detail-kpi-cards')).toHaveCount(0);
    await expect(page.getByTestId('org-roi-project-detail-page')).not.toContainText(formatCurrency(DETAIL_PROJECT.expenditure));
  });

  test('carries an explanation for every one of the five figures', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    for (const metric of ['total-expenditure', 'total-return', 'profit', 'roi', 'bcr']) {
      await expect(page.getByTestId(`org-roi-project-detail-explanation-${metric}`)).toHaveCount(1);
    }
  });

  test('carries the modelled-cost disclosure verbatim on the investment figure', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    // Each clause asserted separately, so shortening the copy to fit a layout fails a test rather
    // than quietly weakening the disclosure.
    const investment = page.getByTestId('org-roi-project-detail-explanation-total-expenditure');
    await expect(investment).toContainText('modelled cost');
    await expect(investment).toContainText('not actual or reported compensation');
    await expect(investment).toContainText('standard rates that are the same for every organization');
    await expect(investment).toContainText('No salary, payroll, or invoice data is used.');
  });
});

test.describe('Org Lens ROI project detail — investment by year', () => {
  test('renders the yearly distribution and its text equivalent', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    await expect(page.getByTestId('org-roi-project-detail-annual-chart')).toHaveAttribute('role', 'img');

    const table = page.getByTestId('org-roi-project-detail-annual-table');
    await expect(table).toContainText(formatCurrency(30_000_000));
    await expect(table).toContainText(formatCurrency(1_200_000_000));
    // Only the year still in progress is marked partial; an earlier final year is complete.
    await expect(table).toContainText(`${CURRENT_YEAR} (partial year)`);
    await expect(table).not.toContainText(`${CURRENT_YEAR - 1} (partial year)`);
  });

  test('discloses that per-year efficiency is constant, and plots no efficiency series', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    const note = page.getByTestId('org-roi-project-detail-efficiency-constant-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('same in every year');
    // The chart carries investment alone; a per-year ROI or BCR series would contradict the note.
    await expect(page.getByTestId('org-roi-project-detail-annual-chart')).not.toContainText('Benefit-Cost');
  });

  test('drives the constancy disclosure from the payload flag, not from hardcoded copy', async ({ page }) => {
    await stubOrgLensContext(page, { projectAnnual: mockProjectAnnual(DETAIL_PROJECT.slug, false) });
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    await expect(page.getByTestId('org-roi-project-detail-annual-table')).toBeVisible();
    await expect(page.getByTestId('org-roi-project-detail-efficiency-constant-note')).toHaveCount(0);
  });

  test('drives the apportionment note from the payload flag', async ({ page }) => {
    await stubOrgLensContext(page, { projectAnnual: mockProjectAnnual(DETAIL_PROJECT.slug, true, false) });
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    await expect(page.getByTestId('org-roi-project-detail-apportionment-note')).toHaveCount(0);
  });

  test('shows an explanation, not an empty chart, when the project has no yearly breakdown', async ({ page }) => {
    await stubOrgLensContext(page, {
      projectAnnual: { method: 'logit', projectSlug: DETAIL_PROJECT.slug, rows: [], apportioned: true, efficiencyConstant: true },
    });
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    await expect(page.getByTestId('org-roi-project-detail-annual-empty')).toBeVisible();
    await expect(page.getByTestId('org-roi-project-detail-annual-chart')).toHaveCount(0);
    // A project with no yearly split still has lifetime figures — this is a 200, not a 404.
    await expect(page.getByTestId('org-roi-project-detail-kpi-cards')).toBeVisible();
  });
});

test.describe('Org Lens ROI project detail — onward link', () => {
  test('links into Org Lens when the project has a catalog entry', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    const link = page.getByTestId('org-roi-project-detail-onward-link');
    await expect(link).toHaveAttribute('href', `/org/projects/${DETAIL_PROJECT.slug}`);
    await expect(page.getByTestId('org-roi-project-detail-onward-unavailable')).toHaveCount(0);
  });

  test('explains the absence instead of rendering a link that would 404', async ({ page }) => {
    // Measured 2026-08-05: 32.4% of ROI organization-project pairs have no Org Lens catalog row,
    // so this is a routine outcome and the link must not be rendered unconditionally.
    await stubOrgLensContext(page, { projectDetail: mockProjectDetail(DETAIL_PROJECT.slug, false) });
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    await expect(page.getByTestId('org-roi-project-detail-onward-unavailable')).toBeVisible();
    await expect(page.getByTestId('org-roi-project-detail-onward-link')).toHaveCount(0);
  });
});

test.describe('Org Lens ROI project detail — refusals and absence', () => {
  test('shows a not-found state, not zeros, when the slug names no project of this organization', async ({ page }) => {
    await stubOrgLensContext(page, { projectDetailStatus: 404 });
    await gotoOrgRoiProjectDetail(page, 'someone-elses-project');

    await expect(page.getByTestId('org-roi-project-detail-not-found')).toBeVisible();
    await expect(page.getByTestId('org-roi-project-detail-kpi-cards')).toHaveCount(0);
    // The distinction the 404 exists to preserve: no figure may appear for a project this
    // organization has no measured relationship with.
    await expect(page.getByTestId('org-roi-project-detail-page')).not.toContainText('$0');
  });

  test('distinguishes a refusal from an outage', async ({ page }) => {
    await stubOrgLensContext(page, { projectDetailStatus: 403 });
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    await expect(page.getByTestId('org-roi-project-detail-forbidden')).toBeVisible();
    await expect(page.getByTestId('org-roi-project-detail-error')).toHaveCount(0);
    await expect(page.getByTestId('org-roi-project-detail-not-found')).toHaveCount(0);
  });

  test('shows a retryable error for a 503, never a permissions message', async ({ page }) => {
    await stubOrgLensContext(page, { projectDetailStatus: 503 });
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);

    await expect(page.getByTestId('org-roi-project-detail-error')).toBeVisible();
    await expect(page.getByTestId('org-roi-project-detail-forbidden')).toHaveCount(0);
  });

  test('leaks no ROI figure in any response on the refused path', async ({ page }) => {
    // Asserting only that the UI hides the figures would pass against a handler that refused and
    // leaked at the same time, so this reads the response bodies.
    //
    // The body promises are collected and awaited rather than pushed from a floating `.then()`:
    // reading a bare array can run before any body has resolved, and a loop over an empty array
    // passes having inspected nothing — the assertion would report success precisely when it had
    // checked the least. The count assertion below is the second half of that guard.
    const bodies: Promise<string>[] = [];
    page.on('response', (response) => {
      if (!response.url().includes('/lens/roi/')) return;
      bodies.push(response.text().catch(() => ''));
    });

    await stubOrgLensContext(page, { projectDetailStatus: 403 });
    await gotoOrgRoiProjectDetail(page, DETAIL_PROJECT.slug);
    await expect(page.getByTestId('org-roi-project-detail-forbidden')).toBeVisible();

    const settled = await Promise.all(bodies);
    expect(settled.length).toBeGreaterThan(0);
    for (const body of settled) {
      expect(body).not.toContain('totalExpenditure');
      expect(body).not.toContain('totalReturn');
    }
  });
});

test.describe('Org Lens ROI projects table — navigation to detail', () => {
  test('navigates to the project detail route when a row is selected', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await page.getByTestId('org-roi-projects-section-tab-table').click();
    await page.getByTestId(`org-roi-projects-table-link-prj-${DETAIL_PROJECT.slug}`).click();

    await expect(page).toHaveURL(new RegExp(`${orgRoiProjectDetailUrl(DETAIL_PROJECT.slug)}$`));
    await expect(page.getByTestId('org-roi-project-detail-title')).toHaveText(DETAIL_PROJECT.name);
  });

  // There is deliberately no case here for a project-to-project navigation reusing the component.
  // Nothing in the product links one project detail to another — every route in comes from the
  // table and the only way out is back to it — so that navigation cannot be driven through the UI,
  // and a `page.goto()` between two detail URLs is a full document load that rebuilds the component
  // rather than reusing it. A test written that way asserts nothing about the race it names. The
  // identity guard still checks the slug, because a URL edit or a history entry can reach it, and
  // the estimation-method case above exercises that same guard through a path the UI does produce.

  test('reaches the same project the table row named', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await page.getByTestId('org-roi-projects-section-tab-table').click();
    const row = page.getByTestId(`org-roi-projects-table-row-prj-${DETAIL_PROJECT.slug}`);
    await expect(row).toContainText(formatCurrency(DETAIL_PROJECT.expenditure));

    await row.click();
    await expect(page).toHaveURL(new RegExp(`${orgRoiProjectDetailUrl(DETAIL_PROJECT.slug)}$`));
  });
});
