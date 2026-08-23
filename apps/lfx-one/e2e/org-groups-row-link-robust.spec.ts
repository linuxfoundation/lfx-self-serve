// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Groups — row data-testid contract — Structural Tests (GH-1784).
 *
 * Companion to `org-groups-row-link.spec.ts`, which owns click-routing behavior for this same
 * row. This file asserts the data-testid contract in isolation: every row gets its own
 * uid-scoped testid, not one shared across rows. `toHaveCount` alone can't prove that — a CSS
 * attribute-prefix selector matches once per matching element regardless of whether two elements
 * carry the identical attribute value, so a regression to a non-unique scope (e.g.
 * `group.category`, identical on both fixture rows below) would still report a count of 2. These
 * tests instead collect the actual attribute values and assert they're distinct.
 */

import { expect, Page, test } from '@playwright/test';

const GROUPS_URL = '/org/groups';
const DATA_LOAD_TIMEOUT = 30_000;

const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_ACCOUNT_NAME = 'Acme Motors';
const MOCK_ACCOUNT_SLUG = 'acme-motors';

const GROUP_UID = 'c-transport';
const SECOND_GROUP_UID = 'c-storage';

function groupsResponse() {
  return {
    groups: [
      {
        uid: GROUP_UID,
        name: 'Transport Working Group',
        category: 'Working Group',
        project_uid: 'uepf-root',
        project_slug: 'uepf',
        project_name: 'Ultra Ethernet Consortium Fund',
        org_seat_count: 5,
      },
      {
        uid: SECOND_GROUP_UID,
        name: 'Storage Working Group',
        // Deliberately identical category to the first row — a testid regressed to
        // `'org-groups-item-name-' + group.category` would collide on this value, which is
        // exactly the case the distinctness assertions below need to catch.
        category: 'Working Group',
        project_uid: 'cncf-root',
        project_slug: 'cncf',
        project_name: 'Cloud Native Computing Foundation',
        org_seat_count: 3,
      },
    ],
    total_groups: 2,
    total_seats: 8,
  };
}

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

async function stubAccountContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [
          { accountId: MOCK_ACCOUNT_ID, accountName: MOCK_ACCOUNT_NAME, accountSlug: MOCK_ACCOUNT_SLUG, membershipTier: '', uid: MOCK_ACCOUNT_ID },
        ],
        isRootWriter: false,
      }),
    })
  );
  await page.route('**/api/orgs/me/role-grants', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        writers: [MOCK_ACCOUNT_ID],
        auditors: [],
        cascadingWriters: [],
        cascadingAuditors: [],
        username: 'e2e-org-groups-row-link-robust',
        loaded_at: new Date().toISOString(),
      }),
    })
  );
}

async function stubGroups(page: Page): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/groups$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(groupsResponse()) });
  });
}

async function gotoGroups(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(GROUPS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  if (!page.url().includes('/org/groups')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/groups redirected away');
  }
  await expect(page.getByTestId(`org-groups-item-${GROUP_UID}`)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

async function distinctTestIds(page: Page, prefix: string): Promise<string[]> {
  const values = await page.locator(`[data-testid^="${prefix}"]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  return values.filter((v): v is string => v !== null);
}

test.setTimeout(120_000);

test.describe('Org Groups — row data-testid contract (GH-1784)', () => {
  test.beforeEach(async ({ page }) => {
    await stubAccountContext(page);
    await stubGroups(page);
    await gotoGroups(page);
  });

  test('name, project, and seats testids are uid-scoped and distinct across rows', async ({ page }) => {
    for (const prefix of ['org-groups-item-name-', 'org-groups-item-project-', 'org-groups-item-seats-']) {
      const ids = await distinctTestIds(page, prefix);
      expect(ids, `expected 2 rows to render distinct "${prefix}*" testids`).toHaveLength(2);
      expect(new Set(ids).size, `expected "${prefix}*" testids to be unique per row, not shared`).toBe(2);
    }
  });

  test('the row link testid is uid-scoped and distinct across rows', async ({ page }) => {
    const ids = await distinctTestIds(page, 'org-groups-row-link-');
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
