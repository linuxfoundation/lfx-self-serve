// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, Route, test } from '@playwright/test';

const ORG_MEETINGS_URL = '/org/meetings';
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

const MOCK_KPI_SUMMARY = {
  employeesActive: 63,
  employeesActiveDeltaLabel: '+8% vs. prior period',
  employeesActiveDeltaDirection: 'up',
  meetingsAttended: 512,
  meetingsAttendedDeltaLabel: '+12% vs. prior period',
  meetingsAttendedDeltaDirection: 'up',
  projectsSupported: 47,
  projectsSupportedDeltaLabel: 'New',
  projectsSupportedDeltaDirection: 'up',
  foundationsSupported: 30,
  foundationsSupportedDeltaLabel: 'No change vs. prior period',
  foundationsSupportedDeltaDirection: 'flat',
};

const MOCK_SPEND_BREAKDOWN = {
  byFoundation: [
    { label: 'CNCF', pct: 62, count: 1240 },
    { label: '12 others', pct: 38, count: 760, others: [{ label: 'OpenSSF', pct: 20 }] },
  ],
  byProject: [
    { label: 'Kubernetes', pct: 55, count: 1100 },
    { label: 'PyTorch', pct: 45, count: 900 },
  ],
  byMeetingType: [{ label: 'Technical', pct: 100, count: 2000 }],
  byRole: [{ label: 'Participant', pct: 100, count: 2000 }],
};

function mockInfluenceRow(project: string, projectSlug: string, deltaLabel = '+6%', deltaDirection = 'up'): unknown {
  return {
    project,
    projectSlug,
    ecosystemInfluence: 88,
    // Smaller than `ecosystemInfluence` by the membership-tier component, as the warehouse emits it —
    // the expanded sentence must quote the percentage against this figure, not the headline one.
    displayedInfluence: 87,
    band: 'leading',
    rankLabel: '#3 of 210',
    rankTotalAll: 11688,
    fromAttendancePct: 15,
    deltaLabel,
    deltaDirection,
    // Nine entries summing to exactly 100.0, matching the warehouse's largest-remainder guarantee.
    breakdown: [
      { label: 'Collaboration Activity', pct: 30.2 },
      { label: 'Board Members', pct: 20.1 },
      { label: 'Meeting Attendance', pct: 15 },
      { label: 'Committee Members', pct: 12.3 },
      { label: 'Event Attendance', pct: 8.4 },
      { label: 'Event Speakers', pct: 6 },
      { label: 'Event Sponsorships', pct: 4 },
      { label: 'Meetup Attendance', pct: 2.5 },
      { label: 'Certified Individuals', pct: 1.5 },
    ],
  };
}

const MOCK_INFLUENCE_ROWS = [mockInfluenceRow('Kubernetes', 'kubernetes'), mockInfluenceRow('PyTorch', 'pytorch')];

