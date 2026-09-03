// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Groups — seat-holders drawer trigger (GH-1780). Covers what jsdom unit specs can't: that
 * clicking the row's seat-count button (now a third independently-clickable target inside the
 * row's stretched link, alongside the row body and the foundation link — see
 * org-groups-row-link.spec.ts) opens the drawer WITHOUT firing the row's `/groups/:uid`
 * stretched-link navigation, and that the drawer's own "View group page" link still reaches it.
 *
 * Companion to `org-groups-seat-holders-drawer-robust.spec.ts`, which owns the drawer's
 * data-testid contract. Both share their fixture via `helpers/org-groups.helper.ts`.
 */

import { expect, test } from '@playwright/test';
import { skipWhenAuthMissing } from './helpers/auth.helper';

import {

test.beforeEach(() => skipWhenAuthMissing());
  DATA_LOAD_TIMEOUT,
  GROUP_UID,
  MOCK_ACCOUNT_ID,
  SEAT_TRANSPORT_1,
  SECOND_GROUP_UID,
  committeeMembersResponse,
  stubAccountContext,
  stubCommitteeMembers,
  stubGroups,
  gotoGroups,
} from './helpers/org-groups.helper';

test.setTimeout(120_000);

test.describe('Org Groups — seat holders drawer (GH-1780)', () => {
  test.beforeEach(async ({ page }) => {
    await stubAccountContext(page);
    await stubGroups(page);
    await stubCommitteeMembers(page);
    await gotoGroups(page);
  });

  test('clicking the seat count opens the drawer without navigating to the group detail page', async ({ page }) => {
    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();

    await expect(page.getByTestId('group-seat-holders-list')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    expect(page.url()).not.toContain(`/groups/${GROUP_UID}`);
  });

  test('the drawer shows only the seat holders for the clicked group', async ({ page }) => {
    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();
    await expect(page.getByTestId('group-seat-holders-list')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('group-seat-holders-drawer')).toContainText('Jane Doe');
    await expect(page.getByTestId('group-seat-holders-drawer')).toContainText('Sam Lee');
    await expect(page.getByTestId('group-seat-holders-drawer')).not.toContainText('John Smith');
  });

  test('the second row opens the drawer scoped to its own committee, not the first row', async ({ page }) => {
    await page.getByTestId(`org-groups-item-seats-${SECOND_GROUP_UID}`).click();
    await expect(page.getByTestId('group-seat-holders-list')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('group-seat-holders-drawer')).toContainText('John Smith');
    await expect(page.getByTestId('group-seat-holders-drawer')).not.toContainText('Jane Doe');
    await expect(page.getByTestId('group-seat-holders-drawer')).not.toContainText('Sam Lee');
  });

  test('the drawer\'s "View group page" link navigates to the public group detail page', async ({ page }) => {
    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();
    await expect(page.getByTestId('group-seat-holders-list')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('group-seat-holders-drawer-view-group-link').click();
    await page.waitForURL((url) => url.pathname.startsWith(`/groups/${GROUP_UID}`));
    expect(page.url()).toContain(`/groups/${GROUP_UID}`);
  });

  test('shows the empty state when no assignment matches the clicked group', async ({ page }) => {
    // Overrides the beforeEach stub — a later-registered page.route takes precedence over an
    // earlier one for a matching request, so this replaces the fixture roster for this test only.
    await stubCommitteeMembers(page, { orgUid: MOCK_ACCOUNT_ID, assignments: [], stats: { individualCount: 0, committeeCount: 0, foundationsCovered: 0 } });

    // Waits on the actual request, not just the resulting DOM — a broken orgUid/committeeUid
    // binding that never issues the request would render this same empty state (seatHolderVms
    // defaults to []), so asserting the DOM alone wouldn't catch that regression.
    const responsePromise = page.waitForResponse(/\/api\/orgs\/[^/]+\/lens\/people\/committee-members$/);
    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);

    await expect(page.getByTestId('group-seat-holders-drawer-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('shows the error state when the committee-members fetch fails', async ({ page }) => {
    // Overrides the beforeEach stub with a failing response, not a fixture — stubCommitteeMembers
    // always fulfills with 200, so a genuine upstream failure needs its own route registration.
    await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/committee-members$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal error' }) });
    });

    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();

    await expect(page.getByTestId('group-seat-holders-drawer-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('group-seat-holders-drawer-empty')).not.toBeVisible();
  });

  test('the "Try again" button recovers from a failed fetch without closing the drawer', async ({ page }) => {
    let requestCount = 0;
    await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/committee-members$/, (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      requestCount += 1;
      if (requestCount === 1) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal error' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committeeMembersResponse()) });
    });

    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();
    await expect(page.getByTestId('group-seat-holders-drawer-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('group-seat-holders-drawer-retry').click();

    await expect(page.getByTestId('group-seat-holders-list')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('group-seat-holders-drawer')).toContainText('Jane Doe');
    expect(requestCount).toBe(2);
  });

  // Mirrors org-people-board-tab.spec.ts's "clicking a board member name opens the person-detail
  // drawer on Governance from table seats (no fetch)" — same opener shape (no personKey, so the
  // personKey-keyed detail fetch must never fire), same stacked-on-top drawer, different source list.
  test('clicking a seat holder opens the shared person-detail drawer on Governance, stacked on top', async ({ page }) => {
    let personDetailCalls = 0;
    await page.route('**/api/orgs/*/lens/people/*/detail', (route) => {
      personDetailCalls += 1;
      return route.fulfill({ status: 500, body: 'unexpected personKey-based detail fetch' });
    });

    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();
    await expect(page.getByTestId('group-seat-holders-list')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId(`seat-holder-person-${SEAT_TRANSPORT_1}`).click();

    await expect(page.getByTestId('person-detail-drawer-header')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('person-detail-drawer-header')).toContainText('Jane Doe');
    await expect(page.getByTestId('person-detail-drawer-tab-governance')).toHaveAttribute('aria-selected', 'true');

    // Stacked on top of, not instead of, the seat-holders drawer.
    await expect(page.getByTestId('group-seat-holders-drawer')).toBeVisible();
    const drawer = page.getByTestId('person-detail-drawer');
    await expect(drawer).toContainText('Ultra Ethernet Consortium Fund · Transport Working Group');

    expect(personDetailCalls).toBe(0);
  });
});
