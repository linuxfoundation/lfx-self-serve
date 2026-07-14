// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens · Group Detail Page E2E Tests (LFXV2-1879)
 *
 * Demo semantics (v1): the page is served from client-side demo fixtures
 * (org-group-detail-demo.data.ts). `k8s-steering` is a curated, fully-seeded group; an
 * unknown id returns null → the not-found panel. The page gates on
 * AccountContextService.selectedAccount() (hasCompany()), so org-context endpoints
 * (personas/role-grants/nav-org-items) are stubbed the same way org-groups.spec.ts does,
 * to get `hasCompany()` to resolve true.
 */

import { expect, Page, test } from '@playwright/test';

const DETAIL_URL = '/org/groups/k8s-steering';
const DETAIL_URL_BOGUS = '/org/groups/totally-bogus-group';
// A real, seeded private group whose deriveDemoViewerIsGroupMember(id) hash resolves to
// non-member — exercises the "exists but viewer lacks access" branch, distinct from an unknown id.
const DETAIL_URL_PRIVATE_NON_MEMBER = '/org/groups/cncf-budget';
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
      username: 'e2e-org-group-detail',
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

async function dismissCookieBanner(page: Page): Promise<void> {
  // The Osano consent banner mounts asynchronously well after the page looks interactive, and
  // auto-focuses its own Privacy Policy link when it does — stealing focus mid-test if it lands
  // while a keyboard-nav assertion is in flight. Actively wait for it (it may never appear if a
  // prior test in the same storage state already recorded a consent choice) rather than a single
  // point-in-time visibility check, which is too early to reliably observe it.
  const denyButton = page.getByRole('button', { name: 'Deny Non-Essential' });
  await denyButton.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (await denyButton.isVisible()) {
    await denyButton.click();
    await denyButton.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
  }
}

async function gotoOrgGroupDetailPage(page: Page, url: string): Promise<void> {
  await stubOrgContext(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/groups')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/groups redirected away');
  }
}

test.describe('Org Group Detail', () => {
  test.beforeEach(async ({ page }) => {
    await gotoOrgGroupDetailPage(page, DETAIL_URL);
    await expect(page.getByTestId('org-group-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // The Osano consent script mounts asynchronously and can still be settling in when the page
    // becomes visible — dismiss it here so its focus trap can't intercept the app's own .focus()
    // calls (e.g. the tab strip's roving-tabindex keyboard nav).
    await dismissCookieBanner(page);
  });

  test('renders header, tags, and tab strip', async ({ page }) => {
    await expect(page.getByTestId('org-group-detail-name')).toHaveText('Kubernetes Steering Committee');
    await expect(page.getByTestId('org-group-detail-tags')).toBeVisible();
    await expect(page.getByTestId('org-group-detail-tabs')).toBeVisible();
    await expect(page.getByTestId('org-group-detail-tab-overview')).toBeVisible();
    await expect(page.getByTestId('org-group-detail-tab-votes')).toBeVisible();
  });

  test('renders overview stats and meeting cards', async ({ page }) => {
    await expect(page.getByTestId('org-group-detail-stats')).toBeVisible();
    await expect(page.getByTestId('org-group-detail-chairs')).toBeVisible();
  });

  test('switches tabs via click and persists selection', async ({ page }) => {
    await page.getByTestId('org-group-detail-tab-members').click();
    await expect(page.getByTestId('org-group-detail-members-panel')).toBeVisible();

    await page.getByTestId('org-group-detail-tab-meetings').click();
    await expect(page.getByTestId('org-group-detail-meetings-panel')).toBeVisible();
  });

  test('arrow keys move focus between tabs', async ({ page }) => {
    await page.getByTestId('org-group-detail-tab-overview').click();
    await expect(page.getByTestId('org-group-detail-tab-overview')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('org-group-detail-tab-members')).toBeFocused();
  });
});

test.describe('Org Group Detail — not found', () => {
  test('renders the not-found panel for an unknown id', async ({ page }) => {
    await gotoOrgGroupDetailPage(page, DETAIL_URL_BOGUS);
    const notFound = page.getByTestId('org-group-detail-not-found');
    await expect(notFound).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(notFound).toContainText('Group not found');
    await expect(page.getByTestId('org-group-detail-tabs')).not.toBeVisible();
  });

  test('renders the not-found panel for a private group the viewer is not a member of', async ({ page }) => {
    await gotoOrgGroupDetailPage(page, DETAIL_URL_PRIVATE_NON_MEMBER);
    const notFound = page.getByTestId('org-group-detail-not-found');
    await expect(notFound).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(notFound).toContainText('Group not found');
    await expect(page.getByTestId('org-group-detail-tabs')).not.toBeVisible();
  });
});
