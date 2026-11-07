// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Me lens meetings home page (#4883), meetings-redesign flag on, synthetic feeds at a fixed clock.
 * Requires the authenticated storage state from global setup; skips without credentials.
 */
import { expect, Locator, Page, test } from '@playwright/test';

import { MEETINGS_HOME_JOIN_URL, MEETINGS_HOME_RECORDING_URL, MEETINGS_HOME_SUMMARY_TEXT, MEETINGS_HOME_TITLES as TITLES } from './fixtures/mock-data';
import { gotoMeetingsHome, homeRow, homeRows, homeToast, MEETINGS_HOME_TEST_OPTIONS, rightColumn } from './helpers/meetings-home.helper';
import { stubMeetingsV2Flag } from './helpers/meetings-v2-flag.helper';

const UPCOMING_TITLES = [TITLES.next, TITLES.oneOff, TITLES.series, TITLES.series, TITLES.other];

const rowTitles = (page: Page) => homeRows(page).getByTestId('meetings-home-row-title');
const search = (page: Page) => page.getByRole('searchbox', { name: 'Search meetings' });
const filtersDialog = (page: Page) => page.getByRole('dialog', { name: 'Filters' });

/** The series row for one date, by its day of the month. */
function seriesRowOn(page: Page, day: string): Locator {
  return homeRow(page, TITLES.series).filter({ has: page.getByTestId('meetings-home-row-date-day').getByText(day, { exact: true }) });
}

