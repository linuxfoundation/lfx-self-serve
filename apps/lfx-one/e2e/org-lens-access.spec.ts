// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Cursor](https://cursor.com)

/**
 * Org Lens Access tab E2E — spec 025-org-lens-access-tab.
 *
 * Coverage map (deterministic via route stubs, mirroring org-profile.spec.ts):
 * - S1: tab navigation + data-testid surface (panel, search, type-filter, summary cards, rows)
 * - S2: summary counts match the stubbed list (SC-002)
 * - S3: type filter + search narrow the rows (US4 / FR-007, FR-007a)
 * - S4: Edit role happy path — modal → change to → save → refreshed badge + success toast (US2)
 * - S5: Remove happy path — confirm → row disappears + success toast (US3)
 * - S7: Add Users invite happy path — modal → email → send → POST + invited row + success toast (US5)
 * - S7b: Add Users invite failure (5xx) — error toast, modal stays open (FR-013)
 * - S6: non-manager (canManage=false) hides the row actions (FR-011)
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 * - `org-lens-enabled` LaunchDarkly flag toggled ON for the test user
 */

import type { OrgAccessListResponse } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

const ACCESS_URL = '/org/people?tab=access';
const DATA_LOAD_TIMEOUT = 30_000;

const MOCK_UID = '4c46585f-878c-8285-b2e9-2dbfc38ddd9b';
const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';

const BASE_LIST: OrgAccessListResponse = {
  orgUid: MOCK_UID,
  users: [
    {
      email: 'ada.admin@example.com',
      name: 'Ada Admin',
      initials: 'AA',
      avatarUrl: null,
      jobTitle: 'Chief Technology Officer',
      role: 'admin',
      inviteStatus: 'accepted',
      isPending: false,
    },
    {
      email: 'bob.admin@example.com',
      name: 'Bob Admin',
      initials: 'BA',
      avatarUrl: null,
      jobTitle: 'VP Engineering',
      role: 'admin',
      inviteStatus: 'accepted',
      isPending: false,
    },
    {
      email: 'val.viewer@example.com',
      name: 'Val Viewer',
      initials: 'VV',
      avatarUrl: null,
      jobTitle: 'Open Source Analyst',
      role: 'viewer',
      inviteStatus: 'accepted',
      isPending: false,
    },
    {
      email: 'pat.pending@example.com',
      name: 'Pat Pending',
      initials: 'PP',
      avatarUrl: null,
      jobTitle: null,
      role: 'viewer',
      inviteStatus: 'pending',
      isPending: true,
    },
  ],
  summary: { totalUsers: 4, administrators: 2, viewers: 1 },
  canManage: true,
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

async function stubOrgContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [{ accountId: MOCK_ACCOUNT_ID, accountName: 'Red Hat LLC', accountSlug: 'red-hat-llc', membershipTier: '', uid: MOCK_UID }],
        isRootWriter: false,
      }),
    })
  );
}

async function stubAccessList(page: Page, list: OrgAccessListResponse): Promise<void> {
  await page.route('**/api/orgs/*/lens/access/users', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
  });
}

