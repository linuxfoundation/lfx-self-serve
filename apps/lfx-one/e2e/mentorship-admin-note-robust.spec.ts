// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Current Mentees reviewer notes — structural / data-testid contract (linuxfoundation/lfx-mentorship#236).
 *
 * Companion to `mentorship-admin-note.spec.ts` (content). This spec asserts the Note link on every row and the
 * presence of the note dialog's textarea and buttons, by testid and role rather than copy. Every read is stubbed with
 * synthetic data and reached by client-side navigation; no write is sent.
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

const APPLICATION_ID = adminApplicationId(1);

async function open(page: Page): Promise<void> {
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, { mentees: [], tasks: [] });
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

test.describe('Admin Current Mentees reviewer notes — structure', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('renders a Note link on a row inside the Current Mentees tab', async ({ page }) => {
    await expect(page.getByTestId('mentorship-current-mentees-tab').getByTestId(`mentorship-current-mentee-note-${APPLICATION_ID}`)).toBeVisible();
  });

  test('opens the note dialog with its textarea, Cancel and Save', async ({ page }) => {
    await page.getByTestId(`mentorship-current-mentee-note-${APPLICATION_ID}`).click();

    const dialog = page.getByTestId('mentorship-mentee-note-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#dialog-mentee-note')).toBeVisible();
    await expect(dialog.getByTestId('mentorship-mentee-note-cancel')).toBeVisible();
    await expect(dialog.getByTestId('mentorship-mentee-note-save')).toBeVisible();
  });

  test('closes the note dialog on Cancel without leaving it open', async ({ page }) => {
    await page.getByTestId(`mentorship-current-mentee-note-${APPLICATION_ID}`).click();
    await page.getByTestId('mentorship-mentee-note-cancel').getByRole('button').click();

    await expect(page.getByTestId('mentorship-mentee-note-dialog')).toHaveCount(0);
  });
});
