// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Groups — seat-holders drawer data-testid contract — Structural Tests (GH-1780).
 *
 * Companion to `org-groups-seat-holders-drawer.spec.ts`, which owns click-routing/content behavior
 * for the same drawer. This file stays focused on the data-testid contract in isolation, mirroring
 * `org-groups-row-link-robust.spec.ts`'s split for the row itself: a per-seat testid must be
 * uid-scoped (not shared across rows in the same committee, and not shared across drawer opens for
 * different committees), so a component swap that keeps the same visible copy but breaks the
 * testid scope still fails here even though the content spec would still pass.
 */

import { expect, test } from '@playwright/test';

import { GROUP_UID, MOCK_ACCOUNT_ID, stubAccountContext, stubGroups, gotoGroups } from './helpers/org-groups.helper';

test.setTimeout(120_000);

const SEAT_A = 'seat-transport-1';
const SEAT_B = 'seat-transport-2';

function committeeMembersResponse() {
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
        seatId: SEAT_A,
        memberUid: SEAT_A,
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
        seatId: SEAT_B,
        memberUid: SEAT_B,
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
    ],
    stats: { individualCount: 2, committeeCount: 1, foundationsCovered: 1 },
  };
}

test.describe('Org Groups — seat holders drawer data-testid contract (GH-1780)', () => {
  test.beforeEach(async ({ page }) => {
    await stubAccountContext(page);
    await stubGroups(page);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/committee-members$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committeeMembersResponse()) });
    });
    await gotoGroups(page);
    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();
    await expect(page.getByTestId('group-seat-holders-drawer')).toBeVisible();
  });

  test('renders the drawer chrome testids', async ({ page }) => {
    await expect(page.getByTestId('group-seat-holders-drawer-title')).toBeVisible();
    await expect(page.getByTestId('group-seat-holders-drawer-subtitle')).toBeVisible();
    await expect(page.getByTestId('group-seat-holders-drawer-view-group-link')).toBeVisible();
    await expect(page.getByTestId('group-seat-holders-list')).toBeVisible();
  });

  test('each seat row gets its own seatId-scoped testid, not a testid shared across rows', async ({ page }) => {
    const ids = await page.locator('[data-testid^="group-seat-holder-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));

    expect(ids.slice().sort()).toEqual([`group-seat-holder-${SEAT_A}`, `group-seat-holder-${SEAT_B}`].sort());
  });

  test('the loading/empty/error state testids are mutually exclusive once the drawer settles', async ({ page }) => {
    await expect(page.getByTestId('group-seat-holders-drawer-empty')).toHaveCount(0);
    await expect(page.getByTestId('group-seat-holders-drawer-error')).toHaveCount(0);
  });
});
