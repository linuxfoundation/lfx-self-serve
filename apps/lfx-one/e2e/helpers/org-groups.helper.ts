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

export function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — let the test run and surface a useful failure.
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

export async function stubGroups(page: Page): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/groups$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(groupsResponse()) });
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

export async function gotoGroups(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(GROUPS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/groups')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/groups redirected away');
  }
  await expect(page.getByTestId(`org-groups-item-${GROUP_UID}`)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}
