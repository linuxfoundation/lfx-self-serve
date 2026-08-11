// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, Route, test } from '@playwright/test';
// Deep-imported, not from the `constants` barrel: the barrel pulls in modules that depend on
// @angular/common and fail to load outside the app, the same trap the specs hit with `utils`.
import { ORG_LENS_ROI_NO_VALUE } from '@lfx-one/shared/constants/org-lens-roi.constants';

/**
 * Written down here rather than imported from the component constants, deliberately.
 *
 * These four numbers are a product contract — how many projects each view promises to draw, and how
 * many the default selection starts with. Importing them would make the assertions restate the
 * implementation: changing the bar cap from 25 to 24 would move the component and the expectation
 * together and the truncation test would still pass, having stopped testing anything. A silent
 * change to any of these should fail here and make someone confirm it was intended.
 */
export const PICKER_DEFAULT_COUNT = 5;
export const BAR_MAX_ROWS = 25;
export const SANKEY_MAX_PROJECTS = 12;
export const BUBBLE_MAX_POINTS = 250;

/** Imported, unlike the ceilings above: a rendering detail rather than a promise to the viewer. */
export const NO_VALUE = ORG_LENS_ROI_NO_VALUE;

export const ORG_ROI_URL = '/org/roi';
export const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';

/**
 * Only the year still in progress is labelled partial, so every year-bearing fixture is anchored to
 * the current year rather than hardcoded — otherwise these assertions would quietly invert next
 * January.
 */
export const CURRENT_YEAR = new Date().getFullYear();

export function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

export function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Let malformed URLs fail naturally.
  }
}

export async function seedSelectedOrgCookie(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'lfx-selected-account',
      value: JSON.stringify({ uid: MOCK_ACCOUNT_ID }),
      domain: 'localhost',
      path: '/',
    },
  ]);
}

/**
 * Real production proportions for Red Hat, with `code` carrying the balance so the eight categories
 * sum to a round-tripped total. Three of them (`meetings`, `membership_tlf`, `educ_courses`) sit
 * under the 2% display threshold, so this fixture also exercises the collapsed remainder.
 */
export const MOCK_CATEGORY_ROWS = [
  { type: 'code', label: 'Code Contribution', expenditure: 101_904_741.07 },
  { type: 'community', label: 'Community Contribution', expenditure: 13_877_843.18 },
  { type: 'meetings', label: 'Meetings', expenditure: 201_358.17 },
  { type: 'event_attendance', label: 'Event Attendance', expenditure: 10_614_558.63 },
  { type: 'event_sponsorship', label: 'Event Sponsorship', expenditure: 4_951_172.72 },
  { type: 'membership_project', label: 'Project Membership', expenditure: 13_650_145.36 },
  { type: 'membership_tlf', label: 'Foundation Membership', expenditure: 2_731_354.84 },
  { type: 'educ_courses', label: 'Education', expenditure: 1_190.0 },
];

/** Three categories fall below the threshold, so the donut renders a remainder for exactly these. */
export const SUB_THRESHOLD_CATEGORY_COUNT = 3;

/**
 * Summed from the rows rather than written down beside them. The category total and the KPI
 * investment figure must be identical, so they must be the *same number* in the fixture —
 * two independently typed literals could drift by a cent and make the test assert the opposite of
 * the invariant it exists to check.
 */
export const TOTAL_INVESTMENT = MOCK_CATEGORY_ROWS.reduce((sum, row) => sum + row.expenditure, 0);

export const MOCK_INVESTMENT_BREAKDOWN = { rows: MOCK_CATEGORY_ROWS, total: TOTAL_INVESTMENT };

export const MOCK_TOTAL_RETURN = 5_576_366_821.32;

export const MOCK_SUMMARY = {
  orgUid: MOCK_ACCOUNT_ID,
  method: 'logit',
  hasData: true,
  nProjects: 407,
  totalExpenditure: TOTAL_INVESTMENT,
  totalReturn: MOCK_TOTAL_RETURN,
  profit: MOCK_TOTAL_RETURN - TOTAL_INVESTMENT,
  roi: 36.695,
  bcr: 37.695,
  yearMin: 2010,
  yearMax: CURRENT_YEAR,
  dateMin: '2010-01',
  dateMax: `${CURRENT_YEAR}-08`,
};

export const MOCK_COVERAGE = { orgUid: MOCK_ACCOUNT_ID, hasData: true, coverageReason: 'covered' };

export function annualRow(year: number, totalReturn: number, expenditure: number): unknown {
  return { year, totalReturn, expenditure, profit: totalReturn - expenditure, roi: 36.5, bcr: 37.5 };
}

export const MOCK_ANNUAL = {
  method: 'logit',
  rows: [
    annualRow(CURRENT_YEAR - 2, 1_200_000_000, 32_000_000),
    annualRow(CURRENT_YEAR - 1, 1_400_000_000, 38_000_000),
    annualRow(CURRENT_YEAR, 620_000_000, 17_000_000),
  ],
  apportioned: true,
};

/**
 * Splits a project's investment across three categories, with the last carrying the balance so the
 * parts sum to the whole exactly. Nothing rescales this client-side.
 */
function projectCategories(totalExpenditure: number): { type: string; label: string; expenditure: number }[] {
  const code = Math.round(totalExpenditure * 0.7 * 100) / 100;
  const community = Math.round(totalExpenditure * 0.2 * 100) / 100;
  return [
    { type: 'code', label: 'Code Contribution', expenditure: code },
    { type: 'community', label: 'Community Contribution', expenditure: community },
    { type: 'meetings', label: 'Meetings', expenditure: totalExpenditure - code - community },
  ];
}

