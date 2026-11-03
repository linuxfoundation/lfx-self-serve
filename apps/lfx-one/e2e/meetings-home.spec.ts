// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Me lens meetings home page (#4883), meetings-redesign flag on, synthetic feeds at a fixed clock.
 * Requires the authenticated storage state from global setup; skips without credentials.
 */
import { expect, Page, test } from '@playwright/test';

import { MEETINGS_HOME_TITLES as TITLES } from './fixtures/mock-data';
import { gotoMeetingsHome, homeRow, homeRows, homeToast, MEETINGS_HOME_TEST_OPTIONS, rightColumn } from './helpers/meetings-home.helper';

const UPCOMING_TITLES = [TITLES.oneOff, TITLES.series, TITLES.series, TITLES.other];

const rowTitles = (page: Page) => homeRows(page).getByTestId('meetings-home-row-title');
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search meetings' });
const filtersDialog = (page: Page) => page.getByRole('dialog', { name: 'Filters' });

async function applyMeetingTypeFilter(page: Page, type: string): Promise<void> {
  await page.getByTestId('meetings-home-filters-button').click();
  await expect(filtersDialog(page)).toBeVisible();
  await filtersDialog(page).getByRole('combobox', { name: 'Meeting type' }).click();
  await page.getByRole('option', { name: type, exact: true }).click();
  await page.getByTestId('meetings-home-filters-apply').click();
  await expect(filtersDialog(page)).toBeHidden();
}

