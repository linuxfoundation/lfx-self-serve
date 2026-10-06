// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Current Mentees Create task — structural / data-testid contract (linuxfoundation/lfx-mentorship#237).
 *
 * Companion to `mentorship-admin-task-create.spec.ts` (content). This spec asserts which rows offer Create task and
 * that the task form dialog opens with its fields and buttons, by testid and role rather than copy. Every read is
 * stubbed with synthetic data and reached by client-side navigation; no write is sent.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import { ADMIN_PROGRAM_URL, adminApplicationId, stubAdminMentees, stubAdminProgramPage } from './helpers/mentorship-admin-program.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

/** A pending row and an accepted row (every third synthetic application is accepted). */
const PENDING_ID = adminApplicationId(1);
const ACCEPTED_ID = adminApplicationId(3);

async function open(page: Page): Promise<void> {
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, { mentees: [], tasks: [] });
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

test.describe('Admin Current Mentees Create task — structure', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('offers Create task on an accepted row', async ({ page }) => {
    await page.getByTestId(`mentorship-current-mentee-actions-${ACCEPTED_ID}`).click();

    await expect(page.getByRole('menuitem', { name: 'Create task', exact: true })).toBeVisible();
  });

  test('does not offer Create task on a pending row', async ({ page }) => {
    await page.getByTestId(`mentorship-current-mentee-actions-${PENDING_ID}`).click();

    await expect(page.getByRole('menuitem', { name: 'Accept', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Create task', exact: true })).toHaveCount(0);
  });

  test('opens the task form dialog with its fields, Cancel and submit', async ({ page }) => {
    await page.getByTestId(`mentorship-current-mentee-actions-${ACCEPTED_ID}`).click();
    await page.getByRole('menuitem', { name: 'Create task', exact: true }).click();

    const dialog = page.getByTestId('mentorship-task-form-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#mentorship-task-name')).toBeVisible();
    await expect(dialog.locator('#mentorship-task-description')).toBeVisible();
    await expect(page.getByTestId('mentorship-task-form-submit')).toBeVisible();
  });
});
