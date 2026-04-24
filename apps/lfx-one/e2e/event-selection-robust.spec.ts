// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, test } from '@playwright/test';

const EMPTY_EVENTS_RESPONSE = { data: [], total: 0, pageSize: 10, offset: 0 };
const EMPTY_COUNTRIES_RESPONSE = { data: [] };

/**
 * Register a route handler that mocks all /api/events* calls deterministically.
 *
 * @param probeTotal  Total returned by the pageSize=1 registered-events probe (default 0 = no
 *                    registered events). Set >0 to simulate a user who is registered.
 * @param mainStatus  HTTP status for the primary events query (default 200 = success with empty
 *                    list). Set to 500 to trigger the error empty-state branch.
 */
async function mockEventRoutes(page: Page, { probeTotal = 0, mainStatus = 200 }: { probeTotal?: number; mainStatus?: number } = {}) {
  await page.route('**/api/events**', (route) => {
    const url = route.request().url();

    if (url.includes('/countries')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_COUNTRIES_RESPONSE) });
    }
    if (url.includes('/visa-requests') || url.includes('/travel-fund-requests') || url.includes('/organizations') || url.includes('/all')) {
      return route.fulfill({ status: mainStatus !== 200 ? mainStatus : 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    }

    // Distinguish the pageSize=1 probe from the main paginated query via URL params.
    const parsedUrl = new URL(url);
    const isProbe = parsedUrl.searchParams.get('pageSize') === '1';

    if (isProbe) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], total: probeTotal, pageSize: 1, offset: 0 }),
      });
    }

    if (mainStatus !== 200) {
      return route.fulfill({ status: mainStatus, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_EVENTS_RESPONSE) });
  });
}

/**
 * Navigate to /me/events, switch to the given tab, open the application dialog, and wait
 * for the event-selection grid to be visible.
 */
