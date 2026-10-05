// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin program detail — structural / data-testid contract (linuxfoundation/lfx-mentorship#233).
 *
 * Companion to `mentorship-admin-program-tabs.spec.ts` (content). This spec asserts presence, nesting, the
 * dynamic row-id suffixes and the error / Retry structural states without user-facing copy.
 * Every read is stubbed with synthetic data and reached by client-side navigation.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import {
  ADMIN_PROGRAM_PAGE,
  ADMIN_PROGRAM_URL,
  AdminProgramRequests,
  adminApplicationId,
  stubAdminMentees,
  stubAdminProgramPage,
  stubAdminProgramPageError,
  stubAdminTasks,
} from './helpers/mentorship-admin-program.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const FIRST_ID = adminApplicationId(1);
const TABS = ['current-mentees', 'past-mentees', 'mentors', 'terms'];

async function open(page: Page, requests: AdminProgramRequests): Promise<void> {
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, requests);
  await stubAdminTasks(page, requests);
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

test.describe('Admin program detail — structure', () => {
  test.beforeEach(async ({ page }) => {
    await open(page, { mentees: [], tasks: [] });
  });

  test('renders the title and one tab per section', async ({ page }) => {
    await expect(page.getByTestId('mentorship-program-detail-title')).toBeVisible();
    for (const tab of TABS) {
      await expect(page.getByTestId(`mentorship-program-detail-tab-${tab}`)).toBeVisible();
    }
  });

  test('nests the filters, the rows and the paginator inside the Current Mentees tab', async ({ page }) => {
    const tab = page.getByTestId('mentorship-current-mentees-tab');

    await expect(tab.getByTestId('mentorship-current-mentees-status')).toBeVisible();
    await expect(tab.getByTestId('mentorship-current-mentees-term')).toBeVisible();
    await expect(tab.locator('[data-test="mentorship-current-mentees-search"]')).toBeVisible();
    await expect(tab.locator('[data-testid^="mentorship-current-mentee-row-"]')).toHaveCount(10);
    await expect(tab.getByTestId(`mentorship-current-mentee-row-${FIRST_ID}`)).toBeVisible();
  });

  test('gives each row its own actions, term and View Tasks controls, keyed by application id', async ({ page }) => {
    await expect(page.getByTestId(`mentorship-current-mentee-actions-${FIRST_ID}`)).toBeVisible();
    await expect(page.getByTestId(`mentorship-current-mentee-term-${FIRST_ID}`)).toBeVisible();
    await expect(page.getByTestId(`mentorship-current-mentee-view-tasks-${FIRST_ID}`)).toBeVisible();
  });

  test('renders none of the error or empty structures while the reads succeed', async ({ page }) => {
    await expect(page.getByTestId('mentorship-admin-program-no-access')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-admin-program-not-found')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-admin-program-load-error')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-admin-current-mentees-load-error')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-current-mentees-empty')).toHaveCount(0);
  });
});

test.describe('Admin program detail — tasks panel', () => {
  test('renders the expanded panel inside the row it belongs to, and none before View Tasks', async ({ page }) => {
    await open(page, { mentees: [], tasks: [] });
    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${FIRST_ID}`)).toHaveCount(0);

    await page.getByTestId(`mentorship-current-mentee-view-tasks-${FIRST_ID}`).getByRole('button').click();

    await expect(page.getByTestId(`mentorship-current-mentee-tasks-expanded-${FIRST_ID}`)).toBeVisible();
    await expect(page.getByTestId('mentorship-admin-current-mentees-tasks-load-error')).toHaveCount(0);
  });

  test('renders the tasks error with a Retry keyed by application id when the read fails', async ({ page }) => {
    const requests: AdminProgramRequests = { mentees: [], tasks: [] };
    await enableMentorshipFlag(page);
    await stubAdminProgramPage(page);
    await stubAdminMentees(page, requests);
    await stubAdminTasks(page, requests, () => 500);
    await openMentorPage(page, ADMIN_PROGRAM_URL);
    await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await page.getByTestId(`mentorship-current-mentee-view-tasks-${FIRST_ID}`).getByRole('button').click();

    await expect(page.getByTestId('mentorship-admin-current-mentees-tasks-load-error')).toBeVisible();
    await expect(page.getByTestId(`mentorship-admin-current-mentees-tasks-retry-${FIRST_ID}`)).toBeVisible();
  });
});

test.describe('Admin program detail — failed mentees read', () => {
  test('renders the mentees error with a Retry and no rows or empty state', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubAdminProgramPage(page);
    await stubAdminMentees(page, { mentees: [], tasks: [] }, 500);
    await openMentorPage(page, ADMIN_PROGRAM_URL);

    await expect(page.getByTestId('mentorship-admin-current-mentees-load-error')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-admin-current-mentees-retry')).toBeVisible();
    await expect(page.locator('[data-testid^="mentorship-current-mentee-row-"]')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-current-mentees-empty')).toHaveCount(0);
    // The page itself loaded, so the header and tabs stay.
    await expect(page.getByTestId('mentorship-program-detail-tab-current-mentees')).toBeVisible();
  });
});

test.describe('Admin program detail — failed page read', () => {
  test('renders only the no-access structure for a 403', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubAdminProgramPageError(page, 403);
    await openMentorPage(page, ADMIN_PROGRAM_URL);

    await expect(page.getByTestId('mentorship-admin-program-no-access')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-admin-program-not-found')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-admin-program-load-error')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-current-mentees-tab')).toHaveCount(0);
  });

  test('renders only the not-found structure for a 404', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubAdminProgramPageError(page, 404);
    await openMentorPage(page, ADMIN_PROGRAM_URL);

    await expect(page.getByTestId('mentorship-admin-program-not-found')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-admin-program-no-access')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-admin-program-load-error')).toHaveCount(0);
  });

  test('renders the load error with a Retry for any other failure, and the tab once Retry succeeds', async ({ page }) => {
    const requests: AdminProgramRequests = { mentees: [], tasks: [] };
    await enableMentorshipFlag(page);
    await stubAdminProgramPageError(page, 503);
    await stubAdminMentees(page, requests);
    await openMentorPage(page, ADMIN_PROGRAM_URL);

    await expect(page.getByTestId('mentorship-admin-program-load-error')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-admin-program-retry')).toBeVisible();

    await page.unroute(`**/api/mentorship/admin/programs/${ADMIN_PROGRAM_PAGE.program.id}`);
    await stubAdminProgramPage(page);
    await page.getByTestId('mentorship-admin-program-retry').getByRole('button').click();

    await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-admin-program-load-error')).toHaveCount(0);
  });
});
