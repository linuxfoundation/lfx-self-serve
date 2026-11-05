// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Program review page — where a reviewer sees a program awaiting approval and approves or rejects
 * it; the review email links here (KB: `code-truthiness/missing-e2e-for-empty-state`).
 *
 * Content spec: the program details and their empty states, the decision flow, and the copy each
 * outcome shows. The data-testid contract lives in the companion
 * `mentorship-program-review-robust.spec.ts`.
 *
 * The BFF endpoints are stubbed per test so each state renders independently of upstream data and
 * of whether the signed-in test user is on the mentorship approver team.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import {
  DECISION_API,
  gotoProgramReview,
  openProgramReview,
  PROGRAM_ID,
  PROGRAM_REVIEW_LOAD_TIMEOUT,
  reviewProgram,
  stubProgramDecision,
  stubProgramReview,
} from './helpers/program-review.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

test.describe('Program review — program details', () => {
  test('shows the program and its links', async ({ page }) => {
    await stubProgramReview(page, 200, reviewProgram());
    await openProgramReview(page);

    await expect(page.getByTestId('mentorship-program-review-title')).toHaveText('Test Program', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-program-review-status')).toContainText('Pending review');
    await expect(page.getByTestId('mentorship-program-review-project')).toContainText('Test Foundation');
    await expect(page.getByTestId('mentorship-program-review-description')).toContainText('Learn the codebase.');
    await expect(page.getByTestId('mentorship-program-review-skills-count')).toContainText('2 skills');
    await expect(page.getByTestId('mentorship-program-review-repo-link')).toHaveAttribute('href', 'https://github.com/test-org/test-repo');
    await expect(page.getByTestId('mentorship-program-review-coc-link')).toHaveAttribute('href', 'https://test-org.example/coc');
    await expect(page.getByTestId('mentorship-program-review-cii-link')).toHaveAttribute('href', 'https://www.bestpractices.dev/projects/1234');
  });

  test('shows the empty state of each missing detail', async ({ page }) => {
    await stubProgramReview(
      page,
      200,
      reviewProgram({ projectName: null, description: null, repoUrl: null, codeOfConductUrl: null, ciiProjectId: null, skills: [] })
    );
    await openProgramReview(page);

    await expect(page.getByTestId('mentorship-program-review-logo-initial')).toHaveText('T', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-program-review-description-empty')).toHaveText('No description provided.');
    await expect(page.getByTestId('mentorship-program-review-skills-empty')).toHaveText('No skills listed.');
    for (const card of ['repo', 'coc', 'cii']) {
      await expect(page.getByTestId(`mentorship-program-review-${card}`)).toContainText('Not provided');
    }
  });
});

test.describe('Program review — decision flow', () => {
  test.beforeEach(async ({ page }) => {
    await stubProgramReview(page, 200, reviewProgram());
  });

  test('records nothing until Approve program is clicked', async ({ page }) => {
    let decisionPosts = 0;
    await page.route(DECISION_API, (route) => {
      decisionPosts += 1;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: PROGRAM_ID, name: 'Test Program', status: 'published' }),
      });
    });

    await openProgramReview(page, '?decision=approve');
    expect(decisionPosts).toBe(0);

    await page.getByTestId('mentorship-program-review-approve').getByRole('button').click({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-program-review-approved')).toContainText('Program approved', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-program-review-status')).toContainText('Approved');
    expect(decisionPosts).toBe(1);
  });

  test('opens a reject link on the reject step and rejects on confirm', async ({ page }) => {
    await stubProgramDecision(page, 200, 'rejected');
    await openProgramReview(page, '?decision=reject');

    await expect(page.getByTestId('mentorship-program-review-reject-step')).toContainText('Reject this program?', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
    await page.getByTestId('mentorship-program-review-reject-confirm').getByRole('button').click();

    await expect(page.getByTestId('mentorship-program-review-rejected')).toContainText('Program rejected', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
  });

  test('says another reviewer decided first on a 409', async ({ page }) => {
    await stubProgramDecision(page, 409);
    await openProgramReview(page);

    // The page reloads the program after a 409; the reload now returns the status the other reviewer recorded.
    await page.unroute(`**/api/mentorship/program-review/${PROGRAM_ID}`);
    await stubProgramReview(page, 200, reviewProgram({ status: 'rejected', hasDetails: false }));
    await page.getByTestId('mentorship-program-review-approve').getByRole('button').click({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-program-review-conflict')).toContainText('Another reviewer decided this program before you.', {
      timeout: PROGRAM_REVIEW_LOAD_TIMEOUT,
    });
    await expect(page.getByTestId('mentorship-program-review-rejected')).toBeVisible();
  });

  test('keeps the program on screen after a failed decision', async ({ page }) => {
    await stubProgramDecision(page, 502);
    await openProgramReview(page);

    await page.getByTestId('mentorship-program-review-approve').getByRole('button').click({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-program-review-failed')).toContainText('The decision was not recorded', {
      timeout: PROGRAM_REVIEW_LOAD_TIMEOUT,
    });
    await expect(page.getByTestId('mentorship-program-review-choice')).toBeVisible();
  });
});

test.describe('Program review — outcome states', () => {
  for (const [status, testId, copy] of [
    ['published', 'mentorship-program-review-approved', 'Program approved'],
    ['rejected', 'mentorship-program-review-rejected', 'Program rejected'],
    ['hidden', 'mentorship-program-review-not-pending', 'Current status: Hidden'],
  ] as const) {
    test(`shows a ${status} program without the decision buttons`, async ({ page }) => {
      // The BFF reads a rejected or hidden program without its details (the catalog serves only pending and published ones).
      await stubProgramReview(page, 200, reviewProgram({ status, hasDetails: status === 'published' }));
      await openProgramReview(page);

      await expect(page.getByTestId(testId)).toContainText(copy, { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
      await expect(page.getByTestId('mentorship-program-review-choice')).toHaveCount(0);
    });
  }

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

  test('treats a link with a program slug as invalid', async ({ page }) => {
    await gotoProgramReview(page, '', 'mp_gridflow_fall26');

    await expect(page.getByTestId('mentorship-program-review-invalid-link')).toContainText('This review link is not valid', {
      timeout: PROGRAM_REVIEW_LOAD_TIMEOUT,
    });
  });
});
