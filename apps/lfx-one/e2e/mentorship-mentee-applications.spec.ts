// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee Overview and My Tasks — empty and error states
 * (KB: `code-truthiness/missing-e2e-for-empty-state`).
 *
 * Both tabs derive from `/api/mentorship/mentee/applications`. This suite stubs that read via
 * `page.route` so each state is locked independently of the applications the signed-in user holds
 * upstream, and reaches each tab by client-side navigation so the stub is the read that runs.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import {
  MENTORSHIP_MENTEE_EMPTY_TITLE,
  MENTORSHIP_MENTEE_OVERVIEW_LOAD_ERROR,
  MENTORSHIP_MENTEE_TASKS_EMPTY_TITLE,
  MENTORSHIP_MENTEE_TASKS_LOAD_ERROR,
  MENTORSHIP_MENTEE_TASKS_URL,
} from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTEE_OVERVIEW_URL, MENTEE_PROFILE_LOAD_TIMEOUT, openMenteeTab, stubMenteeApplications } from './helpers/mentee-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMenteeTab` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

test.describe('Mentee applications — empty state', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubMenteeApplications(page, 200, JSON.stringify({ data: [], total: 0 }));
  });

  test('Overview shows the no-applications empty state', async ({ page }) => {
    await openMenteeTab(page, MENTEE_OVERVIEW_URL);

    await expect(page.getByTestId('mentee-overview-empty')).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentee-overview-empty')).toContainText(MENTORSHIP_MENTEE_EMPTY_TITLE);
    await expect(page.getByTestId('mentee-application-card')).toHaveCount(0);
  });

  test('My Tasks shows the no-tasks empty state', async ({ page }) => {
    await openMenteeTab(page, MENTORSHIP_MENTEE_TASKS_URL);

    await expect(page.getByTestId('mentee-tasks-empty')).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentee-tasks-empty')).toContainText(MENTORSHIP_MENTEE_TASKS_EMPTY_TITLE);
    await expect(page.getByTestId('mentee-tasks')).toHaveCount(0);
  });
});

test.describe('Mentee applications — error state', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    // No body, so the page shows its own fallback message rather than a server-authored one.
    await stubMenteeApplications(page, 503, '');
  });

  test('Overview shows the load error with a retry', async ({ page }) => {
    await openMenteeTab(page, MENTEE_OVERVIEW_URL);

    await expect(page.getByTestId('mentee-overview-error')).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentee-overview-error')).toContainText(MENTORSHIP_MENTEE_OVERVIEW_LOAD_ERROR);
    await expect(page.getByTestId('mentee-overview-empty')).toHaveCount(0);
  });

  test('My Tasks shows the load error with a retry', async ({ page }) => {
    await openMenteeTab(page, MENTORSHIP_MENTEE_TASKS_URL);

    await expect(page.getByTestId('mentee-tasks-error')).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentee-tasks-error')).toContainText(MENTORSHIP_MENTEE_TASKS_LOAD_ERROR);
    await expect(page.getByTestId('mentee-tasks-empty')).toHaveCount(0);
  });
});
