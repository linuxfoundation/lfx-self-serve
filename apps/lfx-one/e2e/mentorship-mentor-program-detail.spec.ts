// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor program detail — header, tab counts, tab rows, empty, not-found and error states
 * (linuxfoundation/lfx-mentorship#212).
 *
 * The page reads `/api/mentorship/mentor/programs/:programId`, which the BFF builds from the applications
 * and tasks of all the program's terms, each row carrying its own application's term. Each test stubs that read via `page.route` with a synthetic payload,
 * so the suite never depends on the signed-in user's real programs: one populated payload proves the
 * header, the tab counts and each tab's rows (including the linked other applications), an empty
 * one drives the tabs' empty messages, a 404 drives the not-found state and a 503 drives the error
 * state and its Retry.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the detail read is made by the
 * browser and the stub answers it; a direct `page.goto()` would read it during SSR, where no stub runs.
 * The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_PROGRAM_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipMentorProgramDetail } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, MENTOR_PROGRAMS_URL, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PROGRAM_ID = '51111111-1111-4111-8111-111111111111';
const DETAIL_URL = `${MENTOR_PROGRAMS_URL}/${PROGRAM_ID}`;
const DETAIL_ROUTE = `**/api/mentorship/mentor/programs/${PROGRAM_ID}`;
const ACCEPTED_ID = '52222222-2222-4222-8222-222222222222';
const GRADUATED_ID = '53333333-3333-4333-8333-333333333333';
const PENDING_ID = '54444444-4444-4444-8444-444444444444';
const SUBMITTED_TASK_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_PROGRAM_ID = '57777777-7777-4777-8777-777777777777';

const PROGRAM: MentorshipMentorProgramDetail['program'] = {
  id: PROGRAM_ID,
  slug: 'test-program-alpha',
  name: 'Test Program Alpha',
  projectName: 'Test Project',
  status: 'open',
  stats: { mentees: 2, tasksToReview: 1, applicants: 3 },
};

const ACCEPTED_MENTEE: MentorshipMentorProgramDetail['mentees'][number] = {
  id: ACCEPTED_ID,
  name: 'Test Mentee One',
  email: 'test.mentee.one@example.com',
  status: 'accepted',
  termName: 'Test Term Fall',
  tasksSubmitted: 1,
  tasksTotal: 2,
  tasks: [
    {
      id: SUBMITTED_TASK_ID,
      name: 'Test Task Submitted',
      description: 'A synthetic task waiting on review.',
      status: 'submitted',
      prerequisite: false,
      createdOn: '2026-09-01',
      updatedOn: '2026-09-10T10:00:00.000Z',
    },
    {
      id: '56666666-6666-4666-8666-666666666666',
      name: 'Test Task Pending',
      description: 'A synthetic task not yet submitted.',
      status: 'pending',
      prerequisite: false,
      createdOn: '2026-09-01',
      updatedOn: '2026-09-01',
    },
  ],
};

const GRADUATED_MENTEE: MentorshipMentorProgramDetail['mentees'][number] = {
  id: GRADUATED_ID,
  name: 'Test Mentee Two',
  email: 'test.mentee.two@example.com',
  status: 'graduated',
  termName: 'Test Term Fall',
  tasksSubmitted: 0,
  tasksTotal: 0,
  tasks: [],
};

const POPULATED: MentorshipMentorProgramDetail = {
  program: PROGRAM,
  tabCounts: { tasks: 1, mentees: 2, applicants: 3 },
  mentees: [ACCEPTED_MENTEE, GRADUATED_MENTEE],
  applicants: [
    { ...ACCEPTED_MENTEE, createdOn: '2026-08-01', updatedOn: '2026-08-15' },
    { ...GRADUATED_MENTEE, createdOn: '2026-08-02', updatedOn: '2026-08-16' },
    {
      id: PENDING_ID,
      name: 'Test Applicant Three',
      email: 'test.applicant.three@example.com',
      status: 'pending',
      termName: 'Test Term Winter',
      createdOn: '2026-08-03',
      updatedOn: '2026-08-17',
      otherApplications: [
        { programId: OTHER_PROGRAM_ID, programName: 'Test Program Other', status: 'pending' },
        { programName: 'Test Program Declined', status: 'declined' },
      ],
    },
  ],
};

const EMPTY: MentorshipMentorProgramDetail = {
  program: { ...PROGRAM, stats: { mentees: 0, tasksToReview: 0, applicants: 0 } },
  tabCounts: { tasks: 0, mentees: 0, applicants: 0 },
  mentees: [],
  applicants: [],
};

/** Answers the detail read with `body`, or with `status` and a plain-text body when it is not 200. */
async function stubDetail(page: Page, body: MentorshipMentorProgramDetail, status = 200): Promise<void> {
  await page.route(DETAIL_ROUTE, (route) =>
    status === 200
      ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      : route.fulfill({ status, contentType: 'text/plain', body: 'Upstream error' })
  );
}

