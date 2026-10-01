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

import { MENTORSHIP_MENTEE_TASKS_URL, MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_HEADER, MENTORSHIP_MENTEE_WITHDRAW_LABEL } from '@lfx-one/shared/constants';
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

  test.describe('Withdraw', () => {
    const PENDING_APPLICATION_ID = '0b6e1f2a-3c4d-4e5f-8a6b-7c8d9e0f1a2b';
    const ACCEPTED_APPLICATION_ID = '1c7f2a3b-4d5e-4f6a-9b7c-8d9e0f1a2b3c';
    const withdrawTestId = (id: string) => `mentee-overview-withdraw-${id}`;
    const application = (id: string, upstreamStatus: string) => ({
      id,
      programId: `prog-${id}`,
      programName: 'Test Program',
      term: { id: 'term-1', name: 'Fall 2026' },
      upstreamStatus,
      createdOn: '2026-06-01T10:00:00Z',
      updatedOn: '2026-06-02T10:00:00Z',
      tasks: [],
    });

    test.beforeEach(async ({ page }) => {
      await enableMentorshipFlag(page);
      const data = [application(PENDING_APPLICATION_ID, 'pending'), application(ACCEPTED_APPLICATION_ID, 'accepted')];
      await stubMenteeApplications(page, 200, JSON.stringify({ data, total: data.length }));
    });

    test('Overview offers withdraw on the pending card only and attaches its confirm dialog', async ({ page }) => {
      await openMenteeTab(page, MENTEE_OVERVIEW_URL);

      await expect(page.getByTestId('mentee-application-card')).toHaveCount(2, { timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
      // Scoped to buttons: the confirm dialog's testid shares the `mentee-overview-withdraw-` prefix.
      await expect(page.locator('button[data-testid^="mentee-overview-withdraw-"]')).toHaveCount(1);
      await expect(page.getByTestId(withdrawTestId(ACCEPTED_APPLICATION_ID))).toHaveCount(0);
      const withdraw = page.getByTestId(withdrawTestId(PENDING_APPLICATION_ID));
      await expect(withdraw).toBeEnabled();
      await expect(withdraw).toHaveAttribute('aria-busy', 'false');
      await expect(page.getByTestId('mentee-overview-withdraw-confirm-dialog')).toBeAttached();
    });

    test('Overview disables withdraw and marks it busy while the withdraw is in flight', async ({ page }) => {
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route('**/api/mentorship/mentee/applications/*/withdraw', async (route) => {
        await held;
        await route.fulfill({ status: 204, body: '' });
      });

      await openMenteeTab(page, MENTEE_OVERVIEW_URL);
      const withdraw = page.getByTestId(withdrawTestId(PENDING_APPLICATION_ID));
      await expect(withdraw).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });

      await withdraw.click();
      // PrimeNG appends the dialog to `<body>`, outside its testid host, so it is found by role.
      await page
        .getByRole('alertdialog')
        .filter({ hasText: MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_HEADER })
        .getByRole('button', { name: MENTORSHIP_MENTEE_WITHDRAW_LABEL, exact: true })
        .click();

      await expect(withdraw).toBeDisabled();
      await expect(withdraw).toHaveAttribute('aria-busy', 'true');
      release();
    });
  });
});
