// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
// Imported from the module, not the `utils` barrel: the barrel re-exports form.utils, which pulls
// in @angular/common and fails to load outside the Angular app with a JIT compiler error.
import { formatCurrency, formatPercent } from '@lfx-one/shared/utils/number.utils';

import {
  annualRow,
  CURRENT_YEAR,
  fulfillJson,
  gotoOrgRoiPage,
  MOCK_ACCOUNT_ID,
  MOCK_ANNUAL,
  MOCK_CATEGORY_ROWS,
  MOCK_SUMMARY,
  ORG_ROI_URL,
  skipWhenAuthMissing,
  stubOrgLensContext,
  SUB_THRESHOLD_CATEGORY_COUNT,
  TOTAL_INVESTMENT,
} from './helpers/org-roi.helper';

test.setTimeout(120_000);

/**
 * Every expected string below is derived from the fixture through the same formatter the component
 * uses — never written out by hand. US2 shipped three defects to human review that this rule would
 * have caught on its own, including a benefit-cost expectation of `36.7×` for a fixture that
 * renders `37.7×`.
 */
const EXPECTED_INVESTMENT = formatCurrency(TOTAL_INVESTMENT);
const EXPECTED_RETURN = formatCurrency(MOCK_SUMMARY.totalReturn);
const EXPECTED_ROI = `${formatPercent(MOCK_SUMMARY.roi * 100)}%`;
const EXPECTED_BCR = `${MOCK_SUMMARY.bcr.toFixed(1)}×`;
const EXPECTED_PROJECT_COUNT = `${MOCK_SUMMARY.nProjects.toLocaleString('en-US')} projects`;

const LATEST_ANNUAL = MOCK_ANNUAL.rows[MOCK_ANNUAL.rows.length - 1] as { year: number; totalReturn: number; expenditure: number };