test.describe('Mentor program detail — loaded', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubDetail(page, POPULATED);
    await openMentorPage(page, DETAIL_URL);
  });

  test('shows the program header and each tab with its count', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentor-program-detail-title')).toHaveText('Test Program Alpha', { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-program-detail-season')).toHaveText('Test Project');
    await expect(page.getByTestId('mentorship-mentor-program-detail-status')).toHaveText(MENTORSHIP_PROGRAM_STATUS_LABELS.open);

    await expect(page.getByTestId('mentorship-mentor-program-detail-tab-tasks')).toHaveText(/Tasks\s*1/);
    await expect(page.getByTestId('mentorship-mentor-program-detail-tab-mentees')).toHaveText(/Mentees\s*2/);
    await expect(page.getByTestId('mentorship-mentor-program-detail-tab-applicants')).toHaveText(/Applicants\s*3/);
  });

  test('opens on Tasks with the submitted task waiting on review', async ({ page }) => {
    const card = page.getByTestId(`mentorship-mentor-task-card-${ACCEPTED_ID}__${SUBMITTED_TASK_ID}`);
    await expect(card).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(card).toContainText('Test Mentee One');
    await expect(card).toContainText('Test Task Submitted');
    await expect(page.locator('[data-testid^="mentorship-mentor-task-card-"]')).toHaveCount(1);
  });

  test('lists the accepted and graduated mentees on Mentees', async ({ page }) => {
    await page.getByTestId('mentorship-mentor-program-detail-tab-mentees').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId(`mentorship-mentor-mentee-row-${ACCEPTED_ID}`)).toContainText('Test Mentee One');
    await expect(page.getByTestId(`mentorship-mentor-mentee-row-${GRADUATED_ID}`)).toContainText('Test Mentee Two');
    await expect(page.getByTestId(`mentorship-mentor-mentee-row-${PENDING_ID}`)).toHaveCount(0);
  });

  test('shows the pending applicant with their other active applications linked to the mentorship site', async ({ page }) => {
    await page.getByTestId('mentorship-mentor-program-detail-tab-applicants').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    const row = page.getByTestId(`mentorship-mentor-applicant-row-${PENDING_ID}`);
    await expect(row).toContainText('Test Applicant Three');
    await expect(page.locator('[data-testid^="mentorship-mentor-applicant-row-"]')).toHaveCount(1);

    const other = row.getByTestId('mentorship-mentor-applicant-other-application');
    await expect(other).toHaveCount(1);
    await expect(other).toContainText('Test Program Other');
    await expect(other).toContainText('Applied');
    const link = other.getByTestId('mentorship-mentor-applicant-other-application-link');
    await expect(link).toHaveText('Test Program Other');
    await expect(link).toHaveAttribute('href', new RegExp(`/programs/${OTHER_PROGRAM_ID}$`));
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(row).not.toContainText('Test Program Declined');
  });

  test('shows every applicant on the All pill', async ({ page }) => {
    await page.getByTestId('mentorship-mentor-program-detail-tab-applicants').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await page.getByTestId('mentorship-mentor-applicants-status-pill-all').click();

    await expect(page.locator('[data-testid^="mentorship-mentor-applicant-row-"]')).toHaveCount(3);
  });
});

test.describe('Mentor program detail — empty program', () => {
  test('shows each tab empty with a zero count', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubDetail(page, EMPTY);
    await openMentorPage(page, DETAIL_URL);

    await expect(page.getByTestId('mentorship-mentor-tasks-empty')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-program-detail-tab-tasks')).toHaveText(/Tasks\s*0/);

    await page.getByTestId('mentorship-mentor-program-detail-tab-mentees').click();
    await expect(page.getByTestId('mentorship-mentor-mentees-empty')).toHaveText('No current mentees.');

    await page.getByTestId('mentorship-mentor-program-detail-tab-applicants').click();
    await expect(page.getByTestId('mentorship-mentor-applicants-empty')).toHaveText('No applicants.');
  });
});

test.describe('Mentor program detail — not found', () => {
  test('shows the not-found state when the program is not one the caller mentors', async ({ page }) => {
    await enableMentorshipFlag(page);
    await page.route(DETAIL_ROUTE, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) }));
    await openMentorPage(page, DETAIL_URL);

    const notFound = page.getByTestId('mentorship-mentor-program-detail-not-found');
    await expect(notFound).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(notFound).toContainText('Program not found');
    await expect(page.getByTestId('mentorship-mentor-program-detail-header')).toHaveCount(0);
  });
});

test.describe('Mentor program detail — error state', () => {
  test('shows the error state and loads the program on Retry', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubDetail(page, POPULATED, 503);
    await openMentorPage(page, DETAIL_URL);

    const error = page.getByTestId('mentorship-mentor-program-detail-error-state');
    await expect(error).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(error).toContainText('Could not load this program');

    await page.unroute(DETAIL_ROUTE);
    await stubDetail(page, POPULATED);
    await error.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByTestId('mentorship-mentor-program-detail-title')).toHaveText('Test Program Alpha', { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(error).toHaveCount(0);
  });
});
