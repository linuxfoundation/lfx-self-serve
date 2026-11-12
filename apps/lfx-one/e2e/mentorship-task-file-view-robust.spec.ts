// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * View on a submitted task file — structural / data-testid contract (linuxfoundation/lfx-mentorship#400, #378).
 *
 * Companion to `mentorship-task-file-view.spec.ts` (content). This spec asserts, by testid, role and attribute rather
 * than copy, that View sits beside Download in the task row and is named for the task and the person, that the tab it
 * opens has no opener, that a text file is shown as plain text, that an HTML file is never opened, and that the mentor's
 * Tasks card offers View Submission only when the task has a file. Every read is stubbed with synthetic data and the
 * pages are reached by client-side navigation.
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
  MENTOR_VIEW_ROW_ID,
  MENTOR_VIEW_URL,
  recordBlobTypes,
  stubMentorViewDetail,
  stubTaskFile,
  TaskFileAnswer,
} from './helpers/mentorship-task-file-view.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const ADMIN_TASK = ADMIN_TASKS[0];

async function openAdminTasks(page: Page, answer?: TaskFileAnswer): Promise<void> {
  const requests: AdminProgramRequests = { mentees: [], tasks: [] };
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, requests);
  await stubAdminTasks(page, requests);
  await stubTaskFile(page, answer);
  await recordBlobTypes(page);
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await page
    .getByTestId(`mentorship-current-mentee-view-tasks-${adminApplicationId(1)}`)
    .getByRole('button')
    .click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

test.describe('Admin task rows — View structure', () => {
  test('puts View beside Download in the row, named for the task and the applicant', async ({ page }) => {
    await openAdminTasks(page);

    const row = page.getByTestId(`mentorship-applicant-task-row-${ADMIN_TASK.id}`);
    await expect(row.getByTestId(`mentorship-applicant-task-view-${ADMIN_TASK.id}`)).toHaveAttribute(
      'aria-label',
      `View ${ADMIN_TASK.name} for Test Applicant 01`
    );
    await expect(row.getByTestId(`mentorship-applicant-task-download-${ADMIN_TASK.id}`)).toBeVisible();
  });

  test('opens the tab without an opener, and shows a text file as plain text', async ({ page }) => {
    await openAdminTasks(page, { contentType: 'text/plain', fileName: 'notes.txt' });
    const opened = page.getByTestId(`mentorship-applicant-task-view-${ADMIN_TASK.id}`);
    const popup = page.waitForEvent('popup');

    await opened.click();

    const tab = await popup;
    await expect.poll(() => blobTypes(page)).toEqual(['text/plain;charset=utf-8']);
    expect(await tab.evaluate(() => window.opener)).toBeNull();
  });

  test('never opens an HTML file in the tab: it closes the tab and downloads it', async ({ page }) => {
    await openAdminTasks(page, { contentType: 'text/html', fileName: 'page.html' });
    const popup = page.waitForEvent('popup');
    const saved = page.waitForEvent('download');

    await page.getByTestId(`mentorship-applicant-task-view-${ADMIN_TASK.id}`).click();

    expect((await saved).suggestedFilename()).toBe('page.html');
    await expect.poll(async () => (await popup).isClosed()).toBe(true);
  });
});

test.describe('Mentor Tasks card — View structure', () => {
  test('offers View Submission beside Download Submission on a task with a file', async ({ page }) => {
    await stubMentorViewDetail(page);
    await openMentorPage(page, MENTOR_VIEW_URL);

    const card = page.getByTestId(`mentorship-mentor-task-card-${MENTOR_VIEW_ROW_ID}`);
    await expect(card.getByTestId(`mentorship-mentor-task-view-submission-${MENTOR_VIEW_ROW_ID}`).getByRole('button')).toBeVisible({
      timeout: MENTOR_PAGE_LOAD_TIMEOUT,
    });
    await expect(card.getByTestId(`mentorship-mentor-task-open-submission-${MENTOR_VIEW_ROW_ID}`).getByRole('button')).toBeVisible();
  });

  test('offers neither on a submitted task with no file', async ({ page }) => {
    await stubMentorViewDetail(page, false);
    await openMentorPage(page, MENTOR_VIEW_URL);

    const card = page.getByTestId(`mentorship-mentor-task-card-${MENTOR_VIEW_ROW_ID}`);
    await expect(card).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(card.getByTestId(`mentorship-mentor-task-view-submission-${MENTOR_VIEW_ROW_ID}`)).toHaveCount(0);
    await expect(card.getByTestId(`mentorship-mentor-task-open-submission-${MENTOR_VIEW_ROW_ID}`)).toHaveCount(0);
  });
});
