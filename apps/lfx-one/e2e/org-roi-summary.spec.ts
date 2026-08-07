// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, Route, test } from '@playwright/test';

const ORG_ROI_URL = '/org/roi';
const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';

test.setTimeout(120_000);

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Let malformed URLs fail naturally.
  }
}

async function seedSelectedOrgCookie(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'lfx-selected-account',
      value: JSON.stringify({ uid: MOCK_ACCOUNT_ID }),
      domain: 'localhost',
      path: '/',
    },
  ]);
}

// Only the year still in progress is labelled partial, so the trend fixtures are anchored to the
// current year rather than hardcoded — otherwise these assertions would quietly invert next January.
const CURRENT_YEAR = new Date().getFullYear();

const MOCK_SUMMARY = {
  orgUid: MOCK_ACCOUNT_ID,
  method: 'logit',
  hasData: true,
  nProjects: 407,
  totalExpenditure: 147932363.97,
  totalReturn: 5576366821.32,
  profit: 5428434457.35,
  roi: 36.695,
  bcr: 37.695,
  yearMin: 2010,
  yearMax: CURRENT_YEAR,
  dateMin: '2010-01',
  dateMax: `${CURRENT_YEAR}-08`,
};

const MOCK_COVERAGE = { orgUid: MOCK_ACCOUNT_ID, hasData: true, coverageReason: 'covered' };

function annualRow(year: number, totalReturn: number, expenditure: number): unknown {
  return { year, totalReturn, expenditure, profit: totalReturn - expenditure, roi: 36.5, bcr: 37.5 };
}

const MOCK_ANNUAL = {
  method: 'logit',
  rows: [
    annualRow(CURRENT_YEAR - 2, 1_200_000_000, 32_000_000),
    annualRow(CURRENT_YEAR - 1, 1_400_000_000, 38_000_000),
    annualRow(CURRENT_YEAR, 620_000_000, 17_000_000),
  ],
  apportioned: true,
};

async function stubOrgLensContext(page: Page, options: { hasAccess?: boolean; summary?: unknown; coverage?: unknown; annual?: unknown } = {}): Promise<void> {
  const hasAccess = options.hasAccess ?? true;

  await page.route('**/api/orgs/*/lens/roi/summary*', (route) => fulfillJson(route, options.summary ?? MOCK_SUMMARY));
  await page.route('**/api/orgs/*/lens/roi/coverage*', (route) => fulfillJson(route, options.coverage ?? MOCK_COVERAGE));
  await page.route('**/api/orgs/*/lens/roi/annual*', (route) => fulfillJson(route, options.annual ?? MOCK_ANNUAL));

  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, {
      personas: ['contributor'],
      personaProjects: {},
      projects: [],
      organizations: hasAccess
        ? [{ accountId: MOCK_ACCOUNT_ID, accountName: 'Red Hat, Inc.', accountSlug: 'red-hat', membershipTier: '', uid: MOCK_ACCOUNT_ID }]
        : [],
      isRootWriter: false,
    })
  );

  await page.route('**/api/analytics/org-lens-account-context*', (route) =>
    fulfillJson(route, hasAccess ? [{ accountId: MOCK_ACCOUNT_ID, accountName: 'Red Hat, Inc.', accountSlug: 'red-hat', membershipTier: 'Gold' }] : [])
  );

  await page.route('**/api/orgs/me/role-grants', (route) =>
    fulfillJson(route, {
      writers: hasAccess ? [MOCK_ACCOUNT_ID] : [],
      auditors: [],
      cascadingWriters: [],
      cascadingAuditors: [],
      username: 'e2e-org-roi',
      loaded_at: new Date().toISOString(),
    })
  );

  await page.route('**/api/nav/org-items*', (route) =>
    fulfillJson(route, {
      items: hasAccess
        ? [{ uid: MOCK_ACCOUNT_ID, accountId: MOCK_ACCOUNT_ID, name: 'Red Hat, Inc.', logoUrl: null, primaryDomain: 'redhat.com', isMember: true }]
        : [],
      next_page_token: null,
      upstream_failed: false,
      total: hasAccess ? 1 : 0,
    })
  );
}

async function gotoOrgRoiPage(page: Page): Promise<void> {
  await seedSelectedOrgCookie(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(ORG_ROI_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);
  if (!page.url().includes('/org/roi')) {
    test.skip(true, 'org-lens-roi-enabled flag appears off — /org/roi redirected away');
  }
}

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
    await expect(kpi).toContainText('$5.6B');
    await expect(kpi).toContainText('$147.9M');
    await expect(kpi).toContainText('3669.5%');
    await expect(kpi).toContainText('37.7×');
    await expect(kpi).toContainText('407 projects');
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

    await page.getByTestId('org-roi-assumptions-trigger').click();
    await page.getByTestId('org-roi-assumptions-method-direct').click();

    await summaryRequest;
    await annualRequest;
    await coverageRequest;

    const restoredRequest = page.waitForRequest((req) => req.url().includes('/lens/roi/summary') && req.url().includes('method=direct'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await restoredRequest;

    await page.getByTestId('org-roi-assumptions-trigger').click();
    await expect(page.getByTestId('org-roi-assumptions-method-direct')).toHaveAttribute('aria-pressed', 'true');
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
    await expect(table).toContainText('$620M');
    await expect(table).toContainText('$17M');
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
