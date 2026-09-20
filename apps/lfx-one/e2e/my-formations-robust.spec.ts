// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Me-lens My Formations page, structural contract (#2753). Asserts the data-testid nesting and
 * control shape independent of copy — see my-formations.spec.ts for the content-based behaviour
 * coverage.
 */

import { expect, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, FORMATION_PROJECT_SLUG, gotoMyFormations } from './helpers/formation-checklist.helper';

test.setTimeout(120_000);

const CASCADE = `formation-${FORMATION_PROJECT_SLUG}`;

test.describe('Me-lens My Formations page structural contract (#2753)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMyFormations(page);
    await expect(page.getByTestId(`my-formations-row-${CASCADE}`)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('nests the header, stage tabs, search and table under the page container', async ({ page }) => {
    const container = page.getByTestId('my-formations-container');
    await expect(container).toBeAttached();
    await expect(container.getByTestId('my-formations-title')).toBeAttached();
    expect(await container.getByTestId('my-formations-title').evaluate((el) => el.tagName)).toBe('H1');
    await expect(container.getByTestId('my-formations-description')).toBeAttached();

    const card = container.getByTestId('my-formations-card');
    await expect(card).toBeAttached();
    await expect(card.getByTestId('my-formations-stage-tabs')).toBeAttached();
    await expect(card.getByTestId('filter-pill-all')).toBeAttached();
    await expect(card.getByTestId('filter-pill-exploratory')).toBeAttached();
    await expect(card.getByTestId('filter-pill-engaged')).toBeAttached();
    await expect(card.getByTestId('filter-pill-on_hold')).toBeAttached();
    await expect(card.getByTestId('my-formations-search-input').locator('input')).toBeAttached();
    await expect(card.getByTestId('my-formations-table')).toBeAttached();

    await expect(page.getByTestId('my-formations-error')).toHaveCount(0);
    await expect(page.getByTestId('my-formations-empty-state')).toHaveCount(0);
    await expect(page.getByTestId('my-formations-no-results')).toHaveCount(0);
  });

  test('each row carries a real labelled anchor, a stage tag, and the items, progress, announcement and blocking cells', async ({ page }) => {
    const row = page.getByTestId(`my-formations-row-${CASCADE}`);

    const open = row.getByTestId(`my-formations-open-${CASCADE}`);
    await expect(open).toBeAttached();
    expect(await open.evaluate((el) => el.tagName)).toBe('A');
    await expect(open).toHaveAttribute('href', /\/project\/formation\?project=.+/);
    await expect(open).toHaveAttribute('aria-label', /formation checklist$/);

    // The stage test id sits on the lfx-tag host itself, so assert on the resolved element.
    const stage = row.getByTestId(`my-formations-stage-${CASCADE}`);
    await expect(stage).toBeAttached();
    expect(await stage.evaluate((el) => el.tagName)).toBe('LFX-TAG');
    await expect(row.getByTestId(`my-formations-items-${CASCADE}`)).toBeAttached();

    const progress = row.getByTestId(`my-formations-progress-${CASCADE}`).locator('[role="progressbar"]');
    await expect(progress).toBeAttached();
    await expect(progress).toHaveAttribute('aria-valuenow', /^\d+$/);
    await expect(progress).toHaveAttribute('aria-valuemin', '0');
    await expect(progress).toHaveAttribute('aria-valuemax', '100');

    await expect(row.getByTestId(`my-formations-announcement-${CASCADE}`)).toBeAttached();
    await expect(row.getByTestId(`my-formations-blocking-${CASCADE}`)).toBeAttached();
  });

  test('the sidebar entry is the last child of My Engagement and points at /formations', async ({ page }) => {
    const nav = page.getByTestId('sidebar-my-formations');
    await expect(nav).toBeAttached();
    await expect(nav.locator('a').first()).toHaveAttribute('href', '/formations');

    // Every menu item inside a section carries a `sidebar-*` test id (sidebar.component.html's
    // menuItem template), so the section's last such descendant is its last entry.
    const engagement = page.getByTestId('sidebar-item-my-engagement');
    await expect(engagement).toBeAttached();
    await expect(engagement.locator('[data-testid^="sidebar-"]').last()).toHaveAttribute('data-testid', 'sidebar-my-formations');
  });
});
