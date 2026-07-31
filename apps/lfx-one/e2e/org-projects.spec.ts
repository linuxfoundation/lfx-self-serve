// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, test } from '@playwright/test';

const ORG_PROJECTS_URL = '/org/projects';
const DATA_LOAD_TIMEOUT = 30_000;
const TEST_ACCOUNT_ID = '0014100000Te2QjAAJ';
const TEST_ORG_UID = TEST_ACCOUNT_ID;
const DEFAULT_WORKSPACE = { id: 'all-activities', name: 'All Projects with Activities', projectSlugs: ['kubernetes'] };
const CUSTOM_EMPTY_WORKSPACE = { id: 'focus', name: 'Focus Workspace', projectSlugs: [] };

test.setTimeout(120_000);

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

function project(slug: string, name: string) {
  return {
    slug,
    name,
    logoUrl: '',
    foundation: { slug: 'cncf', name: 'CNCF', logoUrl: '' },
    health: 'excellent',
    technicalInfluence: 'leading',
    ecosystemInfluence: 'leading',
    influenceScore: 90,
    priorYearScore: 80,
    trend: { deltaPct: 12, technicalDeltaPct: 8, ecosystemDeltaPct: 4, direction: 'up', series: [70, 75, 80, 90] },
    maintainers: [],
    contributors: [{ id: 'person-1', name: 'Ada Lovelace', avatarUrl: '' }],
    participants: [{ id: 'person-1', name: 'Ada Lovelace', avatarUrl: '' }],
    commits1y: 42,
    changeDriver: { label: 'Not calculated yet', direction: 'flat' },
    description: `${name} project description.`,
    healthMetrics: [
      { label: 'Contributors', value: 90 },
      { label: 'Popularity', value: 80 },
      { label: 'Development', value: 85 },
      { label: 'Security', value: 75 },
    ],
  };
}

// Fallback row with NO org-scoped metrics AND no project-global health — everything reads "Unavailable".
function unavailableProject(slug: string, name: string) {
  return {
    ...project(slug, name),
    health: 'unavailable',
    trend: { deltaPct: 0, technicalDeltaPct: 0, ecosystemDeltaPct: 0, direction: 'flat', series: [0, 0, 0, 0] },
    contributors: [],
    participants: [],
    healthMetrics: [],
    metricsState: 'unavailable',
  };
}

// Fallback row with NO org-scoped influence/trend but WITH real project-global health — health shows a real band,
// influence and trend read "Unavailable" (US2 sub-case A).
function healthOnlyProject(slug: string, name: string) {
  return {
    ...project(slug, name),
    health: 'excellent',
    trend: { deltaPct: 0, technicalDeltaPct: 0, ecosystemDeltaPct: 0, direction: 'flat', series: [0, 0, 0, 0] },
    contributors: [],
    participants: [],
    healthMetrics: [
      { label: 'Contributors', value: 90 },
      { label: 'Popularity', value: 80 },
      { label: 'Development', value: 85 },
      { label: 'Security', value: 75 },
    ],
    metricsState: 'health-only',
  };
}

// Ecosystem-only participation: a project the org participates in through non-code channels (no trailing-24-month
// code activity) but which the org dashboard still lists with real bands/health/trend. metricsState stays `full`
// (org-dashboard parity), so the row renders as a real, linkable project — NOT an Unavailable fallback (US3).
function ecosystemOnlyProject(slug: string, name: string) {
  return {
    ...project(slug, name),
    technicalInfluence: 'silent',
    ecosystemInfluence: 'contributing',
    trend: { deltaPct: -5, technicalDeltaPct: 0, ecosystemDeltaPct: -5, direction: 'down', series: [50, 48, 46, 44] },
    contributors: [],
    participants: [{ id: 'person-2', name: 'Grace Hopper', avatarUrl: '' }],
    metricsState: 'full',
  };
}

function projectsResponse(projects = [project('kubernetes', 'Kubernetes')]) {
  return {
    orgSlug: 'red-hat-llc',
    orgName: 'Red Hat LLC',
    dataUpdatedAt: new Date().toISOString(),
    projects,
  };
}

