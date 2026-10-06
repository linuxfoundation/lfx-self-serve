// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Current Mentees — Create task (linuxfoundation/lfx-mentorship#237).
 *
 * Gives one accepted mentee a task from the row's actions menu. The reads are stubbed as in
 * `mentorship-admin-program-tabs.spec.ts`; the create is stubbed here via `page.route`, recording each request so a
 * spec asserts the body the browser sent as well as what it rendered. All data is synthetic.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the browser makes the calls and the stubs
 * answer them. The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import {
  ADMIN_PROGRAM_URL,
  AdminProgramRequests,
  adminApplicationId,
  stubAdminMentees,
  stubAdminProgramPage,
  stubAdminTasks,
} from './helpers/mentorship-admin-program.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

/** An accepted row (every third synthetic application is accepted). */
const ACCEPTED_ID = adminApplicationId(3);
const OTHER_ACCEPTED_ID = adminApplicationId(6);

const TASK_NAME = 'Write a design doc';
const TASK_DESCRIPTION = 'One page on the plan.';

async function open(page: Page, requests: AdminProgramRequests, created: unknown[], createStatus = 200): Promise<void> {
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, requests);
  await stubAdminTasks(page, requests);
  await page.route('**/api/mentorship/admin/tasks', (route) => {
    created.push(route.request().postDataJSON());
    if (createStatus === 200)
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created: [ACCEPTED_ID], failed: [] }) });
    return route.fulfill({ status: createStatus, contentType: 'application/json', body: JSON.stringify({ error: 'stubbed' }) });
  });
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

async function pickCreateTask(page: Page, id: string): Promise<void> {
  await page.getByTestId(`mentorship-current-mentee-actions-${id}`).click();
  await page.getByRole('menuitem', { name: 'Create task', exact: true }).click();
}

/** Fills the open task dialog and submits it. */
async function submitTask(page: Page): Promise<void> {
  const dialog = page.getByTestId('mentorship-task-form-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#mentorship-task-name').fill(TASK_NAME);
  await dialog.locator('#mentorship-task-description').fill(TASK_DESCRIPTION);
  await page.getByTestId('mentorship-task-form-submit').click();
}

test.describe('Admin Current Mentees — Create task', () => {
  let requests: AdminProgramRequests;
  let created: unknown[];

  test.beforeEach(() => {
    requests = { mentees: [], tasks: [] };
    created = [];
  });

  test('creates the task for the one application, then reloads the page of rows', async ({ page }) => {
    await open(page, requests, created);
    const readsBefore = requests.mentees.length;

    await pickCreateTask(page, ACCEPTED_ID);
    await submitTask(page);

    await expect(page.getByText('Task created')).toBeVisible();
    expect(created).toEqual([{ applicationIds: [ACCEPTED_ID], name: TASK_NAME, description: TASK_DESCRIPTION, requiresFileSubmission: false }]);
    await expect.poll(() => requests.mentees.length).toBeGreaterThan(readsBefore);
  });

  test('reads no tasks after creating one for a collapsed row', async ({ page }) => {
    await open(page, requests, created);

    await pickCreateTask(page, ACCEPTED_ID);
    await submitTask(page);

    await expect(page.getByText('Task created')).toBeVisible();
    expect(requests.tasks).toHaveLength(0);
  });

  test('keeps an expanded row expanded and reads its tasks once more after the create', async ({ page }) => {
    await open(page, requests, created);
    await page.getByTestId(`mentorship-current-mentee-view-tasks-${ACCEPTED_ID}`).getByRole('button').click();
    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${ACCEPTED_ID}`)).toBeVisible();
    expect(requests.tasks).toEqual([ACCEPTED_ID]);

    await pickCreateTask(page, ACCEPTED_ID);
    await submitTask(page);

    await expect(page.getByText('Task created')).toBeVisible();
    await expect.poll(() => requests.tasks).toEqual([ACCEPTED_ID, ACCEPTED_ID]);
    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${ACCEPTED_ID}`)).toBeVisible();
  });

  test('does not read the tasks of another expanded row after the create', async ({ page }) => {
    await open(page, requests, created);
    await page.getByTestId(`mentorship-current-mentee-view-tasks-${OTHER_ACCEPTED_ID}`).getByRole('button').click();
    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${OTHER_ACCEPTED_ID}`)).toBeVisible();

    await pickCreateTask(page, ACCEPTED_ID);
    await submitTask(page);

    await expect(page.getByText('Task created')).toBeVisible();
    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${OTHER_ACCEPTED_ID}`)).toHaveCount(0);
    expect(requests.tasks).toEqual([OTHER_ACCEPTED_ID]);
  });

  test('shows the failure and does not reload when the create fails', async ({ page }) => {
    await open(page, requests, created, 502);
    const readsBefore = requests.mentees.length;

    await pickCreateTask(page, ACCEPTED_ID);
    await submitTask(page);

    await expect(page.getByText('Could not create the task')).toBeVisible();
    expect(requests.mentees).toHaveLength(readsBefore);
  });

  test('tells the admin the application can no longer be given tasks when the create is a 400', async ({ page }) => {
    await open(page, requests, created, 400);

    await pickCreateTask(page, ACCEPTED_ID);
    await submitTask(page);

    await expect(page.getByText('Could not create the task')).toBeVisible();
    await expect(page.getByText('can no longer be given tasks', { exact: false })).toBeVisible();
  });
});
