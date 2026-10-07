// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin program detail — the live page and the server-paged Current Mentees tab (linuxfoundation/lfx-mentorship#233).
 *
 * The page makes three kinds of read, each stubbed here via `page.route` with synthetic data:
 *   - `GET /api/mentorship/admin/programs/:id` — the header, the four tab counts and the term options
 *   - `GET /api/mentorship/admin/programs/:id/mentees` — one page of 37 synthetic applications
 *   - `GET /api/mentorship/admin/applications/:id/tasks` — one application's tasks, read on View Tasks only
 * The stubs record what the page asked for, so the paging, filter and View Tasks specs assert the query the
 * browser sent as well as what it rendered. The Past Mentees tab reads the same mentees route with `type=past`;
 * the Mentors and Terms tabs read `GET .../mentors` and `GET .../terms` (linuxfoundation/lfx-mentorship#234).
 * Every admin tab is live and read-only for now, so no tab shows mock data.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the reads are made by the browser and
 * the stubs answer them; a direct `page.goto()` would read the page during SSR, where no stub runs.
 * The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import {
  ADMIN_MENTEES_TOTAL,
  ADMIN_MENTORS,
  ADMIN_OPEN_TERM_ID,
  ADMIN_OPEN_TERM_NAME,
  ADMIN_PAST_APPLICATIONS,
  ADMIN_PROGRAM_PAGE,
  ADMIN_PROGRAM_URL,
  ADMIN_TERMS,
  AdminProgramRequests,
  adminApplicationId,
  stubAdminMentees,
  stubAdminMentors,
  stubAdminProgramPage,
  stubAdminProgramPageError,
  stubAdminTasks,
  stubAdminTerms,
} from './helpers/mentorship-admin-program.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const FIRST_ID = adminApplicationId(1);
const SECOND_ID = adminApplicationId(2);
const PAGE_ONE_LABEL = `Showing 1 to 10 of ${ADMIN_MENTEES_TOTAL}`;
const PAGE_TWO_LABEL = `Showing 11 to 20 of ${ADMIN_MENTEES_TOTAL}`;

/** The offsets the mentees stub answered, in order. */
const offsets = (requests: AdminProgramRequests): string[] => requests.mentees.map((params) => params.get('offset') ?? '');

async function open(page: Page, requests: AdminProgramRequests): Promise<void> {
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, requests);
  await stubAdminTasks(page, requests);
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

/** Opens one of a tab's filter selects and returns the option labels it lists. */
async function selectOptions(page: Page, dataTest: string): Promise<string[]> {
  await page.locator(`[data-test="${dataTest}"]`).click();
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();
  const labels = (await options.allTextContents()).map((label) => label.trim());
  await page.keyboard.press('Escape');
  // Wait for the overlay to go, so the next select's options are not read alongside these.
  await expect(options).toHaveCount(0);
  return labels;
}

async function chooseOption(page: Page, dataTest: string, label: string): Promise<void> {
  await page.locator(`[data-test="${dataTest}"]`).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function clickViewTasks(page: Page, id: string): Promise<void> {
  await page.getByTestId(`mentorship-current-mentee-view-tasks-${id}`).getByRole('button').click();
}

test.describe('Admin program detail — header and tabs', () => {
  let requests: AdminProgramRequests;

  test.beforeEach(async ({ page }) => {
    requests = { mentees: [], tasks: [] };
    await open(page, requests);
  });

  test('shows the program title and the four tabs, each with its count', async ({ page }) => {
    await expect(page.getByTestId('mentorship-program-detail-title')).toHaveText('Test Program Admin', { timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-program-detail-tab-current-mentees')).toHaveText(new RegExp(`Current Mentees\\s*${ADMIN_MENTEES_TOTAL}`));
    await expect(page.getByTestId('mentorship-program-detail-tab-past-mentees')).toHaveText(/Past Mentees\s*4/);
    await expect(page.getByTestId('mentorship-program-detail-tab-mentors')).toHaveText(/Mentors\s*0/);
    await expect(page.getByTestId('mentorship-program-detail-tab-terms')).toHaveText(/Terms\s*2/);
  });

  test('opens on Current Mentees with the first page of rows, splitting pending into Applied and Tasks Completed', async ({ page }) => {
    await expect(page.locator('[data-testid^="mentorship-current-mentee-row-"]')).toHaveCount(10);
    await expect(page.getByTestId(`mentorship-current-mentee-row-${FIRST_ID}`)).toContainText('Test Applicant 01');
    await expect(page.getByTestId(`mentorship-current-mentee-row-${FIRST_ID}`)).toContainText('Applied');
    await expect(page.getByTestId(`mentorship-current-mentee-row-${adminApplicationId(3)}`)).toContainText('Accepted');
  });

  test('offers the row actions that fit each status', async ({ page }) => {
    const pendingActions = page.getByTestId(`mentorship-current-mentee-actions-${FIRST_ID}`);
    await pendingActions.click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByRole('menuitem')).toHaveText(['Accept', 'Decline', 'Withdraw']);
    // The trigger toggles its popup, so a second click closes it before the next row's opens.
    await pendingActions.click();
    await expect(page.getByRole('menuitem')).toHaveCount(0);

    await page.getByTestId(`mentorship-current-mentee-actions-${adminApplicationId(3)}`).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Create task', 'Graduate', 'Decline', 'Withdraw']);
  });

  test('names the statuses the table shows in the status filter, and lists only the open terms', async ({ page }) => {
    expect(await selectOptions(page, 'mentorship-current-mentees-status')).toEqual([
      'All statuses',
      'Applied',
      'Tasks Completed',
      'Accepted',
      'Declined',
      'Withdrawn',
      'Graduated',
    ]);
    expect(await selectOptions(page, 'mentorship-current-mentees-term')).toEqual(['All open terms', ADMIN_OPEN_TERM_NAME]);
  });

  test('opens Past Mentees from its tab', async ({ page }) => {
    await page.getByTestId('mentorship-program-detail-tab-past-mentees').click();

    await expect(page.getByTestId('mentorship-past-mentees-tab')).toBeVisible();
    await expect(page.getByTestId('mentorship-current-mentees-tab')).toHaveCount(0);
  });
});

test.describe('Admin program detail — paging, filters and search', () => {
  let requests: AdminProgramRequests;

  test.beforeEach(async ({ page }) => {
    requests = { mentees: [], tasks: [] };
    await open(page, requests);
  });

  test('reports the page range and the total', async ({ page }) => {
    await expect(page.getByText(PAGE_ONE_LABEL)).toBeVisible();
    expect(offsets(requests)).toEqual(['0']);
    expect(requests.mentees[0].get('type')).toBe('current');
    expect(requests.mentees[0].get('limit')).toBe('10');
  });

  test('asks for the next page by offset', async ({ page }) => {
    await page.getByRole('button', { name: 'Next Page' }).click();

    await expect(page.getByText(PAGE_TWO_LABEL)).toBeVisible();
    expect(offsets(requests)).toEqual(['0', '10']);
    await expect(page.getByTestId(`mentorship-current-mentee-row-${adminApplicationId(11)}`)).toBeVisible();
  });

  test('sends Applied as status=applied and returns to the first page', async ({ page }) => {
    await page.getByRole('button', { name: 'Next Page' }).click();
    await expect(page.getByText(PAGE_TWO_LABEL)).toBeVisible();

    await chooseOption(page, 'mentorship-current-mentees-status', 'Applied');

    await expect(page.getByTestId(`mentorship-current-mentee-row-${FIRST_ID}`)).toBeVisible();
    const last = requests.mentees[requests.mentees.length - 1];
    expect(last.get('status')).toBe('applied');
    expect(last.get('offset')).toBe('0');
    await expect(page.getByTestId(`mentorship-current-mentee-row-${adminApplicationId(3)}`)).toHaveCount(0);
  });

  test('sends the chosen term as termId', async ({ page }) => {
    await chooseOption(page, 'mentorship-current-mentees-term', ADMIN_OPEN_TERM_NAME);

    await expect.poll(() => requests.mentees[requests.mentees.length - 1].get('termId')).toBe(ADMIN_OPEN_TERM_ID);
  });

  test('sends the search once typing pauses', async ({ page }) => {
    await page.locator('[data-test="mentorship-current-mentees-search"]').fill('Applicant 02');

    await expect.poll(() => requests.mentees[requests.mentees.length - 1].get('search')).toBe('Applicant 02');
    await expect(page.getByTestId(`mentorship-current-mentee-row-${SECOND_ID}`)).toBeVisible();
    await expect(page.locator('[data-testid^="mentorship-current-mentee-row-"]')).toHaveCount(1);
  });
});

test.describe('Admin program detail — View Tasks', () => {
  let requests: AdminProgramRequests;

  test.beforeEach(async ({ page }) => {
    requests = { mentees: [], tasks: [] };
    await open(page, requests);
  });

  test('reads no tasks until View Tasks is clicked, then exactly once', async ({ page }) => {
    await expect(page.getByTestId(`mentorship-current-mentee-row-${FIRST_ID}`)).toBeVisible();
    expect(requests.tasks).toEqual([]);

    await clickViewTasks(page, FIRST_ID);

    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${FIRST_ID}`)).toContainText('Test Resume Task');
    expect(requests.tasks).toEqual([FIRST_ID]);
  });

  test('collapses and re-expands without a new request', async ({ page }) => {
    await clickViewTasks(page, FIRST_ID);
    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${FIRST_ID}`)).toBeVisible();

    await clickViewTasks(page, FIRST_ID);
    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${FIRST_ID}`)).toHaveCount(0);
    await clickViewTasks(page, FIRST_ID);
    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${FIRST_ID}`)).toContainText('Test Resume Task');

    expect(requests.tasks).toEqual([FIRST_ID]);
  });

  test('collapses the row after a page change, and reads again on the next expand', async ({ page }) => {
    await clickViewTasks(page, FIRST_ID);
    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${FIRST_ID}`)).toBeVisible();

    await page.getByRole('button', { name: 'Next Page' }).click();
    await expect(page.getByText(PAGE_TWO_LABEL)).toBeVisible();
    await page.getByRole('button', { name: 'Previous Page' }).click();
    await expect(page.getByText(PAGE_ONE_LABEL)).toBeVisible();

    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${FIRST_ID}`)).toHaveCount(0);
    await clickViewTasks(page, FIRST_ID);
    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${FIRST_ID}`)).toContainText('Test Resume Task');

    expect(requests.tasks).toEqual([FIRST_ID, FIRST_ID]);
  });

  test('shows an inline error with Retry when the tasks read fails', async ({ page }) => {
    let failing = true;
    await page.unroute('**/api/mentorship/admin/applications/*/tasks');
    await stubAdminTasks(page, requests, () => (failing ? 500 : undefined));

    await clickViewTasks(page, FIRST_ID);
    await expect(page.getByTestId('mentorship-admin-current-mentees-tasks-load-error')).toBeVisible();

    failing = false;
    await page.getByTestId(`mentorship-admin-current-mentees-tasks-retry-${FIRST_ID}`).getByRole('button').click();

    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${FIRST_ID}`)).toContainText('Test Resume Task');
    expect(requests.tasks).toEqual([FIRST_ID, FIRST_ID]);
  });
});

