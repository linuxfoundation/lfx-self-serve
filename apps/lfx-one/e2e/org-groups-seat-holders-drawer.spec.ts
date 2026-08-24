// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Groups — seat-holders drawer trigger (GH-1780). Covers what jsdom unit specs can't: that
 * clicking the row's seat-count button (now a third independently-clickable target inside the
 * row's stretched link, alongside the row body and the foundation link — see
 * org-groups-row-link.spec.ts) opens the drawer WITHOUT firing the row's `/groups/:uid`
 * stretched-link navigation, and that the drawer's own "View group page" link still reaches it.
 */

import { expect, test } from '@playwright/test';

import { GROUP_UID, MOCK_ACCOUNT_ID, SECOND_GROUP_UID, stubAccountContext, stubGroups, gotoGroups } from './helpers/org-groups.helper';

test.setTimeout(120_000);

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
        seatId: 'seat-transport-1',
        memberUid: 'seat-transport-1',
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
        seatId: 'seat-storage-1',
        memberUid: 'seat-storage-1',
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
    stats: { individualCount: 2, committeeCount: 2, foundationsCovered: 2 },
  };
}

test.describe('Org Groups — seat holders drawer (GH-1780)', () => {
  test.beforeEach(async ({ page }) => {
    await stubAccountContext(page);
    await stubGroups(page);
    await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/committee-members$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committeeMembersResponse()) });
    });
    await gotoGroups(page);
  });

  test('clicking the seat count opens the drawer without navigating to the group detail page', async ({ page }) => {
    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();

    await expect(page.getByTestId('group-seat-holders-drawer')).toBeVisible();
    expect(page.url()).not.toContain(`/groups/${GROUP_UID}`);
  });

  test('the drawer shows only the seat holders for the clicked group', async ({ page }) => {
    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();

    await expect(page.getByTestId('group-seat-holders-drawer')).toContainText('Jane Doe');
    await expect(page.getByTestId('group-seat-holders-drawer')).not.toContainText('John Smith');
  });

  test('the second row opens the drawer scoped to its own committee, not the first row', async ({ page }) => {
    await page.getByTestId(`org-groups-item-seats-${SECOND_GROUP_UID}`).click();

    await expect(page.getByTestId('group-seat-holders-drawer')).toContainText('John Smith');
    await expect(page.getByTestId('group-seat-holders-drawer')).not.toContainText('Jane Doe');
  });

  test('the drawer\'s "View group page" link navigates to the public group detail page', async ({ page }) => {
    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();
    await expect(page.getByTestId('group-seat-holders-drawer')).toBeVisible();

    await page.getByTestId('group-seat-holders-drawer-view-group-link').click();
    await page.waitForURL((url) => url.pathname.startsWith(`/groups/${GROUP_UID}`));
    expect(page.url()).toContain(`/groups/${GROUP_UID}`);
  });

  test('shows the empty state when no assignment matches the clicked group', async ({ page }) => {
    // Overrides the beforeEach stub — a later-registered page.route takes precedence over an
    // earlier one for a matching request, so this replaces the fixture roster for this test only.
    await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/committee-members$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orgUid: MOCK_ACCOUNT_ID, assignments: [], stats: { individualCount: 0, committeeCount: 0, foundationsCovered: 0 } }),
      })
    );

    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();

    await expect(page.getByTestId('group-seat-holders-drawer-empty')).toBeVisible();
  });
});