async function openDialogWithEmptyEvents(
  page: Page,
  tab: 'visa-letters' | 'travel-funding' = 'visa-letters',
  routeOptions: { probeTotal?: number; mainStatus?: number } = {}
) {
  await mockEventRoutes(page, routeOptions);
  await page.goto('/me/events', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.getByTestId(`filter-pill-${tab}`).click();
  await page.getByTestId('events-new-request-button').click();
  await expect(page.getByTestId('event-selection-grid')).toBeVisible({ timeout: 10000 });
}

test.describe('Event Selection — Robust Structural Tests', () => {
  test.describe('Container structure', () => {
    test('event-selection root container exists with correct testid', async ({ page }) => {
      await openDialogWithEmptyEvents(page);
      await expect(page.getByTestId('event-selection')).toBeAttached();
    });

    test('filter bar renders all three filter controls', async ({ page }) => {
      await openDialogWithEmptyEvents(page);
      await expect(page.getByTestId('event-selection-filters')).toBeAttached();
      await expect(page.getByTestId('event-selection-search')).toBeAttached();
      await expect(page.getByTestId('event-selection-time-filter')).toBeAttached();
      await expect(page.getByTestId('event-selection-location-filter')).toBeAttached();
    });

    test('events grid container is always rendered', async ({ page }) => {
      await openDialogWithEmptyEvents(page);
      await expect(page.getByTestId('event-selection-grid')).toBeAttached();
    });
  });

  test.describe('Empty state — no registered events (probe returns 0)', () => {
    test('empty state container has correct testid', async ({ page }) => {
      await openDialogWithEmptyEvents(page);
      await expect(page.getByTestId('event-selection-empty-state')).toBeAttached();
    });

    test('empty state title is a non-empty <p> tag', async ({ page }) => {
      await openDialogWithEmptyEvents(page);
      const title = page.getByTestId('event-selection-empty-title');
      await expect(title).toHaveCount(1);
      await expect(title).not.toBeEmpty();
      expect(await title.evaluate((el) => el.tagName.toLowerCase())).toBe('p');
    });

    test('empty state description is a non-empty <p> tag', async ({ page }) => {
      await openDialogWithEmptyEvents(page);
      const desc = page.getByTestId('event-selection-empty-description');
      await expect(desc).toHaveCount(1);
      await expect(desc).not.toBeEmpty();
      expect(await desc.evaluate((el) => el.tagName.toLowerCase())).toBe('p');
    });

    test('empty state icon element is present', async ({ page }) => {
      await openDialogWithEmptyEvents(page);
      await expect(page.getByTestId('event-selection-empty-icon')).toBeAttached();
    });

    test('visa dialog shows "No registered events" title', async ({ page }) => {
      await openDialogWithEmptyEvents(page);
      await expect(page.getByTestId('event-selection-empty-title')).toHaveText('No registered events');
    });

    test('visa dialog description mentions visa letter', async ({ page }) => {
      await openDialogWithEmptyEvents(page);
      await expect(page.getByTestId('event-selection-empty-description')).toContainText('visa letter');
    });

    test('travel-funding dialog shows "No registered events" title', async ({ page }) => {
      await openDialogWithEmptyEvents(page, 'travel-funding');
      await expect(page.getByTestId('event-selection-empty-title')).toHaveText('No registered events');
    });

    test('travel-funding dialog description mentions travel funding', async ({ page }) => {
      await openDialogWithEmptyEvents(page, 'travel-funding');
      await expect(page.getByTestId('event-selection-empty-description')).toContainText('travel funding');
    });

    test('event grid cards are not rendered when empty', async ({ page }) => {
      await openDialogWithEmptyEvents(page);
      await expect(page.getByTestId('event-selection-grid').locator('[data-testid^="event-selection-card-"]')).toHaveCount(0);
    });

    test('load-more button is not rendered when empty', async ({ page }) => {
      await openDialogWithEmptyEvents(page);
      await expect(page.getByTestId('event-selection-load-more')).not.toBeAttached();
    });
  });

  test.describe('Empty state — initial load error', () => {
    test('shows "Unable to load events" title when API returns 500', async ({ page }) => {
      await openDialogWithEmptyEvents(page, 'visa-letters', { mainStatus: 500 });
      await expect(page.getByTestId('event-selection-empty-title')).toHaveText('Unable to load events');
    });

    test('error description prompts the user to try again', async ({ page }) => {
      await openDialogWithEmptyEvents(page, 'visa-letters', { mainStatus: 500 });
      await expect(page.getByTestId('event-selection-empty-description')).toContainText('try again');
    });
  });

  test.describe('Empty state — request type not available (has registered events, no matching events)', () => {
    test('visa dialog shows "Visa letters not available" when registered events exist but none match', async ({ page }) => {
      // probeTotal > 0 means user has registered events, but the main query (filtered by
      // isVisaRequestAccepted=true) returns empty — so no events support visa letters.
      await openDialogWithEmptyEvents(page, 'visa-letters', { probeTotal: 3 });
      await expect(page.getByTestId('event-selection-empty-title')).toHaveText('Visa letters not available');
    });

    test('travel-funding dialog shows "Travel funding not available" when registered events exist but none match', async ({ page }) => {
      await openDialogWithEmptyEvents(page, 'travel-funding', { probeTotal: 3 });
      await expect(page.getByTestId('event-selection-empty-title')).toHaveText('Travel funding not available');
    });
  });

  test.describe('Empty state — active filters hiding results', () => {
    test('shows "No events match your filters" when search narrows results to zero', async ({ page }) => {
      // probeTotal > 0: user has registered events. Main query returns empty with any filters.
      // Typing in the search box activates hasActiveFilters(), triggering the filter branch.
      await openDialogWithEmptyEvents(page, 'visa-letters', { probeTotal: 3 });

      await page.getByTestId('event-selection-search').locator('input').fill('xyznonexistent');
      // Wait for the 500ms debounce to fire and the component to re-evaluate
      await page.waitForTimeout(600);

      await expect(page.getByTestId('event-selection-empty-title')).toHaveText('No events match your filters');
    });

    test('"No events match your filters" description prompts to clear filters', async ({ page }) => {
      await openDialogWithEmptyEvents(page, 'visa-letters', { probeTotal: 3 });
      await page.getByTestId('event-selection-search').locator('input').fill('xyznonexistent');
      await page.waitForTimeout(600);
      await expect(page.getByTestId('event-selection-empty-description')).toContainText('filters');
    });
  });
});
