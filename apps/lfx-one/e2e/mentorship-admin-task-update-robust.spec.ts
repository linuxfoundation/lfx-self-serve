// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Current Mentees Edit task and set status — structural / data-testid contract (linuxfoundation/lfx-mentorship#240).
 *
 * Companion to `mentorship-admin-task-update.spec.ts` (content). This spec asserts what the expanded task row offers
 * (the status select with its four statuses, and Edit) and that Edit opens the task form on the task's own values, by
 * testid and role rather than copy. Every read is stubbed with synthetic data and reached by client-side navigation;
 * no write is sent.
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
const TASK = ADMIN_TASKS[0];

async function open(page: Page): Promise<void> {
  const requests = { mentees: [], tasks: [] };
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, requests);
  await stubAdminTasks(page, requests);
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  await page.getByTestId(`mentorship-current-mentee-view-tasks-${ACCEPTED_ID}`).getByRole('button').click();
  await expect(page.getByTestId(`mentorship-applicant-task-row-${TASK.id}`)).toBeVisible();
}

test.describe('Admin Current Mentees Edit task and set status — structure', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('offers the status select and Edit on a non-prerequisite task', async ({ page }) => {
    await expect(page.getByTestId(`mentorship-applicant-task-status-${TASK.id}`)).toBeVisible();
    await expect(page.getByTestId(`mentorship-applicant-task-edit-${TASK.id}`)).toBeVisible();
    await expect(page.getByTestId(`mentorship-applicant-task-edit-${TASK.id}`).getByRole('button')).toBeEnabled();
  });

  test('lists the four statuses in the select', async ({ page }) => {
    await page.getByTestId(`mentorship-applicant-task-status-${TASK.id}`).getByRole('combobox').click();

    await expect(page.getByRole('option')).toHaveCount(4);
  });

  test('opens the task form on the task, with its fields and submit', async ({ page }) => {
    await page.getByTestId(`mentorship-applicant-task-edit-${TASK.id}`).getByRole('button').click();

    const dialog = page.getByTestId('mentorship-task-form-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#mentorship-task-name')).toHaveValue(TASK.name);
    await expect(dialog.locator('#mentorship-task-description')).toHaveValue(TASK.description);
    await expect(page.getByTestId('mentorship-task-form-submit')).toBeVisible();
  });
});