async function fulfillJson(route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function stubOrgContext(
  page: Page,
  options: { hasAccess?: boolean; workspaces?: unknown[]; projectsStatus?: number; workspacesStatus?: number } = {}
): Promise<void> {
  const hasAccess = options.hasAccess ?? true;
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: hasAccess
          ? [
              {
                accountId: TEST_ACCOUNT_ID,
                accountName: 'Red Hat LLC',
                accountSlug: 'red-hat-llc',
                membershipTier: '',
                uid: TEST_ORG_UID,
              },
            ]
          : [],
        isRootWriter: false,
      }),
    })
  );
  await page.route('**/api/orgs/me/role-grants', (route) =>
    fulfillJson(route, {
      writers: hasAccess ? [TEST_ORG_UID] : [],
      auditors: [],
      cascadingWriters: [],
      cascadingAuditors: [],
      username: 'e2e-org-projects',
      loaded_at: new Date().toISOString(),
    })
  );
  await page.route('**/api/nav/org-items*', (route) =>
    fulfillJson(route, {
      items: hasAccess
        ? [{ uid: TEST_ORG_UID, accountId: TEST_ACCOUNT_ID, name: 'Red Hat LLC', logoUrl: null, primaryDomain: 'redhat.com', isMember: true }]
        : [],
      next_page_token: null,
      upstream_failed: false,
      total: hasAccess ? 1 : 0,
    })
  );
  await page.route(/\/api\/orgs\/[^/]+\/lens\/workspaces$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (options.workspacesStatus) return fulfillJson(route, { message: 'workspace error' }, options.workspacesStatus);
    return fulfillJson(route, { workspaces: options.workspaces ?? [DEFAULT_WORKSPACE] });
  });
  await page.route(/\/api\/orgs\/[^/]+\/lens\/projects(?:\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (options.projectsStatus) return fulfillJson(route, { message: 'projects error' }, options.projectsStatus);
    return fulfillJson(route, projectsResponse());
  });
  await page.route(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillJson(route, { results: [{ slug: 'kubernetes', name: 'Kubernetes', logoUrl: '', foundation: { slug: 'cncf', name: 'CNCF', logoUrl: '' } }] });
  });
}

async function gotoOrgProjectsPage(
  page: Page,
  options: { hasAccess?: boolean; workspaces?: unknown[]; projectsStatus?: number; workspacesStatus?: number; url?: string } = {}
): Promise<void> {
  await stubOrgContext(page, options);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(options.url ?? ORG_PROJECTS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/projects')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/projects redirected away');
  }
}

