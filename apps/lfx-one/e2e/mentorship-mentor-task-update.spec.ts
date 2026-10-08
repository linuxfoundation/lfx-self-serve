// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor program detail — Edit a task and set its status from the Mentees and Applicants tabs
 * (linuxfoundation/lfx-mentorship#273).
 *
 * Expands a row's tasks and edits one, or sets its status from the row's select. The write goes through
 * `PATCH /api/mentorship/tasks/:taskId`, the route the admin page uses too. Each test stubs the detail read and that
 * write via `page.route` with synthetic data, recording each request so a spec asserts the body the browser sent as
 * well as what it rendered. A saved task is written into the row from the response, and the detail is then read again
 * so the progress and counts follow.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the detail read is made by the browser and the
 * stub answers it; a direct `page.goto()` would read it during SSR, where no stub runs. The module is behind the
 * `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipApplicantTask, MentorshipApplicantTaskStatus, MentorshipMentorProgramDetail } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, MENTOR_PROGRAMS_URL, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PROGRAM_ID = '91111111-1111-4111-8111-111111111111';
const DETAIL_URL = `${MENTOR_PROGRAMS_URL}/${PROGRAM_ID}`;
const DETAIL_ROUTE = `**/api/mentorship/mentor/programs/${PROGRAM_ID}`;
const MENTEE_ID = '92222222-2222-4222-8222-222222222222';
const APPLICANT_ID = '93333333-3333-4333-8333-333333333333';
const MENTEE_TASK_ID = '94444444-4444-4444-8444-444444444444';
const APPLICANT_TASK_ID = '95555555-5555-4555-8555-555555555555';
const NEW_NAME = 'Write a design doc (final)';

const task = (id: string, status: MentorshipApplicantTaskStatus): MentorshipApplicantTask => ({
  id,
  name: 'Write a design doc',
  description: 'One page on the plan.',
  status,
  prerequisite: false,
  createdOn: '2026-09-20',
  updatedOn: '2026-10-01',
});

/** One accepted mentee and one pending applicant, each with one task in `status`. */
function detailWith(status: MentorshipApplicantTaskStatus = 'pending'): MentorshipMentorProgramDetail {
  return {
    program: {
      id: PROGRAM_ID,
      slug: 'test-program-task-update',
      name: 'Test Program Task Update',
      projectName: 'Test Project',
      term: 'Test Term Fall',
      termStatus: 'active-term',
      stats: { mentees: 1, tasksToReview: 0, applicants: 1 },
    },
    tabCounts: { tasks: 0, mentees: 1, applicants: 1 },
    mentees: [
      {
        id: MENTEE_ID,
        name: 'Test Mentee One',
        email: 'test.mentee.one@example.com',
        status: 'accepted',
        termName: 'Test Term Fall',
        tasksSubmitted: 0,
        tasksTotal: 1,
        tasks: [task(MENTEE_TASK_ID, status)],
      },
    ],
    applicants: [
      {
        id: APPLICANT_ID,
        name: 'Test Applicant One',
        email: 'test.applicant.one@example.com',
        status: 'pending',
        termName: 'Test Term Fall',
        createdOn: '2026-09-01',
        updatedOn: '2026-09-02',
        tasksSubmitted: 0,
        tasksTotal: 1,
        tasks: [task(APPLICANT_TASK_ID, status)],
      },
    ],
  };
}

/** Answers the first detail read with `first` and every later one with `later`; returns how many reads were made. */
async function stubDetail(page: Page, first: MentorshipMentorProgramDetail, later: MentorshipMentorProgramDetail = first): Promise<() => number> {
  let reads = 0;
  await page.route(DETAIL_ROUTE, (route) => {
    reads += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads === 1 ? first : later) });
  });
  return () => reads;
}

/** Answers each task PATCH with `status` (the task as patched on a 200), and returns the bodies the page sent. */
async function stubTaskUpdate(page: Page, taskId: string, status = 200): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route(`**/api/mentorship/tasks/${taskId}`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Partial<MentorshipApplicantTask>;
    sent.push(body);
    if (status === 200) {
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ...task(taskId, 'pending'), ...body }) });
    }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'stubbed' }) });
  });
  return sent;
}

async function openMenteeTasks(page: Page): Promise<void> {
  await openMentorPage(page, DETAIL_URL);
  await page.getByTestId('mentorship-mentor-program-detail-tab-mentees').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  await page.getByTestId(`mentorship-mentor-mentee-view-tasks-${MENTEE_ID}`).getByRole('button').click();
  await expect(page.getByTestId(`mentorship-applicant-task-row-${MENTEE_TASK_ID}`)).toBeVisible();
}

async function pickStatus(page: Page, taskId: string, label: string): Promise<void> {
  await page.getByTestId(`mentorship-applicant-task-status-${taskId}`).getByRole('combobox').click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

test.describe('Mentor program detail — Edit task and set status', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('sets a mentee task status, keeps the row and reads the detail again', async ({ page }) => {
    const reads = await stubDetail(page, detailWith('pending'), detailWith('completed'));
    const sent = await stubTaskUpdate(page, MENTEE_TASK_ID);
    await openMenteeTasks(page);

    await pickStatus(page, MENTEE_TASK_ID, 'Completed');

    await expect.poll(() => sent).toEqual([{ status: 'completed' }]);
    await expect(page.getByTestId(`mentorship-applicant-task-status-${MENTEE_TASK_ID}`)).toContainText('Completed');
    await expect.poll(reads).toBe(2);
    await expect(page.getByText('coming soon', { exact: false })).toHaveCount(0);
  });

  test('sends only what the edit changed, confirms, and shows the new name', async ({ page }) => {
    await stubDetail(page, detailWith());
    const sent = await stubTaskUpdate(page, MENTEE_TASK_ID);
    await openMenteeTasks(page);

    await page.getByTestId(`mentorship-applicant-task-edit-${MENTEE_TASK_ID}`).getByRole('button').click();
    const dialog = page.getByTestId('mentorship-task-form-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#mentorship-task-name').fill(NEW_NAME);
    await page.getByTestId('mentorship-task-form-submit').click();

    await expect(page.getByText('Task updated')).toBeVisible();
    expect(sent).toEqual([{ name: NEW_NAME }]);
    await expect(page.getByTestId(`mentorship-applicant-task-row-${MENTEE_TASK_ID}`)).toContainText(NEW_NAME);
  });

  test('puts the select back and says why when the mentor can no longer edit tasks', async ({ page }) => {
    await stubDetail(page, detailWith());
    await stubTaskUpdate(page, MENTEE_TASK_ID, 403);
    await openMenteeTasks(page);

    await pickStatus(page, MENTEE_TASK_ID, 'In Progress');

    await expect(page.getByText('Could not update the task')).toBeVisible();
    await expect(page.getByText('You can no longer edit tasks on this program', { exact: false })).toBeVisible();
    await expect(page.getByTestId(`mentorship-applicant-task-status-${MENTEE_TASK_ID}`)).toContainText('Pending');
  });

  test("sets an applicant's task status from the Applicants tab", async ({ page }) => {
    await stubDetail(page, detailWith());
    const sent = await stubTaskUpdate(page, APPLICANT_TASK_ID);
    await openMentorPage(page, DETAIL_URL);
    await page.getByTestId('mentorship-mentor-program-detail-tab-applicants').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await page.getByTestId(`mentorship-mentor-applicant-view-tasks-${APPLICANT_ID}`).getByRole('button').click();
    await expect(page.getByTestId(`mentorship-applicant-task-row-${APPLICANT_TASK_ID}`)).toBeVisible();

    await pickStatus(page, APPLICANT_TASK_ID, 'Submitted');

    await expect.poll(() => sent).toEqual([{ status: 'submitted' }]);
    await expect(page.getByTestId(`mentorship-applicant-task-status-${APPLICANT_TASK_ID}`)).toContainText('Submitted');
  });
});
