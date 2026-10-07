// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Mentors tab actions — structural / data-testid contract (linuxfoundation/lfx-mentorship#238).
 *
 * Companion to `mentorship-admin-mentors.spec.ts` (content). This spec asserts, by testid and role rather than
 * copy, which actions each mentor row carries and that each one opens a confirmation with Cancel and an accept
 * button. Every read is stubbed with synthetic data and reached by client-side navigation; no write is sent.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import {
  MENTOR_ACTIVE_ID,
  MENTOR_DECLINED_ID,
  MENTOR_INVITED_ID,
  MENTOR_PENDING_ID,
  MENTOR_REQUESTED_ID,
  newMentorStubState,
  stubMentorActions,
} from './helpers/mentorship-admin-mentors.helper';
import { ADMIN_PROGRAM_URL, stubAdminMentees, stubAdminProgramPage, stubAdminTasks } from './helpers/mentorship-admin-program.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const rowActions = (page: Page, id: string) => page.getByTestId(`mentorship-mentor-row-${id}`).locator('[data-testid^="mentorship-admin-mentors-"]');

test.describe('Admin Mentors tab actions — structure', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubAdminProgramPage(page);
    await stubAdminMentees(page, { mentees: [], tasks: [] });
    await stubAdminTasks(page, { mentees: [], tasks: [] });
    await stubMentorActions(page, newMentorStubState());
    await openMentorPage(page, ADMIN_PROGRAM_URL);
    await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await page.getByTestId('mentorship-program-detail-tab-mentors').click();
    await expect(page.getByTestId(`mentorship-mentor-row-${MENTOR_REQUESTED_ID}`)).toBeVisible();
  });

  test('gives each row the action buttons its status allows, keyed by action and membership id', async ({ page }) => {
    await expect(rowActions(page, MENTOR_REQUESTED_ID)).toHaveCount(2);
    await expect(rowActions(page, MENTOR_PENDING_ID)).toHaveCount(2);
    await expect(rowActions(page, MENTOR_INVITED_ID)).toHaveCount(1);
    await expect(rowActions(page, MENTOR_ACTIVE_ID)).toHaveCount(1);
    await expect(rowActions(page, MENTOR_DECLINED_ID)).toHaveCount(0);
  });

  test('names every action button for the mentor it acts on', async ({ page }) => {
    for (const button of await rowActions(page, MENTOR_REQUESTED_ID).all()) {
      await expect(button).toHaveAttribute('aria-label', /Test Mentor Requested$/);
    }
  });

  test('opens a confirmation with Cancel and an accept button for each action', async ({ page }) => {
    for (const [key, id] of [
      ['accept', MENTOR_REQUESTED_ID],
      ['decline', MENTOR_REQUESTED_ID],
      ['revoke', MENTOR_INVITED_ID],
      ['remove', MENTOR_ACTIVE_ID],
    ]) {
      await page.getByTestId(`mentorship-admin-mentors-${key}-${id}`).click();

      const confirmation = page.locator('.p-confirmdialog');
      await expect(confirmation).toBeVisible();
      await expect(confirmation.getByRole('button')).toHaveCount(2);

      await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(confirmation).toHaveCount(0);
    }
  });
});
