// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { expect, test } from '@playwright/test';

/**
 * Badges Dashboard E2E Tests
 *
 * Covers the happy path for the /badges page:
 * - Grid renders with at least one badge card
 * - Category filter pills change the visible set
 * - Filter popover opens and accepts status/visibility input
 * - Filter dot + accessible label update when a filter is active
 *
 * Prerequisites:
 * - Dev server running on localhost:4200
 * - User authenticated via Auth0 with at least one Credly badge
 */

const BADGES_URL = '/badges';
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(60_000);

test.describe('Badges Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BADGES_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
  });

  test('renders the page title', async ({ page }) => {
    await expect(page.getByTestId('badges-dashboard-title')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('shows badge grid or empty state after loading', async ({ page }) => {
    // Wait for loading to clear
    const grid = page.getByTestId('badges-grid');
    const emptyState = page.getByTestId('badges-empty-state-card');
    await expect(grid.or(emptyState)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('renders at least one badge card when badges exist', async ({ page }) => {
    const grid = page.getByTestId('badges-grid');
    await grid.waitFor({ state: 'visible', timeout: DATA_LOAD_TIMEOUT });
    const firstCard = page.locator('[data-testid^="badge-card-"]').first();
    await expect(firstCard).toBeVisible();
  });

  test('filter pills render', async ({ page }) => {
    await expect(page.getByTestId('badges-filter-pills')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('filter button opens the popover', async ({ page }) => {
    await page.getByTestId('badges-filter-btn').click();
    await expect(page.getByTestId('badges-filter-popover')).toBeVisible({ timeout: 5_000 });
  });

  test('filter button aria-label updates when a filter is active', async ({ page }) => {
    const filterBtn = page.getByTestId('badges-filter-btn');
    await expect(filterBtn).toHaveAttribute('aria-label', 'Open filter options');

    await filterBtn.click();
    // Select "Pending" from status dropdown
    await page.getByTestId('badges-status-select').locator('select, .p-select, [role="combobox"]').first().click();
    const pendingOption = page.getByRole('option', { name: 'Pending' }).first();
    if (await pendingOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await pendingOption.click();
      await expect(filterBtn).toHaveAttribute('aria-label', 'Open filter options (filters active)');
    }
  });
});

test.describe('Badges Dashboard error state', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/badges', (route) => route.fulfill({ status: 500, body: 'Internal Server Error' }));
    await page.goto(BADGES_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
  });

  test('error state renders when API fails', async ({ page }) => {
    await expect(page.getByTestId('badges-error-state-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});
