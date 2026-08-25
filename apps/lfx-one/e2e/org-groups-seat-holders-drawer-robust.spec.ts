// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Groups — seat-holders drawer data-testid contract — Structural Tests (GH-1780).
 *
 * Companion to `org-groups-seat-holders-drawer.spec.ts`, which owns click-routing/content behavior
 * for the same drawer. This file stays focused on the data-testid contract in isolation, mirroring
 * `org-groups-row-link-robust.spec.ts`'s split for the row itself: a per-seat testid must be
 * uid-scoped — not shared across rows within one committee's roster (see "each seat row within one
 * committee..." below), and not reused across drawer opens for a different committee (see
 * "opening a different committee..." below) — so a component swap that keeps the same visible copy
 * but breaks either scope still fails here even though the content spec would still pass.
 */

import { expect, Page, test } from '@playwright/test';

import {
  DATA_LOAD_TIMEOUT,
  GROUP_UID,
  SEAT_STORAGE_1,
  SEAT_TRANSPORT_1,
  SEAT_TRANSPORT_2,
  SECOND_GROUP_UID,
  stubAccountContext,
  stubCommitteeMembers,
  stubGroups,
  gotoGroups,
} from './helpers/org-groups.helper';

test.setTimeout(120_000);

async function collectSeatTestIds(page: Page): Promise<string[]> {
  const values = await page.locator('[data-testid^="group-seat-holder-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  return values.filter((v): v is string => v !== null);
}

test.describe('Org Groups — seat holders drawer data-testid contract (GH-1780)', () => {
  test.beforeEach(async ({ page }) => {
    await stubAccountContext(page);
    await stubGroups(page);
    await stubCommitteeMembers(page);
    await gotoGroups(page);
    await page.getByTestId(`org-groups-item-seats-${GROUP_UID}`).click();
    // Wait for the roster itself, not just the drawer shell — the shell (and its loading spinner)
    // renders before the fetch resolves, so a wait on the shell alone lets every test below run
    // against a still-loading drawer and pass vacuously.
    await expect(page.getByTestId('group-seat-holders-list')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('renders the drawer chrome testids', async ({ page }) => {
    await expect(page.getByTestId('group-seat-holders-drawer-title')).toBeVisible();
    await expect(page.getByTestId('group-seat-holders-drawer-subtitle')).toBeVisible();
    await expect(page.getByTestId('group-seat-holders-drawer-view-group-link')).toBeVisible();
  });

  test('each seat row within one committee gets its own seatId-scoped testid, not a testid shared across rows', async ({ page }) => {
    const ids = await collectSeatTestIds(page);

    expect(ids.slice().sort()).toEqual([`group-seat-holder-${SEAT_TRANSPORT_1}`, `group-seat-holder-${SEAT_TRANSPORT_2}`].sort());
  });

  test("opening a different committee produces its own seat testids, not the previous committee's", async ({ page }) => {
    const firstCommitteeIds = await collectSeatTestIds(page);

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('group-seat-holders-drawer')).toBeHidden();
    await page.getByTestId(`org-groups-item-seats-${SECOND_GROUP_UID}`).click();
    await expect(page.getByTestId('group-seat-holders-list')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const secondCommitteeIds = await collectSeatTestIds(page);

    expect(secondCommitteeIds).toEqual([`group-seat-holder-${SEAT_STORAGE_1}`]);
    expect(firstCommitteeIds.some((id) => secondCommitteeIds.includes(id))).toBe(false);
  });

  test('the loading/empty/error state testids are mutually exclusive once the drawer settles', async ({ page }) => {
    await expect(page.getByTestId('group-seat-holders-drawer-loading')).toHaveCount(0);
    await expect(page.getByTestId('group-seat-holders-drawer-empty')).toHaveCount(0);
    await expect(page.getByTestId('group-seat-holders-drawer-error')).toHaveCount(0);
    await expect(page.getByTestId('group-seat-holders-list')).toBeVisible();
  });

  // The person-open button's testid ('seat-holder-person-{seatId}') deliberately does NOT share the
  // row's own stem ('group-seat-holder-{seatId}') — a shared stem is exactly what collectSeatTestIds()
  // above guards against via its `[data-testid^="group-seat-holder-"]` prefix match, which would
  // otherwise pick up both the row and its nested button. Asserts nesting (a real DOM descendant, not
  // just two matching elements anywhere on the page) and tag (a real <button>, not a div handler).
  test('each row nests a real <button> for opening the person-detail drawer, under its own non-colliding testid', async ({ page }) => {
    const row = page.getByTestId(`group-seat-holder-${SEAT_TRANSPORT_1}`);
    const button = row.getByTestId(`seat-holder-person-${SEAT_TRANSPORT_1}`);

    await expect(button).toBeVisible();
    expect(await button.evaluate((el) => el.tagName)).toBe('BUTTON');

    // `row.locator(...)` matches descendants only, so the row's own testid doesn't self-match — this
    // fails iff something nested under the row reuses the row's 'group-seat-holder-' stem, which is
    // what would make collectSeatTestIds()'s prefix match over-collect it. Redundant with the "each
    // seat row..." test above (its exact-set assertion would also fail on the same regression) —
    // kept anyway as defense-in-depth that localizes the failure to this one row.
    await expect(row.locator('[data-testid^="group-seat-holder-"]')).toHaveCount(0);
  });
});
