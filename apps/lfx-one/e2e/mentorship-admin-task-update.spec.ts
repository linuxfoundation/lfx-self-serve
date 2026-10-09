// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Current Mentees — Edit a task and set its status (linuxfoundation/lfx-mentorship#240).
 *
 * Expands an accepted mentee's tasks and edits one, or sets its status from the row's select. The reads are stubbed as
 * in `mentorship-admin-program-tabs.spec.ts`; the PATCH is stubbed here via `page.route`, recording each request so a
 * spec asserts the body the browser sent as well as what it rendered. A saved task is written into the row from the
 * response, so no spec expects the tasks or the page of rows to be read again. All data is synthetic.
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
  ADMIN_TASKS,
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

/** The one synthetic task every row answers with: non-prerequisite and Submitted, so it carries Edit. */
const TASK = ADMIN_TASKS[0];
const NEW_NAME = 'Test Resume Task (final)';

const STATUS_SELECT = `mentorship-applicant-task-status-${TASK.id}`;
const EDIT_BUTTON = `mentorship-applicant-task-edit-${TASK.id}`;

async function open(page: Page, requests: AdminProgramRequests, patches: unknown[], patchStatus = 200): Promise<void> {
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, requests);
  await stubAdminTasks(page, requests);
  await page.route(`**/api/mentorship/tasks/${TASK.id}`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    patches.push(body);
    if (patchStatus === 200) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...TASK, ...body }) });
    }
    return route.fulfill({ status: patchStatus, contentType: 'application/json', body: JSON.stringify({ error: 'stubbed' }) });
  });
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  await page.getByTestId(`mentorship-current-mentee-view-tasks-${ACCEPTED_ID}`).getByRole('button').click();
  await expect(page.getByTestId(`mentorship-applicant-task-row-${TASK.id}`)).toBeVisible();
}

async function pickStatus(page: Page, label: string): Promise<void> {
  await page.getByTestId(STATUS_SELECT).getByRole('combobox').click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

test.describe('Admin Current Mentees — Edit task and set status', () => {
  let requests: AdminProgramRequests;
  let patches: unknown[];

  test.beforeEach(() => {
    requests = { mentees: [], tasks: [] };
    patches = [];
  });

  test('sets the status on its own and keeps the row, without reading the tasks or the page again', async ({ page }) => {
    await open(page, requests, patches);
    const menteeReads = requests.mentees.length;

    await pickStatus(page, 'Completed');

    await expect.poll(() => patches).toEqual([{ status: 'completed' }]);
    await expect(page.getByTestId(STATUS_SELECT)).toContainText('Completed');
    expect(requests.tasks).toEqual([ACCEPTED_ID]);
    expect(requests.mentees).toHaveLength(menteeReads);
  });

  test('puts the select back and shows the generic copy when a change that cannot trip the file guard is a 400', async ({ page }) => {
    await open(page, requests, patches, 400);

    await pickStatus(page, 'Completed');

    await expect(page.getByText('Could not update the task')).toBeVisible();
    await expect(page.getByText('The task was not changed', { exact: false })).toBeVisible();
    await expect(page.getByText('requires a file', { exact: false })).toHaveCount(0);
    await expect(page.getByTestId(STATUS_SELECT)).toContainText('Submitted');
  });

  test('says why when turning on the file requirement is a 400 from the file guard', async ({ page }) => {
    await open(page, requests, patches, 400);

    await page.getByTestId(EDIT_BUTTON).getByRole('button').click();
    const dialog = page.getByTestId('mentorship-task-form-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#mentorship-task-requires-file').check();
    await page.getByTestId('mentorship-task-form-submit').click();

    await expect(page.getByText('Could not update the task')).toBeVisible();
    await expect(page.getByText('requires a file', { exact: false })).toBeVisible();
    expect(patches).toEqual([{ requiresFileSubmission: true }]);
  });

  test('tells the admin the task no longer exists when the change is a 404', async ({ page }) => {
    await open(page, requests, patches, 404);

    await pickStatus(page, 'In Progress');

    await expect(page.getByText('This task no longer exists', { exact: false })).toBeVisible();
    await expect(page.getByTestId(STATUS_SELECT)).toContainText('Submitted');
  });

  test('sends only what the edit changed, confirms, and shows the new name without reading the tasks again', async ({ page }) => {
    await open(page, requests, patches);

    await page.getByTestId(EDIT_BUTTON).getByRole('button').click();
    const dialog = page.getByTestId('mentorship-task-form-dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#mentorship-task-name').fill(NEW_NAME);
    await page.getByTestId('mentorship-task-form-submit').click();

    await expect(page.getByText('Task updated')).toBeVisible();
    expect(patches).toEqual([{ name: NEW_NAME }]);
    await expect(page.getByTestId(`mentorship-applicant-task-row-${TASK.id}`)).toContainText(NEW_NAME);
    expect(requests.tasks).toEqual([ACCEPTED_ID]);
  });

  test('keeps the old name and shows the failure when the edit is refused', async ({ page }) => {
    await open(page, requests, patches, 403);

    await page.getByTestId(EDIT_BUTTON).getByRole('button').click();
    const dialog = page.getByTestId('mentorship-task-form-dialog');
    await dialog.locator('#mentorship-task-name').fill(NEW_NAME);
    await page.getByTestId('mentorship-task-form-submit').click();

    await expect(page.getByText('Could not update the task')).toBeVisible();
    await expect(page.getByTestId(`mentorship-applicant-task-row-${TASK.id}`)).not.toContainText(NEW_NAME);
  });
});
