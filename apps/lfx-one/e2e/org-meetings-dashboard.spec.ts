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

// Stub only what the org lens needs to render (personas + account context). This page is demo-data
// only (LFXV2-2735) — no meetings-insights BFF endpoint exists yet, so there is nothing else to stub.
async function stubOrgLensContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, {
      personas: ['contributor'],
      personaProjects: {},
      projects: [],
      organizations: [{ accountId: MOCK_ACCOUNT_ID, accountName: 'Red Hat, Inc.', accountSlug: 'red-hat', membershipTier: '', uid: MOCK_ACCOUNT_ID }],
      isRootWriter: false,
    })
  );

  await page.route('**/api/analytics/org-lens-account-context*', (route) =>
    fulfillJson(route, [{ accountId: MOCK_ACCOUNT_ID, accountName: 'Red Hat, Inc.', accountSlug: 'red-hat', membershipTier: 'Gold' }])
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

  test('renders the "where your people spend time" stacked bars', async ({ page }) => {
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

  test('renders trend cards with sparklines', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgMeetingsPage(page);

    const trends = page.getByTestId('org-meetings-trends');
    await expect(trends).toBeVisible();
    await expect(page.getByTestId('org-meetings-trend-meetings-attended')).toBeVisible();
    await expect(page.getByTestId('org-meetings-trend-employees-active')).toBeVisible();
    await expect(page.getByTestId('org-meetings-trend-projects-supported')).toBeVisible();

    // Each card must actually render its sparkline chart, not just the card shell.
    await expect(page.getByTestId('org-meetings-trend-meetings-attended').locator('canvas')).toBeVisible();
    await expect(page.getByTestId('org-meetings-trend-employees-active').locator('canvas')).toBeVisible();
    await expect(page.getByTestId('org-meetings-trend-projects-supported').locator('canvas')).toBeVisible();
  });

  test('renders the influence table with all rows collapsed by default', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgMeetingsPage(page);

    const influence = page.getByTestId('org-meetings-influence');
    await expect(influence).toBeVisible();

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

  test('switching time range keeps the page rendering without error', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgMeetingsPage(page);

    await page.getByTestId('org-meetings-time-range').click();
    await page.getByTestId('org-meetings-time-range-option-previousYear').click();
    await expect(page.getByTestId('org-meetings-time-range-label')).toHaveText('Previous year');
    await expect(page.getByTestId('org-meetings-kpi-cards')).toBeVisible();

    await page.getByTestId('org-meetings-time-range').click();
    await page.getByTestId('org-meetings-time-range-option-allTime').click();
    await expect(page.getByTestId('org-meetings-time-range-label')).toHaveText('All time');
    await expect(page.getByTestId('org-meetings-kpi-cards')).toBeVisible();
  });

  test('renders the no-company empty state when no account is selected', async ({ page }) => {
    await page.route('**/api/user/personas*', (route) =>
      fulfillJson(route, { personas: ['contributor'], personaProjects: {}, projects: [], organizations: [], isRootWriter: false })
    );
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
});
