// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Program review page — the landing page for the approve/reject links in the program-review email
 * (KB: `code-truthiness/missing-e2e-for-empty-state`).
 *
 * Content spec: the confirm flow and the copy each outcome state shows. The data-testid contract
 * lives in the companion `mentorship-program-review-robust.spec.ts`.
 *
 * The BFF endpoints are stubbed per test so each outcome state (confirm, success, already decided,
 * forbidden, not found, invalid link, error) renders independently of upstream data and of whether
 * the signed-in test user is on the mentorship approver team.
 *
 * The module is behind the `mentorship-enabled` client flag; the flag is pinned via the localStorage
 * override, the same pattern mentorship-mentor-profile.spec.ts uses.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import {
  DECISION_API,
  enableMentorshipFlag,
  gotoProgramReview,
  openProgramReview,
  PROGRAM_ID,
  PROGRAM_REVIEW_LOAD_TIMEOUT,
  stubProgramDecision,
  stubProgramReview,
} from './helpers/program-review.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

test.describe('Program review — confirm flow', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubProgramReview(page, 200, { status: 'pending' });
  });

  test('asks for confirmation and records nothing until Confirm is clicked', async ({ page }) => {
    let decisionPosts = 0;
    await page.route(DECISION_API, (route) => {
      decisionPosts += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: PROGRAM_ID, name: 'Test Program', status: 'published' }),
      });
    });

    await openProgramReview(page);

    await expect(page.getByTestId('mentorship-program-review-title')).toContainText('Approve this program?', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
    expect(decisionPosts).toBe(0);

    await page.getByTestId('mentorship-program-review-confirm-button').getByRole('button').click();

    await expect(page.getByTestId('mentorship-program-review-success')).toContainText('Program approved', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
    expect(decisionPosts).toBe(1);
  });

  test('explains a 409 on Confirm as another reviewer deciding first', async ({ page }) => {
    await stubProgramDecision(page, 409);

    await openProgramReview(page, 'reject');
    await page.getByTestId('mentorship-program-review-confirm-button').getByRole('button').click({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-program-review-already-decided')).toContainText('Another reviewer decided this program', {
      timeout: PROGRAM_REVIEW_LOAD_TIMEOUT,
    });
  });

  test('offers Try again after a failed Confirm and returns to the confirm card', async ({ page }) => {
    await stubProgramDecision(page, 502);

    await openProgramReview(page);
    await page.getByTestId('mentorship-program-review-confirm-button').getByRole('button').click({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });

    const error = page.getByTestId('mentorship-program-review-error');
    await expect(error).toContainText('The decision was not recorded', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
    await error.getByRole('button', { name: 'Try again' }).click();

    await expect(page.getByTestId('mentorship-program-review-confirm')).toBeVisible({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
  });
});

test.describe('Program review — outcome states', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('shows the current status when the program was already decided', async ({ page }) => {
    await stubProgramReview(page, 200, { status: 'published' });
    await openProgramReview(page);

    await expect(page.getByTestId('mentorship-program-review-already-decided')).toContainText('current status: Approved', {
      timeout: PROGRAM_REVIEW_LOAD_TIMEOUT,
    });
    await expect(page.getByTestId('mentorship-program-review-confirm')).toHaveCount(0);
  });

  for (const [status, testId, copy] of [
    [403, 'mentorship-program-review-forbidden', "You don't have permission to review programs"],
    [404, 'mentorship-program-review-not-found', 'Program not found'],
    [503, 'mentorship-program-review-error', "We couldn't load this program"],
  ] as const) {
    test(`explains a ${status} on load`, async ({ page }) => {
      await stubProgramReview(page, status);
      await openProgramReview(page);

      await expect(page.getByTestId(testId)).toContainText(copy, { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
    });
  }

  test('treats a link with an unknown decision as invalid', async ({ page }) => {
    await gotoProgramReview(page, 'publish');

    await expect(page.getByTestId('mentorship-program-review-invalid-link')).toContainText('This review link is not valid', {
      timeout: PROGRAM_REVIEW_LOAD_TIMEOUT,
    });
  });
});
