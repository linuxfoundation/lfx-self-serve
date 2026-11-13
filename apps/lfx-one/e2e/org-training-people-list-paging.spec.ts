// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * People › Trainees paging and the shared people-list tiles, with every training request stubbed (synthetic data, no
 * warehouse): the table and the "Learners not on the people list" list page independently (10/25/50 rows, "Showing X to Y
 * of N"), the page resets on search, range, filter and sort, the strip shows the people-list count and the outside tile
 * equals the outside list, and the three Overview Education tiles show the same stats and open the Training page.
 * A training request no stub answers fails the test (it would reach the BFF).
 */

import { expect, Locator, Page, test } from '@playwright/test';

import {
  DATA_LOAD_TIMEOUT,
  gotoOrgPageWithTrainees,
  type OrgTrainingApiGuard,
  SYNTHETIC_FORMER_ON_LIST,
  SYNTHETIC_OUTSIDE_LEARNER_COUNT,
  SYNTHETIC_TRAINEE_COUNT,
  syntheticTrainingStats,
} from './helpers/org-training.helper';

test.setTimeout(120_000);

const TRAINEES_URL = '/company/people?tab=training';
const TABLE_TOTAL = SYNTHETIC_TRAINEE_COUNT;
const OUTSIDE_TOTAL = SYNTHETIC_OUTSIDE_LEARNER_COUNT;
const STATS = syntheticTrainingStats();

let guard: OrgTrainingApiGuard;

async function openTrainees(page: Page, url: string = TRAINEES_URL): Promise<void> {
  guard = await gotoOrgPageWithTrainees(page, url);
  await expect(page.getByTestId('org-people-trainees-rows')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

/** The list of learners not on the people list starts collapsed; open it before using its paginator. */
async function openOutside(page: Page): Promise<void> {
  await page.getByTestId('org-people-trainees-outside-toggle').click();
  await expect(page.getByTestId('org-people-trainees-outside-toggle')).toHaveAttribute('aria-expanded', 'true');
}

const tablePaginator = (page: Page): Locator => page.getByTestId('org-people-trainees-paginator');
const outsidePaginator = (page: Page): Locator => page.getByTestId('org-people-trainees-outside-paginator');
const showing = (paginator: Locator, first: number, last: number, total: number): Promise<void> =>
  expect(paginator).toContainText(`Showing ${first} to ${last} of ${total}`);
const nextPage = (paginator: Locator): Promise<void> => paginator.getByRole('button', { name: 'Next Page' }).click();

/** Picks a rows-per-page value through the paginator's real dropdown. */
async function pickRowsPerPage(page: Page, paginator: Locator, rows: number): Promise<void> {
  await paginator.locator('p-select').click();
  await page.getByRole('option', { name: String(rows), exact: true }).click();
}

/** Picks an option of one of the filter bar's p-select dropdowns (the overlay renders in the body). */
async function pickFilter(page: Page, name: string, option: string): Promise<void> {
  await page.locator(`[data-test="org-training-filter-${name}"]`).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.afterEach(() => {
  // A training or trainees request no stub answered would have reached the BFF (and the warehouse).
  expect(guard?.unstubbedTrainingRequests ?? []).toEqual([]);
});

test.describe('People › Trainees — paging and people-list tiles', () => {
  test('the strip shows the people-list count and the outside tile equals the outside list', async ({ page }) => {
    await openTrainees(page);

    await expect(page.getByTestId('org-training-stat-people-with-training-activity-value')).toHaveText(String(STATS.peopleWithTrainingActivity));
    await expect(page.getByTestId('org-training-stat-learners-outside-people-list-value')).toHaveText(String(OUTSIDE_TOTAL));
    await expect(page.getByTestId('org-training-stat-learners-outside-people-list-label')).toHaveText('Learners not on the people list');
    await expect(page.getByTestId('org-people-trainees-outside')).toContainText(`(${OUTSIDE_TOTAL})`);
    // Cards = table people + the former employees the note explains.
    expect(STATS.peopleWithTrainingActivity).toBe(TABLE_TOTAL + SYNTHETIC_FORMER_ON_LIST.people);
    await expect(page.getByTestId('org-people-trainees-former-note')).toContainText(`${SYNTHETIC_FORMER_ON_LIST.people} former employees`);
  });

  test('the table pages with Next and a page number, and the "Showing" text follows', async ({ page }) => {
    await openTrainees(page);
    const paginator = tablePaginator(page);

    await showing(paginator, 1, 10, TABLE_TOTAL);
    await expect(page.getByTestId('org-people-trainees-rows').locator('tbody tr[role="button"]')).toHaveCount(10);

    await nextPage(paginator);
    await showing(paginator, 11, 20, TABLE_TOTAL);

    await paginator.getByRole('button', { name: 'Page 4' }).click();
    await showing(paginator, 31, 40, TABLE_TOTAL);

    await paginator.getByRole('button', { name: 'Page 6' }).click();
    await showing(paginator, 51, 60, TABLE_TOTAL);
  });

  test('the outside list pages on its own paginator, independently of the table', async ({ page }) => {
    await openTrainees(page);
    await openOutside(page);
    const table = tablePaginator(page);
    const outside = outsidePaginator(page);

    await nextPage(table);
    await showing(table, 11, 20, TABLE_TOTAL);
    await showing(outside, 1, 10, OUTSIDE_TOTAL);

    await nextPage(outside);
    await showing(outside, 11, 20, OUTSIDE_TOTAL);
    await outside.getByRole('button', { name: 'Page 3' }).click();
    await showing(outside, 21, 30, OUTSIDE_TOTAL);
    // The table did not move.
    await showing(table, 11, 20, TABLE_TOTAL);
    await expect(page.getByTestId('org-people-trainees-outside').locator('ul li')).toHaveCount(10);
  });

  test('rows per page 25 and 50 through the real dropdown, on each paginator on its own', async ({ page }) => {
    await openTrainees(page);
    await openOutside(page);
    const table = tablePaginator(page);
    const outside = outsidePaginator(page);

    await pickRowsPerPage(page, table, 25);
    await showing(table, 1, 25, TABLE_TOTAL);
    await expect(page.getByTestId('org-people-trainees-rows').locator('tbody tr[role="button"]')).toHaveCount(25);
    await showing(outside, 1, 10, OUTSIDE_TOTAL);

    await pickRowsPerPage(page, table, 50);
    await showing(table, 1, 50, TABLE_TOTAL);

    await pickRowsPerPage(page, outside, 50);
    await showing(outside, 1, 50, OUTSIDE_TOTAL);
    await nextPage(outside);
    await showing(outside, 51, OUTSIDE_TOTAL, OUTSIDE_TOTAL);
    await showing(table, 1, 50, TABLE_TOTAL);
  });

  test('the table returns to page 1 on search, a filter pick, a range change and a sort; the outside list on search and range', async ({ page }) => {
    await openTrainees(page);
    await openOutside(page);
    const table = tablePaginator(page);
    const outside = outsidePaginator(page);
    const search = page.getByPlaceholder('Search trainees...');

    // Search (table-local; also narrows the outside list by name).
    await nextPage(table);
    await nextPage(outside);
    await showing(table, 11, 20, TABLE_TOTAL);
    await showing(outside, 11, 20, OUTSIDE_TOTAL);
    // '00' matches the names 001 to 009 in each list.
    await search.fill('00');
    await showing(table, 1, 9, 9);
    await showing(outside, 1, 9, 9);
    await search.fill('');
    await showing(table, 1, 10, TABLE_TOTAL);

    // Sort (table).
    await nextPage(table);
    await showing(table, 11, 20, TABLE_TOTAL);
    await page.getByRole('columnheader', { name: /Name/ }).getByRole('button').click();
    await showing(table, 1, 10, TABLE_TOTAL);

    // A filter pick (behind More filters).
    await nextPage(table);
    await showing(table, 11, 20, TABLE_TOTAL);
    await page.getByTestId('org-training-more-filters-toggle').click();
    await pickFilter(page, 'foundation', 'CNCF');
    await expect(page).toHaveURL(/foundation=foundation-1/);
    await showing(table, 1, 10, TABLE_TOTAL);
    // A course-level filter hides the outside list (it carries no course data).
    await expect(page.getByTestId('org-people-trainees-outside-filtered-note')).toBeVisible();
    await page.getByTestId('org-training-filter-clear-all').getByRole('button').click();
    await expect(page).not.toHaveURL(/foundation=/);

    // A range change.
    await nextPage(table);
    await nextPage(outside);
    await showing(table, 11, 20, TABLE_TOTAL);
    await pickFilter(page, 'range', 'Past 90 days');
    await expect(page).toHaveURL(/range=90d/);
    await showing(table, 1, 10, TABLE_TOTAL);
    await showing(outside, 1, 10, OUTSIDE_TOTAL);
  });

  test('keeps the chosen rows per page across a reset, and expands only the rows on the current page', async ({ page }) => {
    await openTrainees(page);
    const table = tablePaginator(page);
    const rows = page.getByTestId('org-people-trainees-rows').locator('tbody tr[role="button"]');

    await pickRowsPerPage(page, table, 25);
    await showing(table, 1, 25, TABLE_TOTAL);
    await rows.first().click();
    await expect(page.getByTestId('org-people-trainees-rows').locator('[data-testid$="-detail-row"]')).toHaveCount(1);

    await nextPage(table);
    await showing(table, 26, 50, TABLE_TOTAL);
    await expect(page.getByTestId('org-people-trainees-rows').locator('[data-testid$="-detail-row"]')).toHaveCount(0);

    // 'Trainee 0' matches every name, so only the reset moves the page, and the 25 rows per page stay.
    await page.getByPlaceholder('Search trainees...').fill('Trainee 0');
    await showing(table, 1, 25, TABLE_TOTAL);
  });
});

test.describe('Org Overview — Education tiles', () => {
  const tiles = [
    {
      name: 'People with training activity',
      testId: 'org-overview-involvement-card-people-with-training-activity',
      value: String(STATS.peopleWithTrainingActivity),
    },
    { name: 'Certified people', testId: 'org-overview-involvement-card-certified-employees', value: String(STATS.certifiedPeople) },
    { name: 'Courses taken', testId: 'org-overview-involvement-card-training-enrollments', value: String(STATS.coursesTaken) },
  ];

  test('show the stubbed stats with unit, window and as-of date', async ({ page }) => {
    guard = await gotoOrgPageWithTrainees(page, '/company/overview');
    for (const tile of tiles) {
      const card = page.getByTestId(tile.testId);
      await expect(card).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      await expect(card).toContainText(tile.name);
      await expect(card).toContainText(tile.value);
      await expect(card).toContainText('Past 2 years');
      await expect(card).toContainText('as of Oct 30, 2026');
    }
  });

  for (const tile of tiles) {
    test(`${tile.name}: click and Enter open the Training page`, async ({ page }) => {
      guard = await gotoOrgPageWithTrainees(page, '/company/overview');
      const card = page.getByTestId(tile.testId);
      await expect(card).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

      await card.click();
      await expect(page).toHaveURL(/\/company\/(?:[^/]+\/)?training(?:\?.*)?$/);
      await expect(page.getByTestId('org-training-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

      await page.goBack();
      const action = page.getByTestId(`${tile.testId}-action`);
      await expect(action).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      await action.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/company\/(?:[^/]+\/)?training(?:\?.*)?$/);
    });
  }
});