test.describe('Org Lens ROI Metrics — portfolio summary', () => {
  test('renders the page shell and the four headline figures', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ROI Metrics' })).toBeVisible();
    // Derived from the same CURRENT_YEAR the fixture uses; a hardcoded end year would fail every January.
    await expect(page.getByTestId('org-roi-window')).toContainText(`2010–${CURRENT_YEAR}`);

    const kpi = page.getByTestId('org-roi-kpi-cards');
    await expect(kpi).toBeVisible();
    await expect(kpi).toContainText(EXPECTED_RETURN);
    await expect(kpi).toContainText(EXPECTED_INVESTMENT);
    await expect(kpi).toContainText(EXPECTED_ROI);
    await expect(kpi).toContainText(EXPECTED_BCR);
    await expect(kpi).toContainText(EXPECTED_PROJECT_COUNT);
  });

  test('discloses that the investment figure is a modelled cost, not compensation', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await page.getByTestId('org-roi-kpi-explanations-toggle').click();
    const investment = page.getByTestId('org-roi-kpi-explanation-total-expenditure');
    await expect(investment).toBeVisible();
    await expect(investment).toContainText('modelled cost');
    await expect(investment).toContainText('not actual or reported compensation');
    await expect(investment).toContainText('same for every organization');
    await expect(investment).toContainText('No salary, payroll, or invoice data is used.');
  });

  test('renders the annual trend with its apportionment and partial-year disclosures', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const trend = page.getByTestId('org-roi-annual-trend');
    await expect(trend).toBeVisible();
    await expect(page.getByTestId('org-roi-annual-trend-chart')).toBeVisible();

    const note = page.getByTestId('org-roi-annual-trend-apportionment-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('apportioned from lifetime totals');
    await expect(note).toContainText('not measured independently for each year');

    await expect(page.getByTestId('org-roi-annual-trend-partial-year-note')).toContainText(`${CURRENT_YEAR} is a partial year`);
  });

  test('does not call a completed final year partial', async ({ page }) => {
    // An organization whose activity stopped years ago has a complete last year. Labelling it
    // "still accruing" would misexplain a genuine decline as a calendar artefact.
    await stubOrgLensContext(page, {
      annual: {
        ...MOCK_ANNUAL,
        rows: [annualRow(CURRENT_YEAR - 4, 900_000_000, 24_000_000), annualRow(CURRENT_YEAR - 3, 700_000_000, 19_000_000)],
      },
    });
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-annual-trend-chart')).toBeVisible();
    await expect(page.getByTestId('org-roi-annual-trend-partial-year-note')).toHaveCount(0);
    // The apportionment disclosure is unconditional and must survive independently.
    await expect(page.getByTestId('org-roi-annual-trend-apportionment-note')).toBeVisible();
  });

  test('omits the apportionment disclosure when the payload says the figures are measured', async ({ page }) => {
    await stubOrgLensContext(page, { annual: { ...MOCK_ANNUAL, apportioned: false } });
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-annual-trend-chart')).toBeVisible();
    await expect(page.getByTestId('org-roi-annual-trend-apportionment-note')).toHaveCount(0);
  });

  test('presents the drawer rate inputs as global constants, not this organization\u2019s figures', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await page.getByTestId('org-roi-assumptions-trigger').click();
    await expect(page.getByTestId('org-roi-assumptions-drawer-title')).toBeVisible();

    const scope = page.getByTestId('org-roi-assumptions-rates-scope');
    await expect(scope).toContainText('global constants');
    await expect(scope).toContainText('applied identically to every organization');
    await expect(scope).toContainText('not specific to your organization');

    await expect(page.getByTestId('org-roi-assumptions-rates')).toContainText('$200,000');
    await expect(page.getByTestId('org-roi-assumptions-rates')).toContainText('$150,000');
    await expect(page.getByTestId('org-roi-assumptions-rates-readonly-note')).toContainText('cannot be recalculated');
    await expect(page.getByTestId('org-roi-assumptions-rates').locator('input')).toHaveCount(0);
  });

  test('switching estimation method refetches every surface and persists across visits', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    // Assert on the outgoing requests: both methods return the same stub, so a missing refetch is otherwise invisible.
    const summaryRequest = page.waitForRequest((req) => req.url().includes('/lens/roi/summary') && req.url().includes('method=direct'));
    const annualRequest = page.waitForRequest((req) => req.url().includes('/lens/roi/annual') && req.url().includes('method=direct'));
    // Coverage is method-scoped too: it reports whether *this* method produced figures, so a
    // coverage answer left on the previous method could contradict the summary it explains.
    const coverageRequest = page.waitForRequest((req) => req.url().includes('/lens/roi/coverage') && req.url().includes('method=direct'));
    const projectsRequest = page.waitForRequest((req) => req.url().includes('/lens/roi/projects') && req.url().includes('method=direct'));

    await page.getByTestId('org-roi-assumptions-trigger').click();
    await page.getByTestId('org-roi-assumptions-method-direct').click();

    await summaryRequest;
    await annualRequest;
    await coverageRequest;
    await projectsRequest;

    const restoredRequest = page.waitForRequest((req) => req.url().includes('/lens/roi/summary') && req.url().includes('method=direct'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await restoredRequest;

    await page.getByTestId('org-roi-assumptions-trigger').click();
    await expect(page.getByTestId('org-roi-assumptions-method-direct')).toHaveAttribute('aria-pressed', 'true');
  });

  test('never sends an estimation method to the category breakdown, which cannot vary by one', async ({ page }) => {
    // The source table has no MARKUP_METHOD column, so a method-bearing request would imply a
    // distinction the warehouse does not make — and invite a pointless refetch on every switch.
    const breakdownUrls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/lens/roi/investment-breakdown')) breakdownUrls.push(request.url());
    });

    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);
    await expect(page.getByTestId('org-roi-category-donut-chart')).toBeVisible();

    expect(breakdownUrls.length).toBeGreaterThan(0);
    for (const url of breakdownUrls) {
      expect(url).not.toContain('method=');
    }
  });

  test('explains an unmapped organization without implying a pending fix', async ({ page }) => {
    await stubOrgLensContext(page, {
      summary: { ...MOCK_SUMMARY, hasData: false, totalExpenditure: null, totalReturn: null, profit: null, roi: null, bcr: null },
      coverage: { orgUid: MOCK_ACCOUNT_ID, hasData: false, coverageReason: 'unmapped' },
    });
    await gotoOrgRoiPage(page);

    const empty = page.getByTestId('org-roi-empty-state-unmapped');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("isn't linked to a contributor community record");
    await expect(page.getByTestId('org-roi-kpi-cards')).toHaveCount(0);
    await expect(page.getByTestId('org-roi-category-donut')).toHaveCount(0);
  });

  test('explains a mapped-but-unestimated organization without promising later figures', async ({ page }) => {
    await stubOrgLensContext(page, {
      summary: { ...MOCK_SUMMARY, hasData: false, totalExpenditure: null, totalReturn: null, profit: null, roi: null, bcr: null },
      coverage: { orgUid: MOCK_ACCOUNT_ID, hasData: false, coverageReason: 'not_estimated' },
    });
    await gotoOrgRoiPage(page);

    const empty = page.getByTestId('org-roi-empty-state-not-estimated');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("didn't produce ROI figures");
    await expect(empty).toContainText('counted there instead');
    await expect(empty).not.toContainText('check back');
    await expect(empty).not.toContainText('later run');
    await expect(empty).not.toContainText('may appear');
    await expect(page.getByTestId('org-roi-empty-state-unmapped')).toHaveCount(0);
  });

  test('keeps the method control reachable on the empty state', async ({ page }) => {
    // Coverage is method-scoped, so a method with no rows lands on the empty state. If the drawer
    // holding the only method control were hidden there, that state would be a dead end — the
    // viewer could not switch back and previously visible figures would stay unreachable until
    // browser storage was cleared.
    await stubOrgLensContext(page, {
      summary: { ...MOCK_SUMMARY, hasData: false, totalExpenditure: null, totalReturn: null, profit: null, roi: null, bcr: null },
      coverage: { orgUid: MOCK_ACCOUNT_ID, hasData: false, coverageReason: 'not_estimated' },
    });
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-empty-state')).toBeVisible();
    const trigger = page.getByTestId('org-roi-assumptions-trigger');
    await expect(trigger).toBeVisible();

    await trigger.click();
    await expect(page.getByTestId('org-roi-assumptions-method-logit')).toBeVisible();
    await expect(page.getByTestId('org-roi-assumptions-method-direct')).toBeVisible();
  });

  test('exposes the yearly series to assistive technology, not only as a canvas', async ({ page }) => {
    // The chart is a canvas, so without this table the per-year values are unavailable to a screen
    // reader. `sr-only` keeps it out of the visual layout while leaving it in the accessibility
    // tree, so assert on its contents rather than its visibility.
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const table = page.getByTestId('org-roi-annual-trend-table');
    await expect(table).toBeAttached();
    await expect(table).toContainText('Year');
    await expect(table).toContainText('Investment');
    await expect(table).toContainText('Return');
    // Same figures as the chart, through the same formatter.
    await expect(table).toContainText(`${CURRENT_YEAR}`);
    await expect(table).toContainText(formatCurrency(LATEST_ANNUAL.totalReturn));
    await expect(table).toContainText(formatCurrency(LATEST_ANNUAL.expenditure));
    await expect(table).toContainText('partial year');

    await expect(page.getByTestId('org-roi-annual-trend-chart')).toHaveAttribute('aria-label', /investment and return by year/i);
  });

  test('renders the no-value indicator rather than zero when there is no investment to divide by', async ({ page }) => {
    await stubOrgLensContext(page, {
      summary: { ...MOCK_SUMMARY, totalExpenditure: 0, totalReturn: 0, profit: 0, roi: null, bcr: null },
    });
    await gotoOrgRoiPage(page);

    const kpi = page.getByTestId('org-roi-kpi-cards');
    await expect(kpi).toBeVisible();
    await expect(kpi).toContainText('—');
    await expect(kpi).not.toContainText('0.0%');
  });

  test('refuses an ungranted caller with no ROI figure anywhere in the response', async ({ page }) => {
    await stubOrgLensContext(page);
    await page.route('**/api/orgs/*/lens/roi/**', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'FORBIDDEN', message: 'You do not have access to Org Lens data for this organization.' }),
      })
    );

    const responses: string[] = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/lens/roi/')) return;
      responses.push(await response.text().catch(() => ''));
    });

    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-forbidden')).toBeVisible();
    await expect(page.getByTestId('org-roi-forbidden')).toContainText('do not have Org Lens access');
    await expect(page.getByTestId('org-roi-kpi-cards')).toHaveCount(0);

    expect(responses.length).toBeGreaterThan(0);
    for (const body of responses) {
      expect(body).not.toContain('totalExpenditure');
      expect(body).not.toContain('totalReturn');
      // US3 and US4 added two more payloads that carry investment; a refusal must leak neither.
      expect(body).not.toContain('expenditure');
      expect(body).not.toContain('categories');
    }
  });

  test('distinguishes a 503 verification failure from a 403 refusal', async ({ page }) => {
    await stubOrgLensContext(page);
    await page.route('**/api/orgs/*/lens/roi/**', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'ROLE_GRANTS_UNAVAILABLE' }) })
    );
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-error')).toBeVisible();
    await expect(page.getByTestId('org-roi-error')).toContainText("couldn't be loaded");
    await expect(page.getByTestId('org-roi-forbidden')).toHaveCount(0);
  });

  test('renders the no-company empty state when no account is selected', async ({ page }) => {
    await stubOrgLensContext(page, { hasAccess: true });
    await page.route('**/api/user/personas*', (route) =>
      fulfillJson(route, { personas: ['contributor'], personaProjects: {}, projects: [], organizations: [], isRootWriter: false })
    );
    await page.route('**/api/nav/org-items*', (route) => fulfillJson(route, { items: [], next_page_token: null, upstream_failed: false, total: 0 }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto(ORG_ROI_URL, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    if (!page.url().includes('/org/roi')) {
      test.skip(true, 'org-lens-roi-enabled flag appears off — /org/roi redirected away');
    }

    await expect(page.getByTestId('org-roi-no-company-empty-state')).toBeVisible();
    await expect(page.getByTestId('org-roi-kpi-cards')).toHaveCount(0);
  });

  test('renders the no-access state when the caller has no org selector access', async ({ page }) => {
    await stubOrgLensContext(page, { hasAccess: false });
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-no-access-state')).toBeVisible();
    await expect(page.getByTestId('org-roi-kpi-cards')).toHaveCount(0);
    await expect(page.getByTestId('org-roi-no-company-empty-state')).toHaveCount(0);
  });
});

test.describe('Org Lens ROI Metrics — investment by category', () => {
  test('renders every above-threshold category with its shared label', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const legend = page.getByTestId('org-roi-category-donut-legend');
    await expect(page.getByTestId('org-roi-category-donut')).toBeVisible();
    await expect(legend).toBeVisible();

    // The labels come from the warehouse seed, so the fixture's own labels are the expectation.
    for (const row of MOCK_CATEGORY_ROWS) {
      const isSubThreshold = row.expenditure / TOTAL_INVESTMENT < 0.02;
      if (isSubThreshold) continue;
      await expect(legend).toContainText(row.label);
      await expect(legend).toContainText(formatCurrency(row.expenditure));
    }
  });

  test('collapses sub-threshold categories into one remainder labelled with its count', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const legend = page.getByTestId('org-roi-category-donut-legend');
    await expect(legend).toContainText(`Other (${SUB_THRESHOLD_CATEGORY_COUNT} categories)`);

    // The smallest category is $1,190 against a $148M total — a slice too thin to see and a legend
    // entry too small to read, which is what FR-025's threshold exists to prevent.
    const smallest = MOCK_CATEGORY_ROWS.reduce((min, row) => (row.expenditure < min.expenditure ? row : min));
    await expect(legend).not.toContainText(smallest.label);
  });

  test('reports a category total identical to the KPI investment figure', async ({ page }) => {
    // FR-026 / SC-011. The warehouse reconciles these by construction and a dbt singular test
    // asserts it per account, so any difference here is a defect — never rescaled client-side to
    // force agreement, which is what the reference implementation does (FR-011b).
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    // Tie the rendered total to the category rows themselves, not merely to the fixture's `total`
    // field: a component that displayed anything else would otherwise pass.
    const summedFromCategories = formatCurrency(MOCK_CATEGORY_ROWS.reduce((sum, row) => sum + row.expenditure, 0));

    await expect(page.getByTestId('org-roi-category-donut-total')).toHaveText(summedFromCategories);
    await expect(page.getByTestId('org-roi-kpi-cards')).toContainText(summedFromCategories);
    expect(summedFromCategories).toBe(EXPECTED_INVESTMENT);
  });

  test('switches the category display between currency and share of total', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const legend = page.getByTestId('org-roi-category-donut-legend');
    const code = MOCK_CATEGORY_ROWS[0];
    const codeShare = `${formatPercent((code.expenditure / TOTAL_INVESTMENT) * 100)}%`;

    await expect(legend).toContainText(formatCurrency(code.expenditure));

    await page.getByTestId('org-roi-category-donut-units-share').click();
    await expect(legend).toContainText(codeShare);
    await expect(legend).not.toContainText(formatCurrency(code.expenditure));

    await page.getByTestId('org-roi-category-donut-units-amount').click();
    await expect(legend).toContainText(formatCurrency(code.expenditure));
    // The total stays a currency figure in both modes — it is the reconciliation anchor.
    await expect(page.getByTestId('org-roi-category-donut-total')).toHaveText(EXPECTED_INVESTMENT);
  });

  test('carries the modelled-cost disclosure on the category breakdown', async ({ page }) => {
    // The surface the privacy audit was most concerned about: 19.4% of covered organizations have a
    // single code contributor, so "Code Contribution: $101.9M" can read as one person's pay.
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    const note = page.getByTestId('org-roi-category-donut-modelled-cost-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('modelled cost');
    await expect(note).toContainText('not actual or reported compensation');
    await expect(note).toContainText('same for every organization');
    await expect(note).toContainText('No salary, payroll, or invoice data is used.');
  });

  test('names the chart for assistive technology and lists its values as text', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-category-donut-chart')).toHaveAttribute('aria-label', /doughnut chart of modelled investment/i);
    await expect(page.getByTestId('org-roi-category-donut-legend')).toBeVisible();
  });

  test('shows an empty category breakdown without erroring', async ({ page }) => {
    await stubOrgLensContext(page, { investmentBreakdown: { rows: [], total: 0 } });
    await gotoOrgRoiPage(page);

    await expect(page.getByTestId('org-roi-category-donut-empty')).toBeVisible();
    await expect(page.getByTestId('org-roi-category-donut-chart')).toHaveCount(0);
  });
});
