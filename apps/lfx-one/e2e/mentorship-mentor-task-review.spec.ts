// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor task review — approve, request changes and a task no longer awaiting review on the program detail
 * page (linuxfoundation/lfx-mentorship#215).
 *
 * The Tasks tab reviews a submitted task through `PATCH /api/mentorship/mentor/tasks/:taskId/review`, then
 * re-reads the detail so the task moves out of Awaiting Review. Each test stubs the detail read and that
 * write via `page.route` with synthetic data, so the suite never reviews a task on a real program.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the detail read is made by the
 * browser and the stub answers it; a direct `page.goto()` would read it during SSR, where no stub runs.
 * The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipApplicantTaskStatus, MentorshipMentorProgramDetail } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, MENTOR_PROGRAMS_URL, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PROGRAM_ID = '81111111-1111-4111-8111-111111111111';
const DETAIL_URL = `${MENTOR_PROGRAMS_URL}/${PROGRAM_ID}`;
const DETAIL_ROUTE = `**/api/mentorship/mentor/programs/${PROGRAM_ID}`;
const MENTEE_ID = '82222222-2222-4222-8222-222222222222';
const TASK_ID = '83333333-3333-4333-8333-333333333333';
const REVIEW_ROUTE = `**/api/mentorship/mentor/tasks/${TASK_ID}/review`;
const ROW_ID = `${MENTEE_ID}__${TASK_ID}`;

/** One accepted mentee with one task in `status`. */
function detailWith(status: MentorshipApplicantTaskStatus): MentorshipMentorProgramDetail {
  const awaiting = status === 'submitted' ? 1 : 0;
  return {
    program: {
      id: PROGRAM_ID,
      slug: 'test-program-review',
      name: 'Test Program Review',
      projectName: 'Test Project',
      status: 'open',
      stats: { mentees: 1, tasksToReview: awaiting, applicants: 0 },
    },
    tabCounts: { tasks: awaiting, mentees: 1, applicants: 0 },
    mentees: [
      {
        id: MENTEE_ID,
        name: 'Test Mentee One',
        email: 'test.mentee.one@example.com',
        status: 'accepted',
        termName: 'Test Term Fall',
        tasksSubmitted: awaiting,
        tasksTotal: 1,
        tasks: [
          {
            id: TASK_ID,
            name: 'Write a design doc',
            description: 'One page on the plan.',
            status,
            prerequisite: false,
            createdOn: '2026-09-20',
            updatedOn: '2026-10-01',
          },
        ],
      },
    ],
    applicants: [],
  };
}

/** Answers the first detail read with `first` and every later one with `later`. */
async function stubDetail(page: Page, first: MentorshipMentorProgramDetail, later: MentorshipMentorProgramDetail = first): Promise<void> {
  let reads = 0;
  await page.route(DETAIL_ROUTE, (route) => {
    reads += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads === 1 ? first : later) });
  });
}

/** Answers the review with `status` (and `body` when it is not a 204), and returns the bodies the page sent. */
async function stubReview(page: Page, status: number, body?: { error: string; code?: string }): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route(REVIEW_ROUTE, (route) => {
    sent.push({ method: route.request().method(), body: route.request().postDataJSON() });
    if (status === 204) return route.fulfill({ status });
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return sent;
}

async function openTasksTab(page: Page): Promise<void> {
  await openMentorPage(page, DETAIL_URL);
  await expect(page.getByTestId(`mentorship-mentor-task-card-${ROW_ID}`)).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

test.describe('Mentor task review', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('approves a submitted task and moves it to Approved', async ({ page }) => {
    await stubDetail(page, detailWith('submitted'), detailWith('completed'));
    const sent = await stubReview(page, 204);
    await openTasksTab(page);

    await page.getByTestId(`mentorship-mentor-task-approve-${ROW_ID}`).click();

    await expect(page.getByText('Task approved')).toBeVisible();
    expect(sent).toEqual([{ method: 'PATCH', body: { status: 'complete' } }]);
    await expect(page.getByTestId(`mentorship-mentor-task-card-${ROW_ID}`)).toHaveCount(0);
    await page.getByTestId('mentorship-mentor-tasks-status-pill-completed').click();
    await expect(page.getByTestId(`mentorship-mentor-task-card-${ROW_ID}`)).toBeVisible();
  });

  test('requests changes on a submitted task, with no comment', async ({ page }) => {
    await stubDetail(page, detailWith('submitted'), detailWith('pending'));
    const sent = await stubReview(page, 204);
    await openTasksTab(page);

    await page.getByTestId(`mentorship-mentor-task-request-changes-${ROW_ID}`).click();

    await expect(page.getByText('Changes requested')).toBeVisible();
    expect(sent).toEqual([{ method: 'PATCH', body: { status: 'incomplete' } }]);
    await expect(page.getByTestId(`mentorship-mentor-task-card-${ROW_ID}`)).toHaveCount(0);
  });

  test('explains a task no longer awaiting review, and re-reads the list', async ({ page }) => {
    await stubDetail(page, detailWith('submitted'), detailWith('completed'));
    await stubReview(page, 409, { error: 'This task is no longer awaiting review.', code: 'TASK_NOT_SUBMITTED' });
    await openTasksTab(page);

    await page.getByTestId(`mentorship-mentor-task-approve-${ROW_ID}`).click();

    await expect(page.getByText('Could not review the task')).toBeVisible();
    await expect(page.getByText('This task is no longer awaiting review.')).toBeVisible();
    await expect(page.getByTestId(`mentorship-mentor-task-card-${ROW_ID}`)).toHaveCount(0);
  });
});