test.describe('Org Projects', () => {
  test('renders the projects table with stubbed org data', async ({ page }) => {
    await gotoOrgProjectsPage(page);

    await expect(page.getByTestId('org-projects-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-projects-table')).toBeVisible();
    const kubernetesRow = page.getByTestId('org-projects-row-kubernetes');
    await expect(kubernetesRow).toBeVisible();
    await expect(kubernetesRow.getByText('Leading').first()).toBeVisible();
    await expect(page.getByTestId('org-projects-export-csv')).toBeVisible();
  });

  test('sorts by project name from the column header (persists to the URL)', async ({ page }) => {
    await gotoOrgProjectsPage(page);
    await expect(page.getByTestId('org-projects-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-projects-sort-name').click();
    await expect(page).toHaveURL(/[?&]sort=name/);
  });

  test('Contributors count links to the project detail page with the Contributors drawer param', async ({ page }) => {
    await gotoOrgProjectsPage(page);
    await expect(page.getByTestId('org-projects-row-kubernetes')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const contributors = page.getByTestId('org-projects-contributors-kubernetes');
    await expect(contributors).toHaveAttribute('aria-label', /View 1 contributor for Kubernetes/);
    await contributors.click();

    await expect(page).toHaveURL(/\/org\/projects\/kubernetes\?(?:.*&)?card=contributors/);
  });

  test('Participants count links to the project detail page without a drawer param', async ({ page }) => {
    await gotoOrgProjectsPage(page);
    await expect(page.getByTestId('org-projects-row-kubernetes')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-projects-participants-kubernetes').click();

    await expect(page).toHaveURL(/\/org\/projects\/kubernetes(?:\?|$)/);
    expect(page.url()).not.toContain('card=');
  });

  test('opens the workspace dropdown and the add-workspace dialog', async ({ page }) => {
    await gotoOrgProjectsPage(page);
    await expect(page.getByTestId('org-projects-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-projects-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-projects-workspace-trigger').click();
    await expect(page.getByTestId('org-projects-add-workspace')).toBeVisible();

    await page.getByTestId('org-projects-add-workspace').click();
    await expect(page.getByRole('dialog', { name: 'Add workspace' })).toBeVisible();
    await expect(page.getByTestId('org-projects-workspace-save')).toBeVisible();
  });

  test('renders the health detail accessibility summary', async ({ page }) => {
    await gotoOrgProjectsPage(page);
    await expect(page.getByTestId('org-projects-row-kubernetes')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('org-projects-health-kubernetes')).toHaveAttribute('aria-label', /Health: Excellent/);
    await expect(page.getByTestId('org-projects-trend-delta-kubernetes')).toContainText('+12%');
  });

  test('renders no-access, load-error, and empty-workspace states', async ({ page }) => {
    await gotoOrgProjectsPage(page, { hasAccess: false });
    await expect(page.getByTestId('org-projects-no-access-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-projects-no-access-title')).toHaveText('Organization Lens is not available');

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await gotoOrgProjectsPage(page, { workspacesStatus: 500 });
    await expect(page.getByTestId('org-projects-table-error')).toContainText('Could not load your saved workspaces', { timeout: DATA_LOAD_TIMEOUT });

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await gotoOrgProjectsPage(page, { projectsStatus: 500 });
    await expect(page.getByTestId('org-projects-table-error')).toContainText('Something went wrong loading your projects', { timeout: DATA_LOAD_TIMEOUT });

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await gotoOrgProjectsPage(page, { workspaces: [DEFAULT_WORKSPACE, CUSTOM_EMPTY_WORKSPACE], url: `${ORG_PROJECTS_URL}?workspace=focus` });
    await expect(page.getByTestId('org-projects-empty-state')).toContainText('No projects in this workspace yet', { timeout: DATA_LOAD_TIMEOUT });
  });

  test('validates workspace creation errors inline', async ({ page }) => {
    await gotoOrgProjectsPage(page);
    await expect(page.getByTestId('org-projects-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-projects-workspace-trigger').click();
    await page.getByTestId('org-projects-add-workspace').click();
    await expect(page.getByRole('dialog', { name: 'Add workspace' })).toBeVisible();
    await page.getByTestId('org-projects-workspace-save').click();
    await expect(page.getByTestId('org-projects-workspace-name-error')).toHaveText('Workspace name is required.');

    await page.route(/\/api\/orgs\/[^/]+\/lens\/workspaces$/, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return fulfillJson(route, { message: 'create failed' }, 500);
    });
    await page.locator('input#workspace-name').fill('Focus Workspace');
    await page.getByTestId('org-projects-workspace-save').click();
    await expect(page.getByTestId('org-projects-workspace-dialog-error')).toContainText('Could not create this workspace', { timeout: DATA_LOAD_TIMEOUT });
  });

  test('keeps add-project search results ordered by the latest request', async ({ page }) => {
    // Use a workspace that does NOT already contain these results, so both are addable
    // (mapAddableOptions filters out projects already in the selected workspace).
    await gotoOrgProjectsPage(page, {
      workspaces: [DEFAULT_WORKSPACE, { id: 'custom', name: 'Custom Workspace', projectSlugs: ['existing'] }],
      url: `${ORG_PROJECTS_URL}?workspace=custom`,
    });
    await page.unroute(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const url = new URL(route.request().url());
      const query = url.searchParams.get('q') ?? '';
      // On-open empty-query preload resolves instantly so the panel opens without waiting.
      if (!query) return fulfillJson(route, { results: [] });
      // The earlier, shorter query 'ku' is deliberately SLOW; the later 'kube' is fast, so the stale 'ku'
      // response lands AFTER the latest one. Both results contain "kube" so PrimeNG's client-side filter
      // keeps either visible — only the request-id guard, not client filtering, can drop the stale one.
      if (query === 'ku') {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return fulfillJson(route, {
          results: [{ slug: 'kube-stale', name: 'Kube Stale', logoUrl: '', foundation: { slug: 'old', name: 'Old', logoUrl: '' } }],
        });
      }
      return fulfillJson(route, {
        results: [{ slug: 'kubernetes', name: 'Kubernetes', logoUrl: '', foundation: { slug: 'cncf', name: 'CNCF', logoUrl: '' } }],
      });
    });

    await expect(page.getByTestId('org-projects-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('org-projects-add-project').click();
    await expect(page.getByRole('dialog', { name: 'Add project(s)' })).toBeVisible();
    // Single search affordance: no standalone search input in the dialog — search lives inside the multi-select's own filter.
    await expect(page.getByRole('dialog', { name: 'Add project(s)' }).getByRole('searchbox')).toHaveCount(0);
    await page.getByTestId('org-projects-add-projects-select').click();
    const filter = page.getByRole('searchbox', { name: 'Search and select projects' });
    await expect(filter).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Fire the slow 'ku' request (waiting past the 300ms debounce so it actually dispatches and is in-flight),
    // then refine to the fast 'kube' request while 'ku' is still pending — a genuine concurrent race.
    await filter.fill('ku');
    await page.waitForTimeout(400);
    await filter.fill('kube');

    // The fast 'kube' result renders first. Scope to the option list — the background projects table also
    // has a "Kubernetes" row, so an unscoped getByText would be ambiguous.
    const optionList = page.getByLabel('Option List');
    await expect(optionList.getByText('Kubernetes')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // Wait past the slow 'ku' response so a stale-invalidation regression would surface: its 'Kube Stale' row
    // (which also matches the "kube" filter) must never replace the latest 'kube' results.
    await page.waitForTimeout(2500);
    await expect(optionList.getByText('Kube Stale')).toHaveCount(0);
    await expect(optionList.getByText('Kubernetes')).toBeVisible();
  });

  test('shows add-project search and save failures without hiding the dialog', async ({ page }) => {
    await gotoOrgProjectsPage(page, {
      workspaces: [DEFAULT_WORKSPACE, { id: 'custom', name: 'Custom Workspace', projectSlugs: ['existing'] }],
      url: `${ORG_PROJECTS_URL}?workspace=custom`,
    });
    await page.unroute(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillJson(route, { message: 'search failed' }, 500);
    });

    await expect(page.getByTestId('org-projects-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('org-projects-add-project').click();
    await expect(page.getByRole('dialog', { name: 'Add project(s)' })).toBeVisible();
    // The search error now renders inside the body-appended select panel (as its empty message);
    // recovery is by editing the search, not a Retry button.
    await page.getByTestId('org-projects-add-projects-select').click();
    await expect(page.getByText('Edit your search to try again')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.unroute(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillJson(route, {
        results: [{ slug: 'kubernetes', name: 'Kubernetes', logoUrl: '', foundation: { slug: 'cncf', name: 'CNCF', logoUrl: '' } }],
      });
    });
    await page.getByRole('searchbox', { name: 'Search and select projects' }).fill('ku');
    await page.getByLabel('Option List').getByText('Kubernetes').click();
    await page.keyboard.press('Escape');

    await page.route(/\/api\/orgs\/[^/]+\/lens\/workspaces\/[^/]+\/projects$/, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 250));
      return fulfillJson(route, { message: 'save failed' }, 500);
    });
    await page.getByTestId('org-projects-add-projects-confirm').click();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await expect(page.getByRole('dialog', { name: 'Add project(s)' })).toBeVisible();
    await expect(page.getByTestId('org-projects-add-projects-save-error')).toContainText('Could not add the selected projects', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByRole('dialog', { name: 'Add project(s)' })).toBeVisible();
  });

  test('renders fully-unavailable fallback rows as non-links with unavailable metrics', async ({ page }) => {
    await stubOrgContext(page);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/projects(?:\?.*)?$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillJson(route, projectsResponse([unavailableProject('kubernetes', 'Kubernetes')]));
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto(ORG_PROJECTS_URL, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    if (!page.url().includes('/org/projects')) {
      test.skip(true, 'org-lens-enabled flag appears off — /org/projects redirected away');
    }

    const row = page.getByTestId('org-projects-row-kubernetes');
    await expect(row).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // The "No activity yet" pill is shown and the project name is plain text (the detail page would 404).
    await expect(page.getByTestId('org-projects-no-activity-kubernetes')).toBeVisible();
    await expect(row.getByRole('link')).toHaveCount(0);
    // Health, influence, and trend all read "Unavailable" — no org-scoped metrics and no project-global health.
    await expect(page.getByTestId('org-projects-trend-kubernetes')).toHaveText('Unavailable');
    await expect(row.getByText('Unavailable').first()).toBeVisible();
    await expect(page.getByTestId('org-projects-health-kubernetes')).toHaveAttribute('aria-label', /Health: Unavailable/);
    // Contributor / participant counts are plain text (0), not links to the detail page.
    await expect(page.getByTestId('org-projects-contributors-kubernetes')).toHaveText('0');
    await expect(page.getByTestId('org-projects-participants-kubernetes')).toHaveText('0');
  });

  test('renders ecosystem-only participation rows with real bands (org-dashboard default-list parity)', async ({ page }) => {
    // US3: the default list includes projects the org participates in only through ecosystem channels (no code
    // activity). These are `full` rows — real bands/trend, a working detail link — not "Unavailable" fallbacks.
    await stubOrgContext(page);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/projects(?:\?.*)?$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillJson(route, projectsResponse([ecosystemOnlyProject('flowwave', 'Flowwave')]));
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto(ORG_PROJECTS_URL, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    if (!page.url().includes('/org/projects')) {
      test.skip(true, 'org-lens-enabled flag appears off — /org/projects redirected away');
    }

    const row = page.getByTestId('org-projects-row-flowwave');
    await expect(row).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // Real row: name links to the detail page and there is NO "No activity yet" pill.
    await expect(page.getByTestId('org-projects-no-activity-flowwave')).toHaveCount(0);
    await expect(row.getByRole('link').first()).toBeVisible();
    // Real bands and trend render — never "Unavailable".
    await expect(page.getByTestId('org-projects-health-flowwave')).toHaveAttribute('aria-label', /Health: Excellent/);
    await expect(page.getByTestId('org-projects-trend-flowwave')).not.toHaveText('Unavailable');
    await expect(row.getByText('Unavailable')).toHaveCount(0);
    await expect(row.getByText('Contributing').first()).toBeVisible();
  });

  test('renders health-only fallback rows with a real health band but unavailable influence/trend', async ({ page }) => {
    await stubOrgContext(page);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/projects(?:\?.*)?$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillJson(route, projectsResponse([healthOnlyProject('kubernetes', 'Kubernetes')]));
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto(ORG_PROJECTS_URL, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    if (!page.url().includes('/org/projects')) {
      test.skip(true, 'org-lens-enabled flag appears off — /org/projects redirected away');
    }

    const row = page.getByTestId('org-projects-row-kubernetes');
    await expect(row).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // No org-scoped row exists, so the name is plain text and the "No activity yet" pill shows.
    await expect(page.getByTestId('org-projects-no-activity-kubernetes')).toBeVisible();
    await expect(row.getByRole('link')).toHaveCount(0);
    // Project-global health renders a REAL band even though org-scoped influence/trend are unavailable.
    await expect(page.getByTestId('org-projects-health-kubernetes')).toHaveAttribute('aria-label', /Health: Excellent/);
    await expect(page.getByTestId('org-projects-trend-kubernetes')).toHaveText('Unavailable');
    await expect(row.getByText('Unavailable').first()).toBeVisible();
  });

  test('shows the already-in-workspace empty state when a search matches only existing projects', async ({ page }) => {
    await gotoOrgProjectsPage(page);
    await page.unroute(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillJson(route, { results: [], hasMatchesAlreadyInWorkspace: true });
    });

    await expect(page.getByTestId('org-projects-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('org-projects-add-project').click();
    await expect(page.getByRole('dialog', { name: 'Add project(s)' })).toBeVisible();
    await page.getByTestId('org-projects-add-projects-select').click();
    // Scope to the in-panel filter input by role — the host <lfx-multi-select> also carries the same placeholder.
    await page.getByRole('searchbox', { name: 'Search and select projects' }).fill('ku');

    // The already-in-workspace status now renders in the always-visible panel footer, so a still-selected option
    // matching the filter can't hide it (regression guard for the Bugbot "status hidden by selected options" bug).
    await expect(page.getByTestId('multi-select-panel-status')).toHaveText('Matching projects are already in this workspace.');
  });

  test('keeps the panel status visible when a selected option still matches the filter', async ({ page }) => {
    // Kubernetes must be addable (not already in the workspace) so it can be selected, so use a custom workspace.
    await gotoOrgProjectsPage(page, {
      workspaces: [DEFAULT_WORKSPACE, { id: 'custom', name: 'Custom Workspace', projectSlugs: ['existing'] }],
      url: `${ORG_PROJECTS_URL}?workspace=custom`,
    });
    await page.unroute(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return fulfillJson(route, {
        results: [{ slug: 'kubernetes', name: 'Kubernetes', logoUrl: '', foundation: { slug: 'cncf', name: 'CNCF', logoUrl: '' } }],
      });
    });

    await expect(page.getByTestId('org-projects-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('org-projects-add-project').click();
    await expect(page.getByRole('dialog', { name: 'Add project(s)' })).toBeVisible();
    await page.getByTestId('org-projects-add-projects-select').click();

    // Search, then select Kubernetes so it stays in the option list as a checked item.
    const filter = page.getByRole('searchbox', { name: 'Search and select projects' });
    await filter.fill('ku');
    await page.getByLabel('Option List').getByText('Kubernetes').click();

    // Drop below the min search length to a character the selected option still matches. The selected row keeps the
    // list non-empty, but the min-length guidance must still show in the always-visible footer — the exact Bugbot
    // "status hidden by selected options" regression this footer fixes.
    await filter.fill('k');
    await expect(page.getByTestId('multi-select-panel-status')).toHaveText('Type at least 2 characters to search projects.');
    await expect(page.getByLabel('Option List').getByText('Kubernetes')).toBeVisible();
  });

  test('shows only "Searching…" in-flight, never "No results found" (US4)', async ({ page }) => {
    await gotoOrgProjectsPage(page, {
      workspaces: [DEFAULT_WORKSPACE, { id: 'custom', name: 'Custom Workspace', projectSlugs: ['existing'] }],
      url: `${ORG_PROJECTS_URL}?workspace=custom`,
    });
    await page.unroute(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/projects\/search(?:\?.*)?$/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const query = new URL(route.request().url()).searchParams.get('q') ?? '';
      // On-open empty-query preload resolves instantly so the panel opens without waiting.
      if (!query) return fulfillJson(route, { results: [] });
      // The real query is deliberately SLOW so the assertions run while the request is genuinely in flight.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return fulfillJson(route, {
        results: [{ slug: 'kubernetes', name: 'Kubernetes', logoUrl: '', foundation: { slug: 'cncf', name: 'CNCF', logoUrl: '' } }],
      });
    });

    await expect(page.getByTestId('org-projects-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('org-projects-add-project').click();
    await expect(page.getByRole('dialog', { name: 'Add project(s)' })).toBeVisible();
    await page.getByTestId('org-projects-add-projects-select').click();

    const filter = page.getByRole('searchbox', { name: 'Search and select projects' });
    await expect(filter).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // Fire the slow search (past the 300ms debounce so it actually dispatches).
    await filter.fill('kube');
    await page.waitForTimeout(400);

    // MID-REQUEST: the panel footer shows "Searching…" and the contradictory built-in "No results found" NEVER appears.
    await expect(page.getByTestId('multi-select-panel-status')).toHaveText('Searching projects…');
    await expect(page.getByText('No results found')).toHaveCount(0);

    // AFTER completion: results render and the searching status clears.
    const optionList = page.getByLabel('Option List');
    await expect(optionList.getByText('Kubernetes')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByText('Searching projects…')).toHaveCount(0);
    await expect(page.getByText('No results found')).toHaveCount(0);
  });

  test('reloads the project table after adding projects to a workspace', async ({ page }) => {
    await stubOrgContext(page, { workspaces: [DEFAULT_WORKSPACE, { id: 'custom', name: 'Custom Workspace', projectSlugs: ['existing'] }] });
    await page.route(/\/api\/orgs\/[^/]+\/lens\/projects(?:\?.*)?$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const url = new URL(route.request().url());
      const slugs = url.searchParams.get('slugs') ?? '';
      return fulfillJson(
        route,
        projectsResponse(
          slugs.includes('kubernetes')
            ? [project('existing', 'Existing Project'), project('kubernetes', 'Kubernetes')]
            : [project('existing', 'Existing Project')]
        )
      );
    });
    await page.route(/\/api\/orgs\/[^/]+\/lens\/workspaces\/[^/]+\/projects$/, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return fulfillJson(route, { workspace: { id: 'custom', name: 'Custom Workspace', projectSlugs: ['existing', 'kubernetes'] } });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto(`${ORG_PROJECTS_URL}?workspace=custom`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    if (!page.url().includes('/org/projects')) {
      test.skip(true, 'org-lens-enabled flag appears off — /org/projects redirected away');
    }
    await expect(page.getByTestId('org-projects-row-existing')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-projects-row-kubernetes')).toHaveCount(0);

    await page.getByTestId('org-projects-add-project').click();
    await page.getByTestId('org-projects-add-projects-select').click();
    await page.getByLabel('Option List').getByText('Kubernetes').click();
    await page.keyboard.press('Escape');
    await page.getByTestId('org-projects-add-projects-confirm').click();

    await expect(page.getByRole('dialog', { name: 'Add project(s)' })).toHaveCount(0);
    await expect(page.getByTestId('org-projects-row-kubernetes')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});
