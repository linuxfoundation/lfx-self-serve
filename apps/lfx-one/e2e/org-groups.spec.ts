// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens · Groups Page E2E Tests (LFXV2-1879)
 *
 * Demo semantics (v1): OrgGroupsService returns static demo data (org-groups-demo.data.ts) —
 * no groups-data endpoint to stub. The page still gates on AccountContextService.selectedAccount(),
 * so org-context endpoints (personas/role-grants/nav-org-items) are stubbed the same way
 * org-projects.spec.ts does, to get `hasCompany()` to resolve true.
 */

import { expect, Page, test } from '@playwright/test';

const ORG_GROUPS_URL = '/org/groups';
const DATA_LOAD_TIMEOUT = 30_000;
const TEST_ACCOUNT_ID = '0014100000Te2QjAAJ';
const TEST_ORG_UID = TEST_ACCOUNT_ID;

test.setTimeout(90_000);

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

async function fulfillJson(route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function stubOrgContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, {
      personas: ['contributor'],
      personaProjects: {},
      projects: [],
      organizations: [{ accountId: TEST_ACCOUNT_ID, accountName: 'Red Hat LLC', accountSlug: 'red-hat-llc', membershipTier: '', uid: TEST_ORG_UID }],
      isRootWriter: false,
    })
  );
  await page.route('**/api/orgs/me/role-grants', (route) =>
    fulfillJson(route, {
      writers: [TEST_ORG_UID],
      auditors: [],
      cascadingWriters: [],
      cascadingAuditors: [],
      username: 'e2e-org-groups',
      loaded_at: new Date().toISOString(),
    })
  );
  await page.route('**/api/nav/org-items*', (route) =>
    fulfillJson(route, {
      items: [{ uid: TEST_ORG_UID, accountId: TEST_ACCOUNT_ID, name: 'Red Hat LLC', logoUrl: null, primaryDomain: 'redhat.com', isMember: true }],
      next_page_token: null,
      upstream_failed: false,
      total: 1,
    })
  );
}

async function gotoOrgGroupsPage(page: Page): Promise<void> {
  await stubOrgContext(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(ORG_GROUPS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/groups')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/groups redirected away');
  }
}

test.describe('Org Groups', () => {
  test('renders the groups table with stubbed org data', async ({ page }) => {
    await gotoOrgGroupsPage(page);

    await expect(page.getByTestId('org-groups-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-groups-table')).toBeVisible();
    await expect(page.getByTestId('org-groups-kpis')).toBeVisible();
  });

  test('filters the table via the search box', async ({ page }) => {
    await gotoOrgGroupsPage(page);
    await expect(page.getByTestId('org-groups-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const rowsBefore = page.locator('[data-testid^="org-groups-row-"]');
    const countBefore = await rowsBefore.count();
    expect(countBefore).toBeGreaterThan(0);

    await page.getByTestId('org-groups-search-input').fill('zzz-no-such-group-zzz');
    await expect(page.locator('[data-testid^="org-groups-row-"]')).toHaveCount(0, { timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-groups-search-input').fill('');
    await expect(rowsBefore.first()).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('renders the private-groups rollup card', async ({ page }) => {
    await gotoOrgGroupsPage(page);
    await expect(page.getByTestId('org-groups-private-rollup')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-groups-private-rollup-member-count')).toBeVisible();
  });

  test('switches between Board/Other tabs and updates the URL', async ({ page }) => {
    await gotoOrgGroupsPage(page);
    await expect(page.getByTestId('org-groups-panel-all')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-groups-tab-board').click();
    await expect(page).toHaveURL(/[?&]tab=board\b/);
    await expect(page.getByTestId('org-groups-panel-board')).toBeVisible();
    await expect(page.getByTestId('org-groups-tab-board')).toHaveAttribute('aria-selected', 'true');

    await page.getByTestId('org-groups-tab-other').click();
    await expect(page).toHaveURL(/[?&]tab=other\b/);
    await expect(page.getByTestId('org-groups-panel-other')).toBeVisible();
    await expect(page.getByTestId('org-groups-tab-other')).toHaveAttribute('aria-selected', 'true');

    await page.getByTestId('org-groups-tab-all').click();
    // 'all' is the default tab — its URL drops the `?tab=` param entirely.
    await expect(page).not.toHaveURL(/[?&]tab=/);
    await expect(page.getByTestId('org-groups-panel-all')).toBeVisible();
  });

  test('navigates to a group detail page from a table row', async ({ page }) => {
    await gotoOrgGroupsPage(page);
    await expect(page.getByTestId('org-groups-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const firstRow = page.locator('[data-testid^="org-groups-row-"]').first();
    const testId = await firstRow.getAttribute('data-testid');
    const groupId = testId?.replace('org-groups-row-', '');
    const groupName = (await firstRow.locator('.lfx-table-name-link').textContent())?.trim();
    await firstRow.click();

    await expect(page).toHaveURL(new RegExp(`/org/groups/${groupId}$`));
    // Assert on real detail content, not just the shell testid shared with the not-found state.
    await expect(page.getByTestId('org-group-detail-name')).toHaveText(groupName ?? '', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-group-detail-not-found')).not.toBeVisible();
  });
});
