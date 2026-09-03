// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared fixtures/mocks for `/org/groups` row and seat-holders-drawer specs (GH-1784, GH-1780).
 *
 * Used by each content/`-robust` spec pair — `org-groups-row-link(.spec|-robust.spec).ts` for the
 * row itself, `org-groups-seat-holders-drawer(.spec|-robust.spec).ts` for the drawer — so no pair
 * can drift apart on the fixture they both depend on. A robust spec certifying a contract the
 * content spec no longer exercises (or vice versa) is exactly the failure mode this file exists to
 * prevent.
 */

import { expect, Page, test } from '@playwright/test';

export const GROUPS_URL = '/org/groups';
export const DATA_LOAD_TIMEOUT = 30_000;

export const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
export const MOCK_ACCOUNT_NAME = 'Acme Motors';
export const MOCK_ACCOUNT_SLUG = 'acme-motors';

export const GROUP_UID = 'c-transport';
export const PROJECT_SLUG = 'uepf';

export const SECOND_GROUP_UID = 'c-storage';
export const SECOND_PROJECT_SLUG = 'cncf';

export function groupsResponse() {
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
      {
        uid: SECOND_GROUP_UID,
        name: 'Storage Working Group',
        // Deliberately identical category to the first row — a testid regressed to
        // `'org-groups-item-name-' + group.category` would collide on this value, which is
        // exactly the case org-groups-row-link-robust.spec.ts's exact-id assertions need to catch.
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

// Gated on env vars rather than on URL sniffing so genuine auth-flow regressions (expired
// storageState, broken Auth0 login helper) still fail loudly when creds ARE configured —
// URL-based detection silently turned those into green skips instead. Matches the pattern in
// groups-view-toggle.spec.ts.
const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

export function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

export async function stubAccountContext(page: Page): Promise<void> {
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

/** An org whose employees hold no non-board seats — the genuine-empty-state case (GH-1809). */
export function emptyGroupsResponse() {
  return { groups: [], total_groups: 0, total_seats: 0 };
}

/** A roster large enough to stand in for a "small org" (~50 groups) without being the 600+ case. */
export function smallOrgGroupsResponse(groupCount = 50) {
  const groups = Array.from({ length: groupCount }, (_, i) => ({
    uid: `c-small-${i}`,
    name: `Small Org Working Group ${i}`,
    category: 'Working Group',
    project_uid: 'uepf-root',
    project_slug: PROJECT_SLUG,
    project_name: 'Ultra Ethernet Consortium Fund',
    org_seat_count: (i % 5) + 1,
  }));
  return { groups, total_groups: groups.length, total_seats: groups.reduce((sum, g) => sum + g.org_seat_count, 0) };
}

/**
 * `delayMs` holds the response open so the loading state is observable — the page is expected to
 * paint chrome and a skeleton without waiting for this, which is the whole point of GH-1809.
 */
export async function stubGroups(page: Page, options: { body?: unknown; delayMs?: number } = {}): Promise<void> {
  const { body = groupsResponse(), delayMs = 0 } = options;
  await page.route(/\/api\/orgs\/[^/]+\/lens\/groups$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

// Seat holders for the seat-holders-drawer specs (GH-1780). GROUP_UID gets two seats (proves a
// per-seat testid/row is scoped to the seat, not the group) across two people; SECOND_GROUP_UID
// gets one, on a different person — proves the drawer scopes by committeeUid, not just "any seat".
export const SEAT_TRANSPORT_1 = 'seat-transport-1';
export const SEAT_TRANSPORT_2 = 'seat-transport-2';
export const SEAT_STORAGE_1 = 'seat-storage-1';

export function committeeMembersResponse() {
  const person = (email: string, fullName: string) => ({
    email,
    firstName: fullName.split(' ')[0],
    lastName: fullName.split(' ')[1] ?? '',
    fullName,
    jobTitle: null,
    initials: fullName
      .split(' ')
      .map((p) => p[0])
      .join(''),
  });

  return {
    orgUid: MOCK_ACCOUNT_ID,
    assignments: [
      {
        seatId: SEAT_TRANSPORT_1,
        memberUid: SEAT_TRANSPORT_1,
        committeeUid: GROUP_UID,
        committeeName: 'Transport Working Group',
        committeeCategory: 'Working Group',
        projectUid: 'uepf-root',
        foundationSlug: 'uepf',
        foundationName: 'Ultra Ethernet Consortium Fund',
        role: 'Chair',
        votingStatus: 'Voting Rep',
        appointedBy: 'Membership Entitlement',
        isOrgEditable: true,
        reason: null,
        person: person('jane@acme-motors.example', 'Jane Doe'),
      },
      {
        seatId: SEAT_TRANSPORT_2,
        memberUid: SEAT_TRANSPORT_2,
        committeeUid: GROUP_UID,
        committeeName: 'Transport Working Group',
        committeeCategory: 'Working Group',
        projectUid: 'uepf-root',
        foundationSlug: 'uepf',
        foundationName: 'Ultra Ethernet Consortium Fund',
        role: 'Member',
        votingStatus: 'Non-voting',
        appointedBy: 'Manual',
        isOrgEditable: false,
        reason: 'Not a membership-entitlement seat',
        person: person('sam@acme-motors.example', 'Sam Lee'),
      },
      {
        seatId: SEAT_STORAGE_1,
        memberUid: SEAT_STORAGE_1,
        committeeUid: SECOND_GROUP_UID,
        committeeName: 'Storage Working Group',
        committeeCategory: 'Working Group',
        projectUid: 'cncf-root',
        foundationSlug: 'cncf',
        foundationName: 'Cloud Native Computing Foundation',
        role: 'Member',
        votingStatus: 'Non-voting',
        appointedBy: 'Manual',
        isOrgEditable: false,
        reason: 'Not a membership-entitlement seat',
        person: person('john@acme-motors.example', 'John Smith'),
      },
    ],
    stats: { individualCount: 3, committeeCount: 2, foundationsCovered: 2 },
  };
}

export async function stubCommitteeMembers(page: Page, response: unknown = committeeMembersResponse()): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/committee-members$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });
}

/**
 * Navigates to `/org/groups` and stops as soon as the route is confirmed — without waiting for any
 * roster row. Split out of `gotoGroups` for the cases where a row is never expected to appear: a
 * still-loading roster, or an org with no groups at all.
 */
export async function openGroupsPage(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(GROUPS_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/groups')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/groups redirected away');
  }
}

export async function gotoGroups(page: Page): Promise<void> {
  await openGroupsPage(page);
  await expect(page.getByTestId(`org-groups-item-${GROUP_UID}`)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}
