// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor program detail Edit task and set status — structural / data-testid contract (linuxfoundation/lfx-mentorship#273).
 *
 * Companion to `mentorship-mentor-task-update.spec.ts` (content). This spec asserts what an expanded task row offers on
 * the Mentees and Applicants tabs (the status select with its four statuses, and Edit) and that Edit opens the task form
 * on the task's own values, by testid and role rather than copy. The detail read is stubbed with synthetic data and
 * reached by client-side navigation; no write is sent.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipApplicantTask, MentorshipMentorProgramDetail } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, MENTOR_PROGRAMS_URL, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PROGRAM_ID = '96666666-6666-4666-8666-666666666666';
const DETAIL_URL = `${MENTOR_PROGRAMS_URL}/${PROGRAM_ID}`;
const MENTEE_ID = '97777777-7777-4777-8777-777777777777';
const APPLICANT_ID = '98888888-8888-4888-8888-888888888888';
const MENTEE_TASK_ID = '99999999-9999-4999-8999-999999999999';
const APPLICANT_TASK_ID = '9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const task = (id: string): MentorshipApplicantTask => ({
  id,
  name: 'Write a design doc',
  description: 'One page on the plan.',
  status: 'pending',
  prerequisite: false,
  createdOn: '2026-09-20',
  updatedOn: '2026-10-01',
});

const DETAIL: MentorshipMentorProgramDetail = {
  program: {
    id: PROGRAM_ID,
    slug: 'test-program-task-structure',
    name: 'Test Program Task Structure',
    projectName: 'Test Project',
    term: 'Test Term Fall',
    termStatus: 'active-term',
    stats: { mentees: 1, tasksToReview: 0, applicants: 1 },
  },
  tabCounts: { tasks: 0, mentees: 1, applicants: 1 },
  mentees: [
    {
      id: MENTEE_ID,
      name: 'Test Mentee Two',
      email: 'test.mentee.two@example.com',
      status: 'accepted',
      termName: 'Test Term Fall',
      tasksSubmitted: 0,
      tasksTotal: 1,
      tasks: [task(MENTEE_TASK_ID)],
    },
  ],
  applicants: [
    {
      id: APPLICANT_ID,
      name: 'Test Applicant Two',
      email: 'test.applicant.two@example.com',
      status: 'pending',
      termName: 'Test Term Fall',
      createdOn: '2026-09-01',
      updatedOn: '2026-09-02',
      tasksSubmitted: 0,
      tasksTotal: 1,
      tasks: [task(APPLICANT_TASK_ID)],
    },
  ],
};

async function open(page: Page, tab: 'mentees' | 'applicants'): Promise<string> {
  await enableMentorshipFlag(page);
  await page.route(`**/api/mentorship/mentor/programs/${PROGRAM_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETAIL) })
  );
  await openMentorPage(page, DETAIL_URL);
  await page.getByTestId(`mentorship-mentor-program-detail-tab-${tab}`).click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  const [rowId, taskId, viewTasks] =
    tab === 'mentees'
      ? [MENTEE_ID, MENTEE_TASK_ID, 'mentorship-mentor-mentee-view-tasks-']
      : [APPLICANT_ID, APPLICANT_TASK_ID, 'mentorship-mentor-applicant-view-tasks-'];
  await page.getByTestId(`${viewTasks}${rowId}`).getByRole('button').click();
  await expect(page.getByTestId(`mentorship-applicant-task-row-${taskId}`)).toBeVisible();
  return taskId;
}

for (const tab of ['mentees', 'applicants'] as const) {
  test.describe(`Mentor ${tab} tab Edit task and set status — structure`, () => {
    test('offers the status select and an enabled Edit on a non-prerequisite task', async ({ page }) => {
      const taskId = await open(page, tab);

      await expect(page.getByTestId(`mentorship-applicant-task-status-${taskId}`)).toBeVisible();
      await expect(page.getByTestId(`mentorship-applicant-task-edit-${taskId}`).getByRole('button')).toBeEnabled();
    });

    test('lists the four statuses in the select', async ({ page }) => {
      const taskId = await open(page, tab);

      await page.getByTestId(`mentorship-applicant-task-status-${taskId}`).getByRole('combobox').click();

      await expect(page.getByRole('option')).toHaveCount(4);
    });

    test('opens the task form on the task, with its fields and submit', async ({ page }) => {
      const taskId = await open(page, tab);

      await page.getByTestId(`mentorship-applicant-task-edit-${taskId}`).getByRole('button').click();

      const dialog = page.getByTestId('mentorship-task-form-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('#mentorship-task-name')).toHaveValue('Write a design doc');
      await expect(dialog.locator('#mentorship-task-description')).toHaveValue('One page on the plan.');
      await expect(page.getByTestId('mentorship-task-form-submit')).toBeVisible();
    });
  });
}
