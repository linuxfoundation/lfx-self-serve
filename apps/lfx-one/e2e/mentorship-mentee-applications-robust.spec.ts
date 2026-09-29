// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee Overview and My Tasks — structural / data-testid contract.
 *
 * Companion to `mentorship-mentee-applications.spec.ts` (content + empty/error copy). This spec
 * asserts that each loaded state attaches its own testid and none of the others, without
 * user-facing copy.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_MENTEE_TASKS_URL } from '@lfx-one/shared/constants';
import { expect, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTEE_OVERVIEW_URL, MENTEE_PROFILE_LOAD_TIMEOUT, openMenteeTab, stubMenteeApplications } from './helpers/mentee-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMenteeTab` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

test.describe('Mentee applications — Robust Tests', () => {
  test.describe('Empty state', () => {
    test.beforeEach(async ({ page }) => {
      await enableMentorshipFlag(page);
      await stubMenteeApplications(page, 200, JSON.stringify({ data: [], total: 0 }));
    });

    test('Overview attaches only the empty-state testids', async ({ page }) => {
      await openMenteeTab(page, MENTEE_OVERVIEW_URL);

      const empty = page.getByTestId('mentee-overview-empty');
      await expect(empty).toBeAttached({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
      await expect(empty.getByTestId('mentee-overview-find-program')).toBeAttached();
      await expect(page.getByTestId('mentee-overview-applicant')).toHaveCount(0);
      await expect(page.getByTestId('mentee-overview-past-applications')).toHaveCount(0);
      await expect(page.getByTestId('mentee-overview-error')).toHaveCount(0);
    });

    test('My Tasks attaches only the empty-state testid', async ({ page }) => {
      await openMenteeTab(page, MENTORSHIP_MENTEE_TASKS_URL);

      await expect(page.getByTestId('mentee-tasks-empty')).toBeAttached({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
      await expect(page.getByTestId('mentee-tasks')).toHaveCount(0);
      await expect(page.getByTestId('mentee-tasks-error')).toHaveCount(0);
    });
  });

  test.describe('Error state', () => {
    test.beforeEach(async ({ page }) => {
      await enableMentorshipFlag(page);
      await stubMenteeApplications(page, 503, '');
    });

    test('Overview replaces its content with the error-state testid', async ({ page }) => {
      await openMenteeTab(page, MENTEE_OVERVIEW_URL);

      await expect(page.getByTestId('mentee-overview-error')).toBeAttached({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
      await expect(page.getByTestId('mentee-overview-empty')).toHaveCount(0);
      await expect(page.getByTestId('mentee-overview-applicant')).toHaveCount(0);
    });

    test('My Tasks replaces its content with the error-state testid', async ({ page }) => {
      await openMenteeTab(page, MENTORSHIP_MENTEE_TASKS_URL);

      await expect(page.getByTestId('mentee-tasks-error')).toBeAttached({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
      await expect(page.getByTestId('mentee-tasks-empty')).toHaveCount(0);
      await expect(page.getByTestId('mentee-tasks')).toHaveCount(0);
    });
  });
});