test.describe('Meetings home page', () => {
  test.use(MEETINGS_HOME_TEST_OPTIONS);
  test.setTimeout(90_000);

  test.describe('Page render', () => {
    test('shows the header, tab counts, day groups, rows and both cards', async ({ page }) => {
      await gotoMeetingsHome(page);

      await expect(page.getByRole('heading', { level: 1, name: 'Meetings' })).toBeVisible();
      await expect(page.getByTestId('meetings-home-pending-rsvps-count')).toHaveText('3');
      await expect(page.getByRole('tab', { name: 'Upcoming, 5 meetings' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { name: 'Past, 2 meetings' })).toHaveAttribute('aria-selected', 'false');

      await expect(page.getByTestId('meetings-home-day-group-label')).toHaveText(['Tomorrow', 'This week', 'This month', 'December']);
      await expect(rowTitles(page)).toHaveText(UPCOMING_TITLES);
      // The Next card's meeting is left out of the list.
      await expect(homeRow(page, TITLES.next)).toHaveCount(0);

      const rail = rightColumn(page);
      await expect(rail.getByTestId('meetings-home-next-card-title')).toHaveText(TITLES.next);
      await expect(rail.getByTestId('meetings-home-next-card-starts-in')).toHaveText('Meeting starts in 6 h');
      await expect(rail.getByTestId('meetings-home-last-card-title')).toHaveText(TITLES.pastRecent);
    });

    test('?time=past opens the Past tab, and Upcoming drops the param', async ({ page }) => {
      await gotoMeetingsHome(page, { query: '?time=past' });

      await expect(page.getByRole('tab', { name: 'Past, 2 meetings' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('meetings-home-day-group-label')).toHaveText(['Yesterday', 'October']);
      await expect(rowTitles(page)).toHaveText([TITLES.pastRecent, TITLES.pastOlder]);

      await page.getByRole('tab', { name: /^Upcoming/ }).click();
      await expect(rowTitles(page)).toHaveText(UPCOMING_TITLES);
      await expect(page).not.toHaveURL(/time=past/);
    });
  });

  test.describe('Search and filters', () => {
    test('search narrows rows by title and committee, and no results offers Reset filters', async ({ page }) => {
      await gotoMeetingsHome(page);

      await search(page).fill('budget');
      await expect(rowTitles(page)).toHaveText([TITLES.oneOff]);
      await search(page).fill('governing');
      await expect(rowTitles(page)).toHaveText([TITLES.oneOff]);

      await search(page).fill('zzz-no-such-meeting');
      const noResults = page.getByTestId('meetings-home-no-results');
      await expect(noResults).toContainText('No results found');
      await page.getByTestId('meetings-home-no-results-reset').click();
      await expect(search(page)).toHaveValue('');
      await expect(rowTitles(page)).toHaveText(UPCOMING_TITLES);
    });

    test('Apply sets a filter chip, removing the chip clears it, and Reset Filters clears all', async ({ page }) => {
      await gotoMeetingsHome(page);

      await applyMeetingTypeFilter(page, 'Technical');
      await expect(page.getByTestId('meetings-home-filters-count')).toHaveText('1');
      await expect(page.getByTestId('meetings-home-filters-chips')).toContainText('Meeting type: Technical');
      await expect(rowTitles(page)).toHaveText([TITLES.series, TITLES.series]);

      await page.getByRole('button', { name: 'Remove Meeting type: Technical' }).click();
      await expect(page.getByTestId('meetings-home-filters-chips')).toHaveCount(0);
      await expect(rowTitles(page)).toHaveText(UPCOMING_TITLES);

      await applyMeetingTypeFilter(page, 'Marketing');
      await expect(rowTitles(page)).toHaveText([TITLES.other]);
      await page.getByTestId('meetings-home-filters-button').click();
      await page.getByTestId('meetings-home-filters-reset').click();
      await expect(filtersDialog(page)).toBeHidden();
      await expect(page.getByTestId('meetings-home-filters-count')).toHaveCount(0);
      await expect(rowTitles(page)).toHaveText(UPCOMING_TITLES);
    });

    test('switching tabs clears the filters', async ({ page }) => {
      await gotoMeetingsHome(page);

      await applyMeetingTypeFilter(page, 'Technical');
      await expect(page.getByTestId('meetings-home-filters-chips')).toBeVisible();

      await page.getByRole('tab', { name: /^Past/ }).click();
      await expect(page.getByTestId('meetings-home-filters-chips')).toHaveCount(0);
      await page.getByRole('tab', { name: /^Upcoming/ }).click();
      await expect(page.getByTestId('meetings-home-filters-count')).toHaveCount(0);
      await expect(rowTitles(page)).toHaveText(UPCOMING_TITLES);
    });
  });

  test.describe('Row actions', () => {
    test('RSVP on a one-off row saves the answer and shows the answered chip', async ({ page }) => {
      const mocks = await gotoMeetingsHome(page);
      const row = homeRow(page, TITLES.oneOff);

      await row.getByTestId('meetings-home-rsvp-accepted').click();
      await expect(homeToast(page, 'Response saved: Going')).toBeVisible();
      await expect(row.getByTestId('meetings-home-rsvp-status')).toContainText('Going');
      expect(mocks.rsvpPosts).toEqual([expect.objectContaining({ response: 'accepted', scope: 'all' })]);
      await expect(page.getByTestId('meetings-home-pending-rsvps-count')).toHaveText('2');
    });

    test('RSVP on a recurring row asks for the scope with three options', async ({ page }) => {
      const mocks = await gotoMeetingsHome(page);
      const row = homeRow(page, TITLES.series).first();

      await row.getByTestId('meetings-home-rsvp-accepted').click();
      const dialog = page.getByRole('dialog', { name: 'RSVP to recurring meeting' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('radio')).toHaveCount(3);
      await expect(dialog.getByRole('radio', { name: 'This occurrence' })).toBeChecked();
      await expect(dialog.getByRole('radio', { name: 'This and following occurrences' })).toBeVisible();
      await expect(dialog.getByRole('radio', { name: 'All occurrences' })).toBeVisible();

      await dialog.getByTestId('meetings-home-rsvp-scope-cancel').click();
      await expect(dialog).toBeHidden();
      expect(mocks.rsvpPosts).toEqual([]);
      await expect(row.getByTestId('meetings-home-rsvp-accepted')).toBeVisible();
    });

    test('row menu Copy Link shows the copied toast', async ({ page }) => {
      await gotoMeetingsHome(page);

      await homeRow(page, TITLES.oneOff).getByTestId('meetings-home-row-actions-trigger').click();
      await page.getByRole('menuitem', { name: 'Copy Link' }).click();
      await expect(homeToast(page, 'Meeting Link Copied')).toBeVisible();
    });
  });

  test.describe('Empty states', () => {
    test('no upcoming meetings shows the empty state without Create for a non-writer', async ({ page }) => {
      await gotoMeetingsHome(page, { emptyUpcoming: true });

      await expect(page.getByTestId('meetings-home-empty-upcoming')).toContainText('No upcoming meetings');
      await expect(rightColumn(page).getByTestId('meetings-home-next-card-empty')).toContainText('Your calendar is clear');
      await expect(search(page)).toHaveCount(0);
      await expect(page.getByTestId('meetings-home-empty-create')).toHaveCount(0);
      await expect(page.getByTestId('meetings-home-create')).toHaveCount(0);
    });

    test('no upcoming meetings offers Create Meeting to a meeting writer', async ({ page }) => {
      await gotoMeetingsHome(page, { emptyUpcoming: true, canWrite: true });

      await expect(page.getByTestId('meetings-home-empty-upcoming')).toBeVisible();
      await expect(page.getByTestId('meetings-home-empty-create')).toContainText('Create Meeting');
      await expect(page.getByTestId('meetings-home-create')).toBeVisible();
    });
  });
});
