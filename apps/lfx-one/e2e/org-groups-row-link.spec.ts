// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Groups — row vs. foundation-link click targets (GH-1784). Covers what jsdom unit specs
 * can't: the `peer absolute inset-0` stretched anchor plus `pointer-events-none` row content
 * actually route clicks to the right destination depending on where in the row they land.
 *
 * Companion to `org-groups-row-link-robust.spec.ts`, which owns the data-testid contract
 * (presence, uniqueness) for this same row. This file stays focused on click-routing behavior.
 * Both share their fixture/setup via `helpers/org-groups.helper.ts` so the two specs can't drift
 * apart on what they're each asserting against.
 */

import { expect, test } from '@playwright/test';
import { skipWhenAuthMissing } from './helpers/auth.helper';

import {
  DATA_LOAD_TIMEOUT,
  GROUP_UID,
  PROJECT_SLUG,
  SECOND_GROUP_UID,
  SECOND_PROJECT_SLUG,
  emptyGroupsResponse,
  gotoGroups,
  openGroupsPage,
  smallOrgGroupsResponse,
  stubAccountContext,
  stubGroups,
} from './helpers/org-groups.helper';

test.beforeEach(() => skipWhenAuthMissing());

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

/**
 * Loading and empty rendering (GH-1809). The roster fetch is now guarded to the browser, so the
 * server no longer holds the document open for the whole upstream seat drain. The user-visible
 * consequence is that the page must paint its chrome and a skeleton immediately and fill the roster
 * in afterwards — and that the skeleton must be a genuinely transient state, not what an org with
 * no groups is left staring at.
 *
 * These use `openGroupsPage` rather than the shared `gotoGroups`, which waits for a roster row that
 * neither case ever produces.
 */
test.describe('Org Groups — loading and empty rendering (GH-1809)', () => {
  test('paints page chrome and a skeleton while the roster request is still outstanding', async ({ page }) => {
    await stubAccountContext(page);
    // Held open well past the point the chrome should have painted. Before the browser-only guard
    // the server render blocked on exactly this request, so nothing at all was painted until it
    // resolved — this delay is what makes that difference observable rather than a race.
    await stubGroups(page, { delayMs: 5_000 });
    await openGroupsPage(page);

    await expect(page.getByTestId('org-groups-header')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-groups-list-skeleton')).toBeVisible();
    await expect(page.getByTestId(`org-groups-item-${GROUP_UID}`)).toHaveCount(0);

    // The skeleton is a stage, not the destination: the roster still arrives and replaces it.
    await expect(page.getByTestId(`org-groups-item-${GROUP_UID}`)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-groups-list-skeleton')).toHaveCount(0);
  });

  test('shows the empty state, not a permanent skeleton, for an org with no groups', async ({ page }) => {
    await stubAccountContext(page);
    await stubGroups(page, { body: emptyGroupsResponse() });
    await openGroupsPage(page);

    await expect(page.getByTestId('org-groups-empty-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-groups-list-skeleton')).toHaveCount(0);
  });

  test('renders a small org\u2019s full roster, with the skeleton clearing', async ({ page }) => {
    const response = smallOrgGroupsResponse();
    await stubAccountContext(page);
    await stubGroups(page, { body: response });
    await openGroupsPage(page);

    // Guards the other direction from the two tests above: moving the fetch to the browser must not
    // leave a small org — which never had a slow load to fix — stuck on the skeleton or short rows.
    await expect(page.getByTestId('org-groups-list-items')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-groups-list-items').getByRole('listitem')).toHaveCount(response.total_groups);
    await expect(page.getByTestId('org-groups-list-skeleton')).toHaveCount(0);
  });
});