// Stub what the org lens needs to render: personas + account context, the three meetings-insights
// endpoints (LFXV2-2735), plus role-grants/nav-items so `OrgMeetingsComponent.loaded()` /
// `hasNoOrgAccess()` (which gate on both services) settle deterministically instead of hitting
// environment-specific BFF responses.
async function stubOrgLensContext(page: Page, options: { hasAccess?: boolean; spend?: unknown; influence?: unknown } = {}): Promise<void> {
  const hasAccess = options.hasAccess ?? true;

  await page.route('**/api/orgs/*/lens/meetings/kpi*', (route) => fulfillJson(route, MOCK_KPI_SUMMARY));
  await page.route('**/api/orgs/*/lens/meetings/spend*', (route) => fulfillJson(route, options.spend ?? MOCK_SPEND_BREAKDOWN));
  await page.route('**/api/orgs/*/lens/meetings/influence*', (route) => fulfillJson(route, options.influence ?? MOCK_INFLUENCE_ROWS));

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
      username: 'e2e-org-meetings',
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

async function gotoOrgMeetingsPage(page: Page): Promise<void> {
  await seedSelectedOrgCookie(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(ORG_MEETINGS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);
  if (!page.url().includes('/org/meetings')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/meetings redirected away');
  }
}

test.describe('Org Meetings insights (6a redesign)', () => {
  test('renders the page shell with default 365-day KPI values', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgMeetingsPage(page);

    await expect(page.getByTestId('org-meetings-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meetings' })).toBeVisible();
    await expect(page.getByTestId('org-meetings-time-range')).toBeVisible();

    const kpiCards = page.getByTestId('org-meetings-kpi-cards');
    await expect(kpiCards).toBeVisible();
    await expect(kpiCards).toContainText('63');
    await expect(kpiCards).toContainText('512');
    await expect(kpiCards).toContainText('47');
    await expect(kpiCards).toContainText('30');
  });

  test('renders the "where your people spend time" ranked percentage bars', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgMeetingsPage(page);

    const spend = page.getByTestId('org-meetings-spend-breakdown');
    await expect(spend).toBeVisible();
    await expect(page.getByTestId('org-spend-bar-by-foundation')).toBeVisible();
    await expect(page.getByTestId('org-spend-bar-by-project')).toBeVisible();
    await expect(page.getByTestId('org-spend-bar-by-meeting-type')).toBeVisible();
    await expect(page.getByTestId('org-spend-bar-by-role')).toBeVisible();
    await expect(spend).toContainText('CNCF');
  });

  test('renders the influence table with all rows collapsed by default', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgMeetingsPage(page);

    const influence = page.getByTestId('org-meetings-influence');
    await expect(influence).toBeVisible();
    await expect(influence).toContainText('+6%');
    // The delta compares against the preceding window of equal length, so a "year over year" header
    // would describe a comparison the page is not making at any sub-annual range.
    await expect(influence).not.toContainText('YoY');
    await expect(influence).not.toContainText('year over year');
    await expect(influence).toContainText('Δ vs. prior period');

    // All rows start collapsed, so no detail rows are rendered.
    await expect(page.getByTestId('org-meetings-influence-row-kubernetes-detail')).toHaveCount(0);
    await expect(page.getByTestId('org-meetings-influence-row-pytorch-detail')).toHaveCount(0);

    // Expanding Kubernetes via its caret reveals the detail row.
    await page.getByTestId('org-meetings-influence-row-kubernetes-caret').click();
    const kubernetesDetail = page.getByTestId('org-meetings-influence-row-kubernetes-detail');
    await expect(kubernetesDetail).toBeVisible();
    await expect(kubernetesDetail).toContainText('Meeting Attendance');

    // Expanding PyTorch via its caret reveals its detail row too.
    await page.getByTestId('org-meetings-influence-row-pytorch-caret').click();
    await expect(page.getByTestId('org-meetings-influence-row-pytorch-detail')).toBeVisible();

    // Collapsing Kubernetes via its caret removes the detail row.
    await page.getByTestId('org-meetings-influence-row-kubernetes-caret').click();
    await expect(page.getByTestId('org-meetings-influence-row-kubernetes-detail')).toHaveCount(0);
  });

  test('renders no-change influence deltas without the YoY suffix', async ({ page }) => {
    await stubOrgLensContext(page, {
      influence: [mockInfluenceRow('Kubernetes', 'kubernetes', 'No change', 'flat')],
    });
    await gotoOrgMeetingsPage(page);

    const influence = page.getByTestId('org-meetings-influence');
    await expect(influence).toBeVisible();
    await expect(influence).toContainText('No change');
    await expect(influence).not.toContainText('YoY');
  });

  test('switching time range refetches with the selected window', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgMeetingsPage(page);

    // Assert on the outgoing request, not just the rendered label — both windows return the same
    // stub, so a refetch that never fires (or sends the wrong range) is otherwise invisible.
    const kpiRequest = page.waitForRequest((req) => req.url().includes('/lens/meetings/kpi') && req.url().includes('range=previousYear'));
    const spendRequest = page.waitForRequest((req) => req.url().includes('/lens/meetings/spend') && req.url().includes('range=previousYear'));
    // The influence table used to sit out the selector entirely; this is the assertion that catches
    // it silently going back to a fixed window.
    const influenceRequest = page.waitForRequest((req) => req.url().includes('/lens/meetings/influence') && req.url().includes('range=previousYear'));

    await page.getByTestId('org-meetings-time-range').click();
    await page.getByTestId('org-meetings-time-range-option-previousYear').click();

    await kpiRequest;
    await spendRequest;
    await influenceRequest;
    await expect(page.getByTestId('org-meetings-time-range-label')).toHaveText('Previous year');
    await expect(page.getByTestId('org-meetings-kpi-cards')).toBeVisible();
  });

  test('offers the unserved time ranges as unavailable and refuses to select them', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgMeetingsPage(page);

    await page.getByTestId('org-meetings-time-range').click();

    // "All time" and "Custom" have no warehouse window behind them. They stay focusable so keyboard
    // users can discover that the option exists but is unavailable; select() refuses the activation.
    // Wait for the panel to actually render before reading attributes; on a cold server the options
    // can be in the DOM a tick before their bindings resolve, which made this assertion flaky.
    const allTime = page.getByTestId('org-meetings-time-range-option-allTime');
    await expect(allTime).toBeVisible();
    await expect(allTime).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('org-meetings-time-range-option-custom')).toHaveAttribute('aria-disabled', 'true');

    // `force` only bypasses Playwright's actionability check; because the button is not natively
    // disabled the DOM event really is dispatched, so this exercises select()'s early return rather
    // than the browser silently swallowing the click.
    await allTime.click({ force: true });
    await expect(page.getByTestId('org-meetings-time-range-label')).toHaveText('Past 365 days');

    // A served window must still be selectable — the guard rejects only the unavailable options.
    await page.getByTestId('org-meetings-time-range-option-past90d').click();
    await expect(page.getByTestId('org-meetings-time-range-label')).toHaveText('Past 90 days');
  });

  test('shows a per-section error state when the endpoints fail', async ({ page }) => {
    await stubOrgLensContext(page);
    await page.route('**/api/orgs/*/lens/meetings/**', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'ROLE_GRANTS_UNAVAILABLE' }) })
    );
    await gotoOrgMeetingsPage(page);

    await expect(page.getByTestId('org-meetings-kpi-cards-error')).toBeVisible();
    await expect(page.getByTestId('org-meetings-spend-breakdown-error')).toBeVisible();
    await expect(page.getByTestId('org-meetings-influence-error')).toBeVisible();
  });

  test('explains an empty influence table rather than leaving it blank', async ({ page }) => {
    await stubOrgLensContext(page, { influence: [] });
    await gotoOrgMeetingsPage(page);

    const empty = page.getByTestId('org-meetings-influence-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('published Ecosystem Influence Score');
    // Narrow windows make this state common, so the copy has to name the window too — otherwise it
    // reads as "your organization has no project influence at all".
    await expect(empty).toContainText('past 365 days');
  });

  test('renders a breakdown whose nine percentages sum to exactly 100', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgMeetingsPage(page);

    await page.getByTestId('org-meetings-influence-row-kubernetes-caret').click();
    const detail = page.getByTestId('org-meetings-influence-row-kubernetes-detail');
    await expect(detail).toBeVisible();

    const percentages = await detail.locator('span', { hasText: /^\d+(\.\d+)?%$/ }).allInnerTexts();
    expect(percentages).toHaveLength(9);
    const sum = percentages.reduce((total, text) => total + Number.parseFloat(text), 0);
    expect(Math.abs(sum - 100)).toBeLessThan(0.001);
  });

  test('marks the two cumulative breakdown measures and explains the rank denominator', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgMeetingsPage(page);

    // The rank denominator counts only project-specific engagement, so it is orders of magnitude
    // smaller than the foundation-wide figure the Organization Dashboard publishes. The tooltip is
    // the only thing that keeps the difference from reading as data loss.
    const rank = page.getByTestId('org-meetings-influence-row-kubernetes-rank');
    await expect(rank).toHaveAttribute('aria-label', /contributed code or attended meetings/);
    await expect(rank).toHaveAttribute('aria-label', /Across the last 2 years, 11,688 companies/);

    await page.getByTestId('org-meetings-influence-row-kubernetes-caret').click();
    const detail = page.getByTestId('org-meetings-influence-row-kubernetes-detail');
    // Board and committee membership do not follow the window, so they carry a qualifier.
    await expect(detail).toContainText('Board Members (all time)');
    await expect(detail).toContainText('Committee Members (all time)');
    await expect(detail).toContainText('Collaboration Activity');
    await expect(detail).not.toContainText('Collaboration Activity (all time)');
  });

  test('hides the meeting-type and role cards when the org is too small to aggregate', async ({ page }) => {
    // The small-org safeguard returns empty arrays rather than omitting the keys, so an empty card
    // would read as "attends no typed meetings" instead of "withheld".
    await stubOrgLensContext(page, { spend: { ...MOCK_SPEND_BREAKDOWN, byMeetingType: [], byRole: [] } });
    await gotoOrgMeetingsPage(page);

    await expect(page.getByTestId('org-spend-bar-by-foundation')).toBeVisible();
    await expect(page.getByTestId('org-spend-bar-by-meeting-type')).toHaveCount(0);
    await expect(page.getByTestId('org-spend-bar-by-role')).toHaveCount(0);
  });

  test('renders the no-company empty state when no account is selected', async ({ page }) => {
    // hasAccess: true seeds a direct writer grant (so hasNoOrgAccess() stays false, reaching the
    // no-company branch instead of the no-access one), but nav-items/personas are overridden below
    // to return zero orgs so org-navigation never auto-selects one via handlePendingSelection().
    await stubOrgLensContext(page, { hasAccess: true });
    await page.route('**/api/user/personas*', (route) =>
      fulfillJson(route, { personas: ['contributor'], personaProjects: {}, projects: [], organizations: [], isRootWriter: false })
    );
    await page.route('**/api/nav/org-items*', (route) => fulfillJson(route, { items: [], next_page_token: null, upstream_failed: false, total: 0 }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto(ORG_MEETINGS_URL, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    if (!page.url().includes('/org/meetings')) {
      test.skip(true, 'org-lens-enabled flag appears off — /org/meetings redirected away');
    }

    await expect(page.getByTestId('org-meetings-no-company-empty-state')).toBeVisible();
    await expect(page.getByTestId('org-meetings-kpi-cards')).toHaveCount(0);
  });

  test('renders the no-access state when the caller has no org selector access', async ({ page }) => {
    await stubOrgLensContext(page, { hasAccess: false });
    await gotoOrgMeetingsPage(page);

    await expect(page.getByTestId('org-meetings-no-access-state')).toBeVisible();
    await expect(page.getByTestId('org-meetings-kpi-cards')).toHaveCount(0);
    await expect(page.getByTestId('org-meetings-no-company-empty-state')).toHaveCount(0);
  });
});
