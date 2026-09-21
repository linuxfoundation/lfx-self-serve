// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Me-lens My Formations page (#2753) — the dedicated list of formations with checklist items
 * assigned to the signed-in user, reached from the My Engagement sidebar group, replacing the
 * dashboard card. Deterministic via route mocks; see my-formations-robust.spec.ts for the
 * structural contract.
 */

import { expect, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, FORMATION_PROJECT_SLUG, gotoMyFormations, MY_FORMATIONS_ROWS } from './helpers/formation-checklist.helper';

test.setTimeout(120_000);

const ROW_PREFIX = 'my-formations-row-';
const CASCADE = `formation-${FORMATION_PROJECT_SLUG}`;

test.describe('Me-lens My Formations page (#2753)', () => {
  test('is reachable from the My Engagement sidebar group and lists every formation in need order with its details', async ({ page }) => {
    await gotoMyFormations(page);

    await expect(page.getByTestId('my-formations-title')).toHaveText('My Formations', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('my-formations-description')).toContainText('checklist items assigned to you');

    // Sidebar: last item of My Engagement, right after My Documents.
    const nav = page.getByTestId('sidebar-my-formations');
    await expect(nav).toBeVisible();
    await expect(nav).toContainText('My Formations');

    const rows = page.locator(`[data-testid^="${ROW_PREFIX}"]`);
    await expect(rows).toHaveCount(MY_FORMATIONS_ROWS.length, { timeout: DATA_LOAD_TIMEOUT });
    // Served out of order; rendered by need — most to do first, then blocked, then name.
    await expect(rows.nth(0)).toHaveAttribute('data-testid', `${ROW_PREFIX}${CASCADE}`);
    await expect(rows.nth(1)).toHaveAttribute('data-testid', `${ROW_PREFIX}formation-harbor-mesh`);
    await expect(rows.nth(2)).toHaveAttribute('data-testid', `${ROW_PREFIX}formation-orbit-ledger`);

    await expect(page.getByTestId(`my-formations-open-${CASCADE}`)).toHaveText('Cascade Data Alliance');
    await expect(page.getByTestId(`my-formations-stage-${CASCADE}`)).toContainText('Engaged');
    await expect(page.getByTestId(`my-formations-items-${CASCADE}`)).toContainText('2 to do · 1 done');
    await expect(page.getByTestId(`my-formations-progress-${CASCADE}`)).toContainText('5 of 17');
    await expect(page.getByTestId(`my-formations-announcement-${CASCADE}`)).toContainText('Oct 25');
    await expect(page.getByTestId(`my-formations-blocking-${CASCADE}`)).toContainText('Contribution agreement executed');

    // An upstream stage outside the queue taxonomy renders verbatim; missing data reads honestly.
    await expect(page.getByTestId('my-formations-stage-formation-orbit-ledger')).toContainText('Formation - Disengaged');
    await expect(page.getByTestId('my-formations-announcement-formation-orbit-ledger')).toContainText('Not set');
    await expect(page.getByTestId('my-formations-blocking-formation-orbit-ledger')).toHaveText('—');

    await expect(page.getByTestId('my-formations-error')).toHaveCount(0);
    await expect(page.getByTestId('my-formations-empty-state')).toHaveCount(0);
  });

  test('a formation name is a real link to its project checklist and following it lands there', async ({ page }) => {
    await gotoMyFormations(page);

    const open = page.getByTestId(`my-formations-open-${CASCADE}`);
    await expect(open).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(open).toHaveAttribute('href', `/project/formation?project=${FORMATION_PROJECT_SLUG}`);

    await open.click();
    await expect(page).toHaveURL(new RegExp(`/project/formation\\?project=${FORMATION_PROJECT_SLUG}$`), { timeout: DATA_LOAD_TIMEOUT });
  });

  test('filters by stage tab and by search, and Reset restores every row', async ({ page }) => {
    await gotoMyFormations(page);

    const rows = page.locator(`[data-testid^="${ROW_PREFIX}"]`);
    await expect(rows).toHaveCount(3, { timeout: DATA_LOAD_TIMEOUT });

    // Stage tab: only the exploratory row; the unmapped-stage row matches no tab.
    await page.getByTestId('filter-pill-exploratory').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-testid', `${ROW_PREFIX}formation-harbor-mesh`);

    await page.getByTestId('filter-pill-all').click();
    await expect(rows).toHaveCount(3);

    // Search narrows by formation name.
    const search = page.getByTestId('my-formations-search-input').locator('input');
    await search.fill('orbit');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-testid', `${ROW_PREFIX}formation-orbit-ledger`);

    // Nothing matches: in-card "No results" with a Reset, never the page-level empty state.
    await search.fill('no such formation');
    await expect(page.getByTestId('my-formations-no-results')).toBeVisible();
    await expect(page.getByTestId('my-formations-empty-state')).toHaveCount(0);

    await page
      .getByTestId('my-formations-no-results')
      .getByRole('button', { name: /reset filters/i })
      .click();
    await expect(rows).toHaveCount(3);
  });

  test('shows the empty state when the caller has no formations', async ({ page }) => {
    await gotoMyFormations(page, { responses: [{ status: 200, body: { formations: [], items: [], state: 'complete' } }] });

    await expect(page.getByTestId('my-formations-empty-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('my-formations-empty-state')).toContainText('No formations yet');
    await expect(page.getByTestId('my-formations-card')).toHaveCount(0);
  });

  test('shows the error state when the read fails and Retry re-requests it', async ({ page }) => {
    await gotoMyFormations(page, {
      responses: [{ status: 500 }, { status: 200, body: { formations: MY_FORMATIONS_ROWS, items: [], state: 'complete' } }],
    });

    await expect(page.getByTestId('my-formations-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('my-formations-empty-state')).toHaveCount(0);

    const retried = page.waitForResponse((response) => response.url().includes('/api/user/formation-work'), { timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('my-formations-retry').click();
    await retried;

    await expect(page.locator(`[data-testid^="${ROW_PREFIX}"]`)).toHaveCount(3, { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('my-formations-error')).toHaveCount(0);
  });

  test('is absent from the sidebar and redirects to My Dashboard while formation-enabled is off', async ({ page }) => {
    await gotoMyFormations(page, { flagEnabled: false });

    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/, { timeout: DATA_LOAD_TIMEOUT });
    // Wait for the Me sidebar to render before asserting the item's absence, or an unloaded page
    // would pass vacuously.
    await expect(page.getByTestId('sidebar-item-my-dashboard')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('sidebar-my-formations')).toHaveCount(0);
    await expect(page.getByTestId('my-formations-title')).toHaveCount(0);
  });
});
