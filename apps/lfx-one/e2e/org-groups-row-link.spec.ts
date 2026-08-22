// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Groups — row vs. foundation-link click targets (GH-1784). Covers what jsdom unit specs
 * can't: the `peer absolute inset-0` stretched anchor plus `pointer-events-none` row content
 * actually route clicks to the right destination depending on where in the row they land.
 */

import { expect, Page, test } from '@playwright/test';

const GROUPS_URL = '/org/groups';
const DATA_LOAD_TIMEOUT = 30_000;

const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_ACCOUNT_NAME = 'Acme Motors';
const MOCK_ACCOUNT_SLUG = 'acme-motors';

const GROUP_UID = 'c-transport';
const PROJECT_SLUG = 'uepf';

function groupsResponse() {
  return {
    groups: [
      {
        uid: GROUP_UID,
        name: 'Transport Working Group',
        category: 'Working Group',
        project_uid: 'uepf-root',
        project_slug: PROJECT_SLUG,
        project_name: 'Ultra Ethernet Consortium Fund',
        org_seat_count: 5,
      },
    ],
    total_groups: 1,
    total_seats: 5,
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
        username: 'e2e-org-groups-row-link',
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

test.setTimeout(120_000);

test.describe('Org Groups — row vs. foundation link (GH-1784)', () => {
  test('clicking the row body opens the group detail page', async ({ page }) => {
    await stubAccountContext(page);
    await stubGroups(page);
    await gotoGroups(page);

    // Click the group name text, not the anchor overlay directly — this is the part jsdom
    // can't verify: that the stretched link actually receives the click through the
    // pointer-events-none content wrapper.
    await page.getByTestId('org-groups-item-name').click();
    await page.waitForURL((url) => url.pathname.startsWith(`/groups/${GROUP_UID}`));
    expect(page.url()).toContain(`/groups/${GROUP_UID}`);
  });

  test('clicking the foundation label opens the project detail page instead', async ({ page }) => {
    await stubAccountContext(page);
    await stubGroups(page);
    await gotoGroups(page);

    await page.getByTestId('org-groups-item-project').click();
    await page.waitForURL((url) => url.pathname.startsWith(`/org/projects/${PROJECT_SLUG}`));
    expect(page.url()).toContain(`/org/projects/${PROJECT_SLUG}`);
  });
});