test.describe('Admin program detail — failures', () => {
  test('shows the mentees error with Retry, and the rows after Retry succeeds', async ({ page }) => {
    const requests: AdminProgramRequests = { mentees: [], tasks: [] };
    await enableMentorshipFlag(page);
    await stubAdminProgramPage(page);
    await stubAdminMentees(page, requests, 500);
    await openMentorPage(page, ADMIN_PROGRAM_URL);

    await expect(page.getByTestId('mentorship-admin-current-mentees-load-error')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await page.unroute(`**/api/mentorship/admin/programs/${ADMIN_PROGRAM_PAGE.program.id}/mentees*`);
    await stubAdminMentees(page, requests);
    await page.getByTestId('mentorship-admin-current-mentees-retry').getByRole('button').click();

    await expect(page.getByTestId(`mentorship-current-mentee-row-${FIRST_ID}`)).toBeVisible();
    await expect(page.getByTestId('mentorship-admin-current-mentees-load-error')).toHaveCount(0);
  });

  test('shows a dash for a count that could not be read', async ({ page }) => {
    const requests: AdminProgramRequests = { mentees: [], tasks: [] };
    await enableMentorshipFlag(page);
    await stubAdminProgramPage(page, { ...ADMIN_PROGRAM_PAGE, tabCounts: { currentMentees: null, pastMentees: 4, mentors: null, terms: 2 } });
    await stubAdminMentees(page, requests);
    await openMentorPage(page, ADMIN_PROGRAM_URL);

    await expect(page.getByTestId('mentorship-program-detail-tab-current-mentees')).toHaveText(/Current Mentees\s*–/, { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-program-detail-tab-mentors')).toHaveText(/Mentors\s*–/);
    await expect(page.getByTestId('mentorship-program-detail-tab-past-mentees')).toHaveText(/Past Mentees\s*4/);
  });

  test('shows the no-access message for a 403', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubAdminProgramPageError(page, 403);
    await openMentorPage(page, ADMIN_PROGRAM_URL);

    await expect(page.getByTestId('mentorship-admin-program-no-access')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-admin-program-not-found')).toHaveCount(0);
  });

  test('shows the not-found message for a 404', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubAdminProgramPageError(page, 404);
    await openMentorPage(page, ADMIN_PROGRAM_URL);

    await expect(page.getByTestId('mentorship-admin-program-not-found')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-admin-program-no-access')).toHaveCount(0);
  });
});

test.describe('Admin program detail — live Past Mentees, Mentors and Terms tabs', () => {
  let requests: AdminProgramRequests;
  let mentorRequests: URLSearchParams[];
  let termRequests: URLSearchParams[];

  test.beforeEach(async ({ page }) => {
    requests = { mentees: [], tasks: [] };
    mentorRequests = [];
    termRequests = [];
    await stubAdminMentors(page, mentorRequests);
    await stubAdminTerms(page, termRequests);
    await open(page, requests);
  });

  test('Past Mentees reads the closed-term applications and lists them read-only', async ({ page }) => {
    await page.getByTestId('mentorship-program-detail-tab-past-mentees').click();

    await expect(page.locator('[data-testid^="mentorship-past-mentee-row-"]')).toHaveCount(ADMIN_PAST_APPLICATIONS.length);
    await expect(page.getByTestId(`mentorship-past-mentee-row-${ADMIN_PAST_APPLICATIONS[0].id}`)).toContainText('Test Graduate One');
    await expect(page.getByTestId(`mentorship-past-mentee-row-${ADMIN_PAST_APPLICATIONS[0].id}`)).toContainText('Test Term Closed');
    expect(requests.mentees.some((params) => params.get('type') === 'past')).toBe(true);
  });

  test('Past Mentees narrows by status, sending it upstream', async ({ page }) => {
    await page.getByTestId('mentorship-program-detail-tab-past-mentees').click();
    await expect(page.locator('[data-testid^="mentorship-past-mentee-row-"]')).toHaveCount(ADMIN_PAST_APPLICATIONS.length);

    await chooseOption(page, 'mentorship-past-mentees-status', 'Declined');

    await expect(page.locator('[data-testid^="mentorship-past-mentee-row-"]')).toHaveCount(1);
    expect(requests.mentees[requests.mentees.length - 1].get('status')).toBe('declined');
  });

  test('Mentors lists the program mentors and sends the status filter upstream', async ({ page }) => {
    await page.getByTestId('mentorship-program-detail-tab-mentors').click();

    await expect(page.locator('[data-testid^="mentorship-mentor-row-"]')).toHaveCount(ADMIN_MENTORS.length);
    await expect(page.getByTestId(`mentorship-mentor-row-${ADMIN_MENTORS[0].id}`)).toContainText('Test Mentor Active');
    await expect(page.getByTestId(`mentorship-mentor-row-${ADMIN_MENTORS[0].id}`)).toContainText('Yes');

    await chooseOption(page, 'mentorship-mentors-status', 'Declined');

    await expect(page.locator('[data-testid^="mentorship-mentor-row-"]')).toHaveCount(1);
    expect(mentorRequests[mentorRequests.length - 1].get('status')).toBe('declined');
  });

  test('Terms lists every term with its status in one read', async ({ page }) => {
    await page.getByTestId('mentorship-program-detail-tab-terms').click();

    await expect(page.locator('[data-testid^="mentorship-term-row-"]')).toHaveCount(ADMIN_TERMS.length);
    await expect(page.getByTestId(`mentorship-term-row-${ADMIN_TERMS[0].id}`)).toContainText(ADMIN_OPEN_TERM_NAME);
    await expect(page.getByTestId(`mentorship-term-row-${ADMIN_TERMS[1].id}`)).toContainText('Closed');
    expect(termRequests).toHaveLength(1);
    expect(termRequests[0].get('limit')).toBe('50');
  });
});

test.describe('Admin program detail — failed tab reads', () => {
  test('Mentors and Terms each show their own error with Retry, and recover on Retry', async ({ page }) => {
    const mentorRequests: URLSearchParams[] = [];
    const termRequests: URLSearchParams[] = [];
    await stubAdminMentors(page, mentorRequests, 500);
    await stubAdminTerms(page, termRequests, 500);
    await open(page, { mentees: [], tasks: [] });

    await page.getByTestId('mentorship-program-detail-tab-mentors').click();
    await expect(page.getByTestId('mentorship-admin-mentors-load-error')).toBeVisible();
    await page.unroute(`**/api/mentorship/admin/programs/${ADMIN_PROGRAM_PAGE.program.id}/mentors*`);
    await stubAdminMentors(page, mentorRequests);
    await page.getByTestId('mentorship-admin-mentors-retry').getByRole('button').click();
    await expect(page.getByTestId(`mentorship-mentor-row-${ADMIN_MENTORS[0].id}`)).toBeVisible();

    await page.getByTestId('mentorship-program-detail-tab-terms').click();
    await expect(page.getByTestId('mentorship-admin-terms-load-error')).toBeVisible();
    await page.unroute(`**/api/mentorship/admin/programs/${ADMIN_PROGRAM_PAGE.program.id}/terms*`);
    await stubAdminTerms(page, termRequests);
    await page.getByTestId('mentorship-admin-terms-retry').getByRole('button').click();
    await expect(page.getByTestId(`mentorship-term-row-${ADMIN_TERMS[0].id}`)).toBeVisible();
  });
});

test.describe('Admin program detail — empty mentees', () => {
  test('shows Current Mentees empty with a zero count, and Past Mentees empty', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubAdminProgramPage(page, { ...ADMIN_PROGRAM_PAGE, tabCounts: { currentMentees: 0, pastMentees: 0, mentors: 0, terms: 2 } });
    await page.route(`**/api/mentorship/admin/programs/${ADMIN_PROGRAM_PAGE.program.id}/mentees*`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) })
    );
    await openMentorPage(page, ADMIN_PROGRAM_URL);

    await expect(page.getByTestId('mentorship-program-detail-tab-current-mentees')).toHaveText(/Current Mentees\s*0/, { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-current-mentees-empty')).toHaveText('No current mentees.');

    await page.getByTestId('mentorship-program-detail-tab-past-mentees').click();
    await expect(page.getByTestId('mentorship-past-mentees-empty')).toHaveText('No past mentees.');
  });
});
