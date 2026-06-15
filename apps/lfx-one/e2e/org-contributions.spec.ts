// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens Code Contributions page E2E (LFXV2-1894).
 *
 * Smoke coverage (deterministic via route stubs, mirroring org-lens-access.spec.ts):
 * - S1: page renders — header, KPI strip, filter bar, Repositories table + rows
 * - S2: tab switch to Commits renders the commits feed
 * - S3: clicking a committer opens the detail side panel
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 * - `org-lens-enabled` LaunchDarkly flag toggled ON for the test user
 */

import type { OrgContributionsResponse } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

const CONTRIBUTIONS_URL = '/org/contributions';
const DATA_LOAD_TIMEOUT = 30_000;

const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';

const BASE_RESPONSE: OrgContributionsResponse = {
  accountId: MOCK_ACCOUNT_ID,
  dateRange: '12mo',
  kpis: { projectsWithActivity: 2, repositories: 2, commits: 1780 },
  repositories: [
    {
      repositoryId: 'repo-k8s',
      repositoryPath: 'kubernetes/kubernetes',
      projectId: 'proj-k8s',
      projectName: 'Kubernetes',
      projectSlug: 'kubernetes',
      projectLogoUrl: null,
      source: 'github',
      upstreamUrl: 'https://github.com/kubernetes/kubernetes',
      commits: 1240,
      firstCommitTs: '2016-03-01T00:00:00.000Z',
      lastCommitTs: '2026-05-11T00:00:00.000Z',
    },
    {
      repositoryId: 'repo-prom',
      repositoryPath: 'prometheus/prometheus',
      projectId: 'proj-prom',
      projectName: 'Prometheus',
      projectSlug: 'prometheus',
      projectLogoUrl: null,
      source: 'github',
      upstreamUrl: 'https://github.com/prometheus/prometheus',
      commits: 540,
      firstCommitTs: '2015-11-02T00:00:00.000Z',
      lastCommitTs: '2026-05-27T00:00:00.000Z',
    },
  ],
  commits: [
    {
      commitSha: 'demo-aramirez-20260513',
      contributorId: 'emp-ana',
      projectName: 'Kubernetes',
      committerName: 'Ana Ramirez',
      committerAvatarUrl: null,
      committerTitle: 'Staff Engineer',
      username: 'aramirez',
      source: 'github',
      committedTs: '2026-05-13T12:00:00.000Z',
      message: 'fix: handle nil pointer in reconcile loop',
      commitUrl: null,
    },
  ],
  projectOptions: [
    { slug: 'kubernetes', projectId: 'proj-k8s', name: 'Kubernetes', commits: 1240, parentSlug: null },
    { slug: 'prometheus', projectId: 'proj-prom', name: 'Prometheus', commits: 540, parentSlug: null },
  ],
  employeeOptions: [{ id: 'emp-ana', displayName: 'Ana Ramirez', commits: 1240 }],
  totalRecords: 2,
  commitsTotalRecords: 1,
};

test.setTimeout(120_000);

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — let the test run and surface a useful failure.
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

async function stubOrgContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [
          {
            accountId: MOCK_ACCOUNT_ID,
            accountName: 'Red Hat LLC',
            accountSlug: 'red-hat-llc',
            membershipTier: '',
            uid: MOCK_ACCOUNT_ID,
          },
        ],
        isRootWriter: false,
      }),
    })
  );

  await page.route('**/api/analytics/org-lens-account-context*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          accountId: MOCK_ACCOUNT_ID,
          accountName: 'Red Hat LLC',
          accountSlug: 'red-hat-llc',
          logoUrl: null,
          cdevOrgId: null,
          cdevOrgName: null,
          cdevOrgLogo: null,
          isMember: true,
          memberAccountType: 'Corporate',
          membershipId: null,
          membershipProjectId: null,
          membershipProjectName: null,
          membershipTierDisplayName: null,
          membershipTierClass: null,
        },
      ]),
    })
  );
}

async function stubContributions(page: Page, response: OrgContributionsResponse = BASE_RESPONSE): Promise<void> {
  await page.route('**/api/orgs/*/lens/contributions**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
}

async function waitForContributionsLoaded(page: Page): Promise<void> {
  await expect(page.getByTestId('org-contributions-no-company-empty-state')).toHaveCount(0, { timeout: DATA_LOAD_TIMEOUT });
  await expect(page.getByTestId('org-contributions-content-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  await expect(page.getByTestId('org-contributions-repositories-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

async function switchToCommitsTab(page: Page): Promise<void> {
  const commitsTab = page.getByTestId('filter-pill-commits');
  await expect(commitsTab).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  await commitsTab.click();
  await expect(page.getByTestId('org-contributions-commits-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

async function gotoContributions(page: Page, response: OrgContributionsResponse = BASE_RESPONSE): Promise<void> {
  await seedSelectedOrgCookie(page);
  await stubOrgContext(page);
  await stubContributions(page, response);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(CONTRIBUTIONS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/contributions')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/contributions redirected away');
  }

  await expect(page.getByTestId('org-contributions-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

test.describe('Org Lens Code Contributions — render (S1)', () => {
  test('S1: header, KPI strip, filter bar, and repositories table render', async ({ page }) => {
    await gotoContributions(page);

    await expect(page.getByTestId('org-contributions-title')).toContainText('Code Contributions');
    await expect(page.getByTestId('org-contributions-kpis')).toBeVisible();
    await expect(page.getByTestId('org-contributions-filter-bar')).toBeVisible();
    await expect(page.getByTestId('org-contributions-repositories-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-contributions-row-repo-k8s')).toBeVisible();
    await expect(page.getByTestId('org-contributions-row-repo-prom')).toBeVisible();
  });
});

test.describe('Org Lens Code Contributions — commits tab (S2)', () => {
  test('S2: switching to the Commits tab renders the commits feed', async ({ page }) => {
    await gotoContributions(page);
    await waitForContributionsLoaded(page);

    await switchToCommitsTab(page);
    await expect(page.getByTestId('org-contributions-commit-demo-aramirez-20260513')).toBeVisible();
  });
});

test.describe('Org Lens Code Contributions — committer panel (S3)', () => {
  test('S3: clicking a committer opens the detail side panel', async ({ page }) => {
    await gotoContributions(page);
    await waitForContributionsLoaded(page);

    await switchToCommitsTab(page);
    await expect(page.getByTestId('org-contributions-commit-demo-aramirez-20260513')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('org-contributions-committer-demo-aramirez-20260513').click();
    await expect(page.getByTestId('org-contributions-committer-panel-header')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-contributions-committer-panel-header')).toContainText('Ana Ramirez');
  });
});
