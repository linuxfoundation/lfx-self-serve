// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * View on a submitted task file (linuxfoundation/lfx-mentorship#400), on the admin Current Mentees task rows and on the
 * mentor's Tasks and Mentees tabs (linuxfoundation/lfx-mentorship#378).
 *
 * View opens a tab at once, then shows a PDF or text file there from a `blob:` URL re-typed to that type (headless
 * Chromium has no PDF viewer, so a PDF is checked by the type of the blob handed to the tab). Any other type closes the tab, is
 * downloaded, and an info toast says why; a failed read closes the tab and names the problem. The type comes from the
 * Content-Type the BFF relays, or from the file name when that type is generic. The file read and the page reads are
 * stubbed with synthetic data, and the pages are reached by client-side navigation (`openMentorPage`).
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import {
  ADMIN_PROGRAM_URL,
  ADMIN_TASKS,
  AdminProgramRequests,
  adminApplicationId,
  stubAdminMentees,
  stubAdminProgramPage,
  stubAdminTasks,
} from './helpers/mentorship-admin-program.helper';
import {
  blobTypes,
  MENTOR_VIEW_MENTEE_ID,
  MENTOR_VIEW_ROW_ID,
  MENTOR_VIEW_TASK_ID,
  MENTOR_VIEW_URL,
  recordBlobTypes,
  stubMentorViewDetail,
  stubTaskFile,
  TaskFileAnswer,
  VIEW_TEXT_BODY,
} from './helpers/mentorship-task-file-view.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const ADMIN_ROW_ID = adminApplicationId(1);
const ADMIN_TASK_ID = ADMIN_TASKS[0].id;

/** Opens the admin program page and the first row's tasks, with the file read answering `answer`. */
async function openAdminTasks(page: Page, answer?: TaskFileAnswer): Promise<string[]> {
  const requests: AdminProgramRequests = { mentees: [], tasks: [] };
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, requests);
  await stubAdminTasks(page, requests);
  const reads = await stubTaskFile(page, answer);
  await recordBlobTypes(page);
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await page.getByTestId(`mentorship-current-mentee-view-tasks-${ADMIN_ROW_ID}`).getByRole('button').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId(`mentorship-applicant-task-view-${ADMIN_TASK_ID}`)).toBeVisible();
  return reads;
}

const viewAdminTask = (page: Page) => page.getByTestId(`mentorship-applicant-task-view-${ADMIN_TASK_ID}`).click();

test.describe('Admin task rows — View', () => {
  test('opens a PDF submission in a new tab', async ({ page }) => {
    const reads = await openAdminTasks(page);
    const opened = page.waitForEvent('popup');

    await viewAdminTask(page);

    const tab = await opened;
    await expect.poll(() => blobTypes(page)).toEqual(['application/pdf']);
    expect(tab.isClosed()).toBe(false);
    expect(reads).toEqual([ADMIN_TASK_ID]);
  });

  test('shows a text submission in the new tab', async ({ page }) => {
    await openAdminTasks(page, { contentType: 'text/plain', fileName: 'notes.txt' });
    const opened = page.waitForEvent('popup');

    await viewAdminTask(page);

    const tab = await opened;
    await expect(tab.locator('body')).toContainText(VIEW_TEXT_BODY);
  });

  test('goes by the file name when the type is generic', async ({ page }) => {
    await openAdminTasks(page, { contentType: 'application/octet-stream', fileName: 'design.pdf' });
    const opened = page.waitForEvent('popup');

    await viewAdminTask(page);

    await expect.poll(() => blobTypes(page)).toEqual(['application/pdf']);
    expect((await opened).isClosed()).toBe(false);
  });

  test('downloads a Word file instead, closes the tab and says why', async ({ page }) => {
    await openAdminTasks(page, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileName: 'design.docx' });
    const opened = page.waitForEvent('popup');
    const saved = page.waitForEvent('download');

    await viewAdminTask(page);

    expect((await saved).suggestedFilename()).toBe('design.docx');
    await expect.poll(async () => (await opened).isClosed()).toBe(true);
    await expect(page.locator('p-toast .p-toast-message-info')).toContainText(
      'This file type cannot be previewed in the browser, so it was downloaded instead.'
    );
  });

  test('closes the tab and says the file is gone when the read finds none (404)', async ({ page }) => {
    await openAdminTasks(page, { status: 404 });
    const opened = page.waitForEvent('popup');

    await viewAdminTask(page);

    await expect.poll(async () => (await opened).isClosed()).toBe(true);
    const toast = page.locator('p-toast .p-toast-message-error');
    await expect(toast).toContainText('Could not open the file');
    await expect(toast).toContainText('This file is no longer available.');
  });
});

test.describe('Mentor task rows — View', () => {
  test('opens a submission from View Submission on the Tasks tab', async ({ page }) => {
    await stubMentorViewDetail(page);
    const reads = await stubTaskFile(page);
    await recordBlobTypes(page);
    await openMentorPage(page, MENTOR_VIEW_URL);
    const view = page.getByTestId(`mentorship-mentor-task-view-submission-${MENTOR_VIEW_ROW_ID}`).getByRole('button');
    await expect(view).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    const opened = page.waitForEvent('popup');

    await view.click();

    await expect.poll(() => blobTypes(page)).toEqual(['application/pdf']);
    expect((await opened).isClosed()).toBe(false);
    expect(reads).toEqual([MENTOR_VIEW_TASK_ID]);
  });

  test('opens a submission from a mentee task row on the Mentees tab', async ({ page }) => {
    await stubMentorViewDetail(page);
    await stubTaskFile(page);
    await recordBlobTypes(page);
    await openMentorPage(page, MENTOR_VIEW_URL);
    await page.getByTestId('mentorship-mentor-program-detail-tab-mentees').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await page.getByTestId(`mentorship-mentor-mentee-view-tasks-${MENTOR_VIEW_MENTEE_ID}`).getByRole('button').click();
    const opened = page.waitForEvent('popup');

    await page.getByTestId(`mentorship-applicant-task-view-${MENTOR_VIEW_TASK_ID}`).click();

    await expect.poll(() => blobTypes(page)).toEqual(['application/pdf']);
    expect((await opened).isClosed()).toBe(false);
  });

  test('says the mentor has no access when the read is refused (403)', async ({ page }) => {
    await stubMentorViewDetail(page);
    await stubTaskFile(page, { status: 403 });
    await openMentorPage(page, MENTOR_VIEW_URL);
    const opened = page.waitForEvent('popup');

    await page.getByTestId(`mentorship-mentor-task-view-submission-${MENTOR_VIEW_ROW_ID}`).getByRole('button').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect.poll(async () => (await opened).isClosed()).toBe(true);
    await expect(page.locator('p-toast .p-toast-message-error')).toContainText('You do not have access to this file.');
  });
});
