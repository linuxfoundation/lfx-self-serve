// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Groups — row data-testid contract — Structural Tests (GH-1784).
 *
 * Companion to `org-groups-row-link.spec.ts`, which owns click-routing behavior for this same
 * row. This file asserts the data-testid contract in isolation: every row gets its own
 * uid-scoped testid, not one shared across rows. `toHaveCount` alone can't prove that — a CSS
 * attribute-prefix selector matches once per matching element regardless of whether two elements
 * carry the identical attribute value, so a regression to a non-unique scope (e.g.
 * `group.category`, identical on both fixture rows in `helpers/org-groups.helper.ts`) would still
 * report a count of 2. Mere distinctness isn't enough either — any per-row-unique value (array
 * index, group.name, project_uid...) would pass a uniqueness check without being uid-scoped, and
 * `Set` equality on its own would additionally miss a testid emitted twice on the same row
 * (duplicating an entry still collapses to the same 2-element set). These tests instead collect
 * the actual attribute values, sort them, and compare the whole array against the exact expected
 * `<prefix><uid>` list — proving count, uniqueness, and identity in a single assertion.
 */

import { expect, Page, test } from '@playwright/test';

import { GROUP_UID, SECOND_GROUP_UID, stubAccountContext, stubGroups, gotoGroups } from './helpers/org-groups.helper';

test.beforeEach(() => skipWhenAuthMissing());

// Named for what it returns, not what the caller does with it — a helper that claims
// distinctness it doesn't itself guarantee is the same trap this file exists to catch one layer
// down. Callers assert count/uniqueness/identity from the raw collected values.
async function collectTestIds(page: Page, prefix: string): Promise<string[]> {
  const values = await page.locator(`[data-testid^="${prefix}"]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
  return values.filter((v): v is string => v !== null);
}

test.setTimeout(120_000);

test.describe('Org Groups — row data-testid contract (GH-1784)', () => {
  test.beforeEach(async ({ page }) => {
    await stubAccountContext(page);
    await stubGroups(page);
    await gotoGroups(page);
  });

  test('name, project, and seats testids are uid-scoped, not merely distinct', async ({ page }) => {
    // Sorted-array equality against the exact expected ids — not Set equality — because building
    // a Set collapses a duplicated testid (the same id emitted on two elements) before the
    // comparison runs, so it can't catch that regression; a sorted-array comparison proves count,
    // uniqueness, and identity all at once.
    for (const prefix of ['org-groups-item-name-', 'org-groups-item-project-', 'org-groups-item-seats-']) {
      const ids = await collectTestIds(page, prefix);
      const expected = [`${prefix}${GROUP_UID}`, `${prefix}${SECOND_GROUP_UID}`].sort();
      expect(ids.slice().sort(), `expected exactly [${expected.join(', ')}]`).toEqual(expected);
    }
  });

  test('the row link testid is uid-scoped, not merely distinct', async ({ page }) => {
    const prefix = 'org-groups-row-link-';
    const ids = await collectTestIds(page, prefix);
    const expected = [`${prefix}${GROUP_UID}`, `${prefix}${SECOND_GROUP_UID}`].sort();
    expect(ids.slice().sort()).toEqual(expected);
  });
});