/**
 * `profit`, `roi` and `bcr` are derived once here, standing in for the metric layer that defines
 * them once. The client must never re-derive them from the other fields.
 */
function projectRow(projectSlug: string, projectName: string, totalExpenditure: number, totalReturn: number): unknown {
  const profit = totalReturn - totalExpenditure;
  return {
    projectId: `prj-${projectSlug}`,
    projectSlug,
    projectName,
    totalExpenditure,
    totalReturn,
    profit,
    roi: totalExpenditure > 0 ? profit / totalExpenditure : null,
    bcr: totalExpenditure > 0 ? totalReturn / totalExpenditure : null,
    breakevenMarkup: 0.331,
    categories: projectCategories(totalExpenditure),
  };
}

/**
 * Eight projects: enough that the leading slices leave a labelled remainder on every measure, and
 * two of them lose money. Negative net return is 6.45% of production project rows across 775
 * organizations — a mainline path, so the fixture carries it by default rather than in a variant.
 */
export const MOCK_PROJECT_INPUTS = [
  { slug: 'kubernetes', name: 'Kubernetes', expenditure: 60_000_000, return: 3_000_000_000 },
  { slug: 'openstack', name: 'OpenStack', expenditure: 40_000_000, return: 1_500_000_000 },
  { slug: 'ceph', name: 'Ceph', expenditure: 25_000_000, return: 700_000_000 },
  { slug: 'podman', name: 'Podman', expenditure: 12_000_000, return: 200_000_000 },
  { slug: 'fedora-infra', name: 'Fedora Infrastructure', expenditure: 6_000_000, return: 80_000_000 },
  { slug: 'ansible-docs', name: 'Ansible Docs', expenditure: 3_000_000, return: 20_000_000 },
  { slug: 'legacy-bridge', name: 'Legacy Bridge', expenditure: 2_000_000, return: 500_000 },
  { slug: 'sunset-tooling', name: 'Sunset Tooling', expenditure: 1_000_000, return: 250_000 },
];

export const MOCK_PROJECTS = {
  method: 'logit',
  rows: MOCK_PROJECT_INPUTS.map((input) => projectRow(input.slug, input.name, input.expenditure, input.return)),
};

/** The two loss-making projects, in the order the donut ranks them (net return, descending). */
export const NEGATIVE_PROJECTS = MOCK_PROJECT_INPUTS.filter((input) => input.return < input.expenditure)
  .map((input) => ({ name: input.name, profit: input.return - input.expenditure }))
  .sort((a, b) => b.profit - a.profit);

export const NEGATIVE_PROJECTS_TOTAL = NEGATIVE_PROJECTS.reduce((sum, project) => sum + project.profit, 0);

/**
 * The payload arrives ordered by return descending, and the projects section takes its default
 * selection straight off the front of it. Derived here rather than listed, so reordering the
 * fixture above cannot leave this silently describing the wrong five.
 */
export const PROJECTS_BY_RETURN = [...MOCK_PROJECT_INPUTS].sort((a, b) => b.return - a.return);

export const DEFAULT_SELECTED_PROJECTS = PROJECTS_BY_RETURN.slice(0, PICKER_DEFAULT_COUNT);

export const UNSELECTED_PROJECT = PROJECTS_BY_RETURN[PICKER_DEFAULT_COUNT];

/**
 * Several hundred projects, for paging the table and for the truncation disclosures the chart views
 * show when "All" is selected. Returns descend with the index so the ordering is unambiguous.
 */
export const MANY_PROJECT_COUNT = 300;

export const MANY_PROJECT_INPUTS = Array.from({ length: MANY_PROJECT_COUNT }, (unused, index) => ({
  slug: `project-${String(index).padStart(3, '0')}`,
  name: `Project ${String(index).padStart(3, '0')}`,
  expenditure: 1_000_000 + (MANY_PROJECT_COUNT - index) * 1_000,
  return: (MANY_PROJECT_COUNT - index) * 10_000_000,
}));

export const MANY_PROJECTS = {
  method: 'logit',
  rows: MANY_PROJECT_INPUTS.map((input) => projectRow(input.slug, input.name, input.expenditure, input.return)),
};

/**
 * A project with no investment. The warehouse returns NULL — never zero — for a ratio it cannot
 * divide, and the table must render that as the no-value indicator rather than as 0.
 */
export const NO_INVESTMENT_PROJECT = {
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
};

export const PROJECTS_WITH_NULL_RATIOS = { method: 'logit', rows: [...MOCK_PROJECTS.rows, NO_INVESTMENT_PROJECT] };

interface StubOptions {
  hasAccess?: boolean;
  summary?: unknown;
  coverage?: unknown;
  annual?: unknown;
  investmentBreakdown?: unknown;
  projects?: unknown;
}

export async function stubOrgLensContext(page: Page, options: StubOptions = {}): Promise<void> {
  const hasAccess = options.hasAccess ?? true;

  await page.route('**/api/orgs/*/lens/roi/summary*', (route) => fulfillJson(route, options.summary ?? MOCK_SUMMARY));
  await page.route('**/api/orgs/*/lens/roi/coverage*', (route) => fulfillJson(route, options.coverage ?? MOCK_COVERAGE));
  await page.route('**/api/orgs/*/lens/roi/annual*', (route) => fulfillJson(route, options.annual ?? MOCK_ANNUAL));
  await page.route('**/api/orgs/*/lens/roi/investment-breakdown*', (route) => fulfillJson(route, options.investmentBreakdown ?? MOCK_INVESTMENT_BREAKDOWN));
  await page.route('**/api/orgs/*/lens/roi/projects*', (route) => fulfillJson(route, options.projects ?? MOCK_PROJECTS));

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

export async function gotoOrgRoiPage(page: Page): Promise<void> {
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
