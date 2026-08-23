// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Groups — row vs. foundation-link click targets (GH-1784). Covers what jsdom unit specs
 * can't: the `peer absolute inset-0` stretched anchor plus `pointer-events-none` row content
 * actually route clicks to the right destination depending on where in the row they land.
 *
 * Companion to `org-groups-row-link-robust.spec.ts`, which owns the data-testid contract
 * (presence, uniqueness) for this same row. This file stays focused on click-routing behavior.
 */

import { expect, Page, test } from '@playwright/test';

const GROUPS_URL = '/org/groups';
const DATA_LOAD_TIMEOUT = 30_000;

const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_ACCOUNT_NAME = 'Acme Motors';
const MOCK_ACCOUNT_SLUG = 'acme-motors';

const GROUP_UID = 'c-transport';
const PROJECT_SLUG = 'uepf';

const SECOND_GROUP_UID = 'c-storage';
const SECOND_PROJECT_SLUG = 'cncf';

function groupsResponse() {
  return {
    // A second group with its own uid/slug is deliberate, not incidental fixture noise — the
    // tests below that assert against SECOND_GROUP_UID prove the stretched-link overlay /
    // pointer-events routing works on a non-first row too, not just coincidentally on the only
    // row present. The data-testid contract itself (presence, uniqueness across rows) is covered
    // separately in org-groups-row-link-robust.spec.ts, which has its own copy of this fixture.
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
      {
        uid: SECOND_GROUP_UID,
        name: 'Storage Working Group',
        category: 'Working Group',
        project_uid: 'cncf-root',
        project_slug: SECOND_PROJECT_SLUG,
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
  test.beforeEach(async ({ page }) => {
    await stubAccountContext(page);
    await stubGroups(page);
    await gotoGroups(page);
  });

  test('clicking the row body opens the group detail page', async ({ page }) => {
    // Click the group name text, not the anchor overlay directly — this is the part jsdom
    // can't verify: that the stretched link actually receives the click through the
    // pointer-events-none content wrapper. force: true is required here for a real reason, not
    // to paper over a broken test: Playwright's actionability guard sees the name text sits
    // inside pointer-events-none and refuses to click it (it thinks nothing there is clickable),
    // even though the browser itself would correctly hit-test the click through to the overlay
    // anchor beneath. force skips only that precondition — Playwright still dispatches a real
    // click at these coordinates, so the overlay/pointer-events mechanics are still what's under
    // test. Same pattern as org-meetings-dashboard.spec.ts and weekly-brief-card.spec.ts.
    await page.getByTestId(`org-groups-item-name-${GROUP_UID}`).click({ force: true });
    await page.waitForURL((url) => url.pathname.startsWith(`/groups/${GROUP_UID}`));
    expect(page.url()).toContain(`/groups/${GROUP_UID}`);
  });

  test('clicking the foundation label opens the membership detail page instead', async ({ page }) => {
    await page.getByTestId(`org-groups-item-project-${GROUP_UID}`).click();
    await page.waitForURL((url) => url.pathname.startsWith(`/org/memberships/${PROJECT_SLUG}`));
    expect(page.url()).toContain(`/org/memberships/${PROJECT_SLUG}`);
  });

  test('clicking the second row body opens that group detail page, not the first row', async ({ page }) => {
    await page.getByTestId(`org-groups-item-name-${SECOND_GROUP_UID}`).click({ force: true });
    await page.waitForURL((url) => url.pathname.startsWith(`/groups/${SECOND_GROUP_UID}`));
    expect(page.url()).toContain(`/groups/${SECOND_GROUP_UID}`);
  });

  test('clicking the second row foundation label opens that membership page, not the first row', async ({ page }) => {
    await page.getByTestId(`org-groups-item-project-${SECOND_GROUP_UID}`).click();
    await page.waitForURL((url) => url.pathname.startsWith(`/org/memberships/${SECOND_PROJECT_SLUG}`));
    expect(page.url()).toContain(`/org/memberships/${SECOND_PROJECT_SLUG}`);
  });
});