async function openRowAction(page: Page, row: Locator, action: string): Promise<void> {
  await row.getByTestId('meetings-home-row-actions-trigger').click();
  await page.getByRole('menuitem', { name: action }).click();
}

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

      await expect(page.getByTestId('meetings-home-day-group-label')).toHaveText(['Today', 'Tomorrow', 'This week', 'This month', 'December']);
      // The Next card's meeting stays in the list, so the tab count matches the rows.
      await expect(rowTitles(page)).toHaveText(UPCOMING_TITLES);

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
      await expect(noResults).toContainText('No meetings match your search');
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
      await expect(homeToast(page, 'Meeting RSVP set to “Going”')).toBeVisible();
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
      await expect(homeToast(page, 'Meeting link copied to clipboard')).toBeVisible();
    });
  });

  test.describe('Empty states', () => {
    test('no upcoming meetings shows the empty state, with Create Meeting only in the header', async ({ page }) => {
      await gotoMeetingsHome(page, { emptyUpcoming: true });

      const empty = page.getByTestId('meetings-home-empty-upcoming');
      await expect(empty).toContainText('No upcoming meetings');
      await expect(empty.getByRole('button')).toHaveCount(0);
      await expect(rightColumn(page).getByTestId('meetings-home-next-card-empty')).toContainText('Your calendar is clear');
      await expect(search(page)).toHaveCount(0);
      await expect(page.getByTestId('meetings-home-create')).toContainText('Create Meeting');
    });

    test('Create Meeting opens the target picker, which says so when the viewer can create nowhere', async ({ page }) => {
      await page.route('**/api/create-picker/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [], committees: [] }) })
      );
      await gotoMeetingsHome(page);

      await page.getByTestId('meetings-home-create').click();
      await expect(page.getByTestId('create-target-empty-state')).toHaveText('Nothing here yet — try searching for a project or group.');
    });
  });

  test.describe('Organizer actions', () => {
    test('Edit on a one-off meeting opens the editor without asking for a scope', async ({ page }) => {
      await stubMeetingsV2Flag(page, true);
      await gotoMeetingsHome(page, { organizer: true });

      await openRowAction(page, homeRow(page, TITLES.oneOff), 'Edit Meeting');
      const header = page.getByTestId('meeting-composer-header');
      await expect(header).toContainText('Edit meeting');
      await expect(header).toContainText(TITLES.oneOff);
      await expect(page.getByTestId('meetings-home-edit-scope-modal')).toHaveCount(0);
    });

    test('Edit on a recurring row asks for the scope, then edits the picked occurrence', async ({ page }) => {
      await stubMeetingsV2Flag(page, true);
      await gotoMeetingsHome(page, { organizer: true });

      await openRowAction(page, seriesRowOn(page, '13'), 'Edit Meeting');
      const dialog = page.getByRole('dialog', { name: 'Edit meeting' });
      await expect(dialog.getByRole('radio', { name: 'A single occurrence' })).toBeChecked();
      await expect(dialog.getByRole('radio', { name: 'The entire series' })).not.toBeChecked();

      await dialog.getByRole('button', { name: 'Continue' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId('meeting-composer-header')).toContainText('Edit meeting');
      await expect(page.getByTestId('meeting-composer-scope-occurrence')).toContainText('Nov 13');
    });

    test('Delete on a one-off meeting confirms, deletes it and drops the row', async ({ page }) => {
      const mocks = await gotoMeetingsHome(page, { organizer: true });

      await openRowAction(page, homeRow(page, TITLES.oneOff), 'Delete Meeting');
      const dialog = page.getByRole('alertdialog', { name: 'Delete meeting' });
      await expect(dialog).toContainText(TITLES.oneOff);
      await expect(dialog).toContainText('This will permanently delete this meeting.');

      // The stub feed still lists the meeting, so the row must stay gone after the refetch.
      const refetch = page.waitForResponse('**/api/user/meetings*');
      await dialog.getByRole('button', { name: 'Delete Meeting' }).click();
      await expect(homeToast(page, 'Meeting deleted')).toBeVisible();
      await refetch;
      await expect(homeRow(page, TITLES.oneOff)).toHaveCount(0);
      expect(mocks.deletes).toEqual(['home-e2e-one-off']);
    });

    test('a failed delete keeps the dialog open with an error and the row in place', async ({ page }) => {
      await gotoMeetingsHome(page, { organizer: true });
      await page.route(/\/api\/meetings\/home-e2e-one-off(\?|$)/, (route) =>
        route.request().method() === 'DELETE' ? route.fulfill({ status: 500 }) : route.fallback()
      );

      await openRowAction(page, homeRow(page, TITLES.oneOff), 'Delete Meeting');
      const dialog = page.getByRole('alertdialog', { name: 'Delete meeting' });
      await dialog.getByRole('button', { name: 'Delete Meeting' }).click();

      await expect(homeToast(page, 'Server error occurred. Please try again later.')).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(homeRow(page, TITLES.oneOff)).toHaveCount(1);
    });

    test('Delete on a recurring row cancels the picked occurrence with a reason', async ({ page }) => {
      const mocks = await gotoMeetingsHome(page, { organizer: true });

      await openRowAction(page, seriesRowOn(page, '13'), 'Delete Meeting');
      const scope = page.getByRole('dialog', { name: 'Delete meeting' });
      await expect(scope.getByRole('radio', { name: 'Cancel a single occurrence' })).toBeChecked();
      await scope.getByRole('button', { name: 'Continue' }).click();

      const confirm = page.getByRole('alertdialog', { name: 'Cancel Occurrence' });
      await confirm.getByRole('textbox', { name: 'Reason (optional)' }).fill('Team offsite');
      const refetch = page.waitForResponse('**/api/user/meetings*');
      await confirm.getByRole('button', { name: 'Cancel Occurrence' }).click();

      await expect(homeToast(page, 'Meeting occurrence cancelled')).toBeVisible();
      await refetch;
      await expect(seriesRowOn(page, '13')).toHaveCount(0);
      await expect(seriesRowOn(page, '6')).toHaveCount(1);
      expect(mocks.cancellations).toEqual([
        { meetingId: 'home-e2e-series', occurrenceId: String(Date.parse('2026-11-13T17:00:00Z') / 1000), body: { note: 'Team offsite' } },
      ]);
      expect(mocks.deletes).toEqual([]);
    });

    test('Remove Myself asks in an alertdialog, then drops the row and its pending RSVP', async ({ page }) => {
      const mocks = await gotoMeetingsHome(page);

      await openRowAction(page, homeRow(page, TITLES.oneOff), 'Remove Myself');
      const dialog = page.getByRole('alertdialog', { name: 'Remove Yourself' });
      await expect(dialog).toContainText(`Remove yourself from “${TITLES.oneOff}”?`);
      await dialog.getByRole('button', { name: 'Remove Me' }).click();

      await expect(homeToast(page, 'Removed from meeting')).toBeVisible();
      await expect(homeRow(page, TITLES.oneOff)).toHaveCount(0);
      await expect(page.getByTestId('meetings-home-pending-rsvps-count')).toHaveText('2');
      expect(mocks.selfRemovals).toEqual(['home-e2e-one-off']);
    });
  });

  test.describe('Pending RSVPs', () => {
    test('answering from the drawer drops each date until the drawer closes and the button hides', async ({ page }) => {
      const mocks = await gotoMeetingsHome(page);

      await page.getByTestId('meetings-home-pending-rsvps-button').click();
      const drawer = page.getByRole('dialog', { name: 'Pending RSVPs' });
      const rows = drawer.getByTestId('meetings-home-pending-rsvps-row');
      await expect(rows).toHaveCount(3);
      await expect(drawer.getByTestId('ui-drawer-subtitle')).toHaveText('3 waiting for a response');

      await rows.filter({ hasText: TITLES.oneOff }).getByTestId('meetings-home-rsvp-accepted').click();
      await expect(rows).toHaveCount(2);
      await expect(page.getByTestId('meetings-home-pending-rsvps-count')).toHaveText('2');
      await expect(drawer.getByTestId('ui-drawer-subtitle')).toHaveText('2 waiting for a response');

      await rows.filter({ hasText: 'Nov 6' }).getByTestId('meetings-home-rsvp-declined').click();
      const scope = page.getByRole('dialog', { name: 'RSVP to recurring meeting' });
      await scope.getByRole('radio', { name: 'All occurrences' }).check();
      await scope.getByTestId('meetings-home-rsvp-scope-ok').click();

      await expect(drawer).toHaveCount(0);
      await expect(page.getByTestId('meetings-home-pending-rsvps-button')).toHaveCount(0);
      expect(mocks.rsvpPosts).toEqual([
        expect.objectContaining({ response: 'accepted', scope: 'all' }),
        expect.objectContaining({ response: 'declined', scope: 'all' }),
      ]);
    });
  });

  test.describe('Recording and AI Summary', () => {
    test('the Last meeting card opens the recording in a new tab, copies its link and opens the summary dialog', async ({ page }) => {
      await page.context().route('https://zoom.example.test/**', (route) => route.fulfill({ body: '' }));
      await gotoMeetingsHome(page);
      const rail = rightColumn(page);
      const recording = rail.getByTestId('meetings-home-last-card-recording');

      const popup = page.waitForEvent('popup');
      await recording.getByRole('button', { name: 'Recording', exact: true }).click();
      expect((await popup).url()).toContain(MEETINGS_HOME_RECORDING_URL);
      await recording.getByRole('button', { name: 'Copy recording link' }).click();
      await expect(homeToast(page, 'Recording link copied to clipboard')).toBeVisible();

      await rail.getByTestId('meetings-home-last-card-summary').click();
      const summary = page.getByRole('dialog', { name: 'AI Summary' });
      await expect(summary).toContainText(MEETINGS_HOME_SUMMARY_TEXT);
    });

    test('a past row offers Recording and AI Summary only when it has them', async ({ page }) => {
      // The split button needs a centre column wider than 900px.
      await page.setViewportSize({ width: 1920, height: 900 });
      await gotoMeetingsHome(page, { query: '?time=past' });

      await expect(homeRow(page, TITLES.pastOlder)).toBeVisible();
      await expect(homeRow(page, TITLES.pastOlder).getByTestId('meetings-home-row-artifacts')).toHaveCount(0);
      const row = homeRow(page, TITLES.pastRecent);

      await page.context().route('https://zoom.example.test/**', (route) => route.fulfill({ body: '' }));
      const popup = page.waitForEvent('popup');
      await row.getByRole('button', { name: 'Recording', exact: true }).click();
      expect((await popup).url()).toContain(MEETINGS_HOME_RECORDING_URL);
      await row.getByRole('button', { name: 'Copy recording link' }).click();
      await expect(homeToast(page, 'Recording link copied to clipboard')).toBeVisible();

      await row.getByRole('button', { name: 'AI Summary', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'AI Summary' })).toContainText(MEETINGS_HOME_SUMMARY_TEXT);
    });
  });

  test.describe('Join', () => {
    test('a row inside its join window offers Join, which opens the meeting link', async ({ page }) => {
      await page.context().route('https://zoom.example.test/**', (route) => route.fulfill({ body: '' }));
      await gotoMeetingsHome(page, { joinWindow: true });

      await expect(homeRow(page, TITLES.oneOff)).toBeVisible();
      await expect(homeRow(page, TITLES.oneOff).getByTestId('meetings-home-row-join')).toHaveCount(0);
      const popup = page.waitForEvent('popup');
      await homeRow(page, TITLES.ended)
        .getByRole('button', { name: `Join ${TITLES.ended}` })
        .click();
      expect((await popup).url()).toContain(MEETINGS_HOME_JOIN_URL);
    });
  });

  test.describe('Foundation filter', () => {
    test('a foundation narrows the projects, clears one outside it, and filters the rows', async ({ page }) => {
      await gotoMeetingsHome(page, { foundations: true, personas: ['contributor', 'board-member'] });

      await page.getByTestId('meetings-home-filters-button').click();
      const panel = filtersDialog(page);
      const foundation = panel.getByRole('combobox', { name: 'Foundation' });
      const project = panel.getByRole('combobox', { name: 'Project' });

      await project.click();
      await page.getByRole('option', { name: 'Beta Project', exact: true }).click();
      await foundation.click();
      await expect(page.getByRole('option')).toHaveText(['All foundations', 'Alpha Foundation', 'Omega Foundation']);
      await page.getByRole('option', { name: 'Omega Foundation', exact: true }).click();
      // Omega has no child projects, so the drafted Beta Project is cleared and Project hides.
      await expect(project).toHaveCount(0);

      await foundation.click();
      await page.getByRole('option', { name: 'Alpha Foundation', exact: true }).click();
      await expect(project).toHaveText(/All projects/);
      await project.click();
      await expect(page.getByRole('option')).toHaveText(['All projects', 'Beta Project']);
      await page.keyboard.press('Escape');

      await panel.getByTestId('meetings-home-filters-apply').click();
      await expect(page.getByTestId('meetings-home-filters-chips')).toContainText('Foundation: Alpha Foundation');
      await expect(rowTitles(page)).toHaveText([TITLES.next, TITLES.oneOff, TITLES.other]);
    });
  });

  test.describe('Paging', () => {
    test('a list longer than one page loads the rest on scroll', async ({ page }) => {
      await gotoMeetingsHome(page, { extraCount: 20 });

      await expect(homeRows(page)).toHaveCount(20);

      await homeRows(page).last().scrollIntoViewIfNeeded();
      await expect(homeRows(page)).toHaveCount(25);
      await expect(page.getByRole('tab', { name: 'Upcoming, 25 meetings' })).toBeVisible();
    });
  });
});
