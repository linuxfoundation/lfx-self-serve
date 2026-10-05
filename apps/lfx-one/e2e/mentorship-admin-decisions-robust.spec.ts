// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Current Mentees decisions — structural / data-testid contract (linuxfoundation/lfx-mentorship#235).
 *
 * Companion to `mentorship-admin-decisions.spec.ts` (content). This spec asserts the row action menus per status,
 * and the presence and nesting of the decision dialogs and confirmations, by testid and role rather than copy.
 * Every read is stubbed with synthetic data and reached by client-side navigation; no write is sent.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import { ADMIN_PROGRAM_URL, adminApplicationId, stubAdminMentees, stubAdminProgramPage, stubAdminTasks } from './helpers/mentorship-admin-program.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PENDING_ID = adminApplicationId(1);
const ACCEPTED_ID = adminApplicationId(3);

async function open(page: Page): Promise<void> {
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, { mentees: [], tasks: [] });
  await stubAdminTasks(page, { mentees: [], tasks: [] });
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

test.describe('Admin Current Mentees decisions — structure', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('offers the decision items that fit a pending and an accepted row', async ({ page }) => {
    const pending = page.getByTestId(`mentorship-current-mentee-actions-${PENDING_ID}`);
    await pending.click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByRole('menuitem')).toHaveCount(3);
    await pending.click();
    await expect(page.getByRole('menuitem')).toHaveCount(0);

    await page.getByTestId(`mentorship-current-mentee-actions-${ACCEPTED_ID}`).click();
    await expect(page.getByRole('menuitem')).toHaveCount(4);
  });

  test('renders the Decline by Term trigger in the Current Mentees toolbar', async ({ page }) => {
    await expect(page.getByTestId('mentorship-current-mentees-tab').getByTestId('mentorship-admin-current-mentees-decline-by-term')).toBeVisible();
  });

  test('opens the accept dialog with its attendance select and both buttons', async ({ page }) => {
    await page.getByTestId(`mentorship-current-mentee-actions-${PENDING_ID}`).click();
    await page.getByRole('menuitem').first().click();

    const dialog = page.getByTestId('mentorship-admin-accept-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-test="mentorship-admin-accept-attendance"]')).toBeVisible();
    await expect(dialog.getByTestId('mentorship-admin-accept-cancel')).toBeVisible();
    await expect(dialog.getByTestId('mentorship-admin-accept-confirm')).toBeVisible();

    await dialog.getByTestId('mentorship-admin-accept-cancel').getByRole('button').click();
    await expect(dialog).toHaveCount(0);
  });

  test('opens a confirmation dialog for each of Decline and Withdraw, with Cancel and an accept button', async ({ page }) => {
    for (const label of ['Decline', 'Withdraw']) {
      await page.getByTestId(`mentorship-current-mentee-actions-${PENDING_ID}`).click();
      await page.getByRole('menuitem', { name: label, exact: true }).click();

      const confirmation = page.locator('.p-confirmdialog');
      await expect(confirmation).toBeVisible();
      await expect(confirmation.getByRole('button')).toHaveCount(2);

      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(confirmation).toHaveCount(0);
    }
  });

  test('opens the Decline by Term dialog with its term select and buttons', async ({ page }) => {
    await page.getByTestId('mentorship-admin-current-mentees-decline-by-term').getByRole('button').click();

    const dialog = page.getByTestId('mentorship-admin-decline-by-term-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-test="mentorship-admin-decline-by-term-select"]')).toBeVisible();
    await expect(dialog.getByTestId('mentorship-admin-decline-by-term-cancel')).toBeVisible();
    await expect(dialog.getByTestId('mentorship-admin-decline-by-term-continue')).toBeVisible();
    await expect(dialog.getByTestId('mentorship-admin-decline-by-term-empty')).toHaveCount(0);
  });
});
