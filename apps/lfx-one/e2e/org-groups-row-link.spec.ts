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

import { GROUP_UID, PROJECT_SLUG, SECOND_GROUP_UID, SECOND_PROJECT_SLUG, stubAccountContext, stubGroups, gotoGroups } from './helpers/org-groups.helper';

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