async function gotoAccessTab(page: Page, list: OrgAccessListResponse = BASE_LIST): Promise<void> {
  await stubOrgContext(page);
  await stubAccessList(page, list);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(ACCESS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/people')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/people redirected away');
  }

  await expect(page.getByTestId('org-people-tab-access')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  await expect(page.getByTestId('org-lens-access')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

test.describe('Org Lens Access — tab + view (S1/S2)', () => {
  test('S1: tab is last, panel + toolbar + summary + rows render (FR-001..FR-006)', async ({ page }) => {
    await gotoAccessTab(page);

    await expect(page.getByTestId('org-people-panel-access')).toBeVisible();
    await expect(page.getByTestId('org-lens-access')).toHaveAttribute('data-state', 'loaded');
    await expect(page.getByTestId('org-access-search')).toBeVisible();
    await expect(page.getByTestId('org-access-type-filter')).toBeVisible();
    await expect(page.getByTestId('org-access-stat-total')).toContainText('4');
    await expect(page.getByTestId('org-access-stat-admins')).toContainText('2');
    await expect(page.getByTestId('org-access-stat-viewers')).toContainText('1');

    await expect(page.getByTestId('org-access-row-ada.admin@example.com')).toBeVisible();
    await expect(page.getByTestId('org-access-row-val.viewer@example.com')).toBeVisible();
    await expect(page.getByTestId('org-access-row-pat.pending@example.com')).toContainText('Invited');
  });

  test('S3: type filter + search narrow the rows (US4 / FR-007a)', async ({ page }) => {
    await gotoAccessTab(page);

    // Invited filter shows only the pending row. Scope to the opened p-select option to avoid
    // matching the same label elsewhere on the page (e.g. the legend).
    await page.getByTestId('org-access-type-filter').click();
    await page.getByRole('option', { name: 'Invited', exact: true }).click();
    await expect(page.getByTestId('org-access-row-pat.pending@example.com')).toBeVisible();
    await expect(page.getByTestId('org-access-row-ada.admin@example.com')).toHaveCount(0);

    // Back to All types, then search by job title.
    await page.getByTestId('org-access-type-filter').click();
    await page.getByRole('option', { name: 'All types', exact: true }).click();
    await page.getByTestId('org-access-search').fill('analyst');
    await expect(page.getByTestId('org-access-row-val.viewer@example.com')).toBeVisible();
    await expect(page.getByTestId('org-access-row-ada.admin@example.com')).toHaveCount(0);
  });
});

test.describe('Org Lens Access — edit + remove (S4/S5)', () => {
  test('S4: edit role happy path → success toast + refreshed badge (US2)', async ({ page }) => {
    await gotoAccessTab(page);

    // Stub the PUT to return Val promoted to admin.
    const updated: OrgAccessListResponse = {
      ...BASE_LIST,
      users: BASE_LIST.users.map((u) => (u.email === 'val.viewer@example.com' ? { ...u, role: 'admin' } : u)),
      summary: { totalUsers: 4, administrators: 3, viewers: 0 },
    };
    await page.route('**/api/orgs/*/lens/access/users/val.viewer%40example.com', (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
    });

    await page.getByTestId('org-access-edit-val.viewer@example.com').click();
    await expect(page.getByTestId('org-access-edit-modal')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('org-access-edit-current')).toContainText('Viewer');

    await page.getByTestId('org-access-edit-change-to').click();
    await page.getByRole('option', { name: 'Admin', exact: true }).click();
    await page.getByTestId('org-access-edit-save').click();

    await expect(page.getByTestId('org-access-edit-modal')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Access updated')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('org-access-role-val.viewer@example.com')).toContainText('Admin');
  });

  test('S5: remove happy path → row disappears + success toast (US3)', async ({ page }) => {
    await gotoAccessTab(page);

    const afterRemove: OrgAccessListResponse = {
      ...BASE_LIST,
      users: BASE_LIST.users.filter((u) => u.email !== 'val.viewer@example.com'),
      summary: { totalUsers: 3, administrators: 2, viewers: 0 },
    };
    await page.route('**/api/orgs/*/lens/access/users/val.viewer%40example.com', (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(afterRemove) });
    });

    await page.getByTestId('org-access-remove-val.viewer@example.com').click();
    // PrimeNG confirm dialog accept button.
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByText('Access removed')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('org-access-row-val.viewer@example.com')).toHaveCount(0);
  });

  test('S5b: edit write failure (5xx) keeps the modal open + error toast, role unchanged (FR-013)', async ({ page }) => {
    await gotoAccessTab(page);

    await page.route('**/api/orgs/*/lens/access/users/val.viewer%40example.com', (route) => {
      if (route.request().method() !== 'PUT') return route.fallback();
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'ACCESS_WRITE_FAILED', message: "Couldn't save right now. Please try again.", conflict: false } }),
      });
    });

    await page.getByTestId('org-access-edit-val.viewer@example.com').click();
    await expect(page.getByTestId('org-access-edit-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('org-access-edit-change-to').click();
    await page.getByRole('option', { name: 'Admin', exact: true }).click();
    await page.getByTestId('org-access-edit-save').click();

    // Failure toast fires, the modal stays open for retry, and the row role is unchanged.
    await expect(page.getByText('Update failed')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('org-access-edit-modal')).toBeVisible();
    await expect(page.getByTestId('org-access-role-val.viewer@example.com')).toContainText('Viewer');
  });
});

test.describe('Org Lens Access — add users (S7)', () => {
  test('S7: add users invite happy path → POST + invited row + success toast (US5)', async ({ page }) => {
    await gotoAccessTab(page);

    const newEmail = 'new.invitee@example.com';
    const afterInvite: OrgAccessListResponse = {
      ...BASE_LIST,
      users: [
        ...BASE_LIST.users,
        { email: newEmail, name: 'New Invitee', initials: 'NI', avatarUrl: null, jobTitle: null, role: 'viewer', inviteStatus: 'pending', isPending: true },
      ],
      summary: { totalUsers: 5, administrators: 2, viewers: 1 },
    };
    let postBody: unknown = null;
    await page.route('**/api/orgs/*/lens/access/users', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      postBody = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(afterInvite) });
    });

    await page.getByTestId('org-access-add-users').click();
    await expect(page.getByTestId('org-access-add-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('org-access-add-email').fill(newEmail);
    await page.getByTestId('org-access-add-send').click();

    await expect(page.getByText('Invite sent')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('org-access-add-modal')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('org-access-row-new.invitee@example.com')).toContainText('Invited');
    expect(postBody).toMatchObject({ email: newEmail, role: 'viewer' });
  });

  test('S7b: add users invite failure (5xx) → error toast + modal stays open (FR-013)', async ({ page }) => {
    await gotoAccessTab(page);

    await page.route('**/api/orgs/*/lens/access/users', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      return route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'ACCESS_WRITE_FAILED', message: "Couldn't send the invite. Please try again.", conflict: false } }),
      });
    });

    await page.getByTestId('org-access-add-users').click();
    await expect(page.getByTestId('org-access-add-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('org-access-add-email').fill('new.invitee@example.com');
    await page.getByTestId('org-access-add-send').click();

    // Failure toast fires and the modal stays open for retry (no list mutation).
    await expect(page.getByText('Invite failed')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('org-access-add-modal')).toBeVisible();
  });
});

test.describe('Org Lens Access — non-manager gating (S6)', () => {
  test('S6: canManage=false hides row actions (FR-011)', async ({ page }) => {
    await gotoAccessTab(page, { ...BASE_LIST, canManage: false });

    await expect(page.getByTestId('org-lens-access')).toHaveAttribute('data-can-manage', 'false');
    await expect(page.getByTestId('org-access-row-ada.admin@example.com')).toBeVisible();
    await expect(page.getByTestId('org-access-edit-ada.admin@example.com')).toHaveCount(0);
    await expect(page.getByTestId('org-access-remove-ada.admin@example.com')).toHaveCount(0);
  });
});
