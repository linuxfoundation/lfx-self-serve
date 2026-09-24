// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Program review page — the landing page for the approve/reject links in the program-review email
 * (KB: `code-truthiness/missing-e2e-for-empty-state`).
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

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MENTORSHIP_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';

test.beforeEach(() => skipWhenAuthMissing());

const PROGRAM_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const REVIEW_URL = `/mentorship/program-review/${PROGRAM_ID}`;
const REVIEW_API = `**/api/mentorship/program-review/${PROGRAM_ID}`;
const DECISION_API = `${REVIEW_API}/decision`;
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(60_000);

async function enableMentorshipFlag(page: Page): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [MENTORSHIP_ENABLED_FLAG]: true }),
  ] as const);
}

async function stubReview(page: Page, status: number, program?: { status: string }): Promise<void> {
  await page.route(REVIEW_API, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(program ? { id: PROGRAM_ID, name: 'Test Program', status: program.status } : { error: 'stubbed' }),
    })
  );
}

async function openReview(page: Page, decision: string = 'approve'): Promise<void> {
  await page.goto(`${REVIEW_URL}?decision=${decision}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Program review — confirm flow', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubReview(page, 200, { status: 'pending' });
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

    await openReview(page);

    await expect(page.getByTestId('mentorship-program-review-title')).toContainText('Approve this program?', { timeout: DATA_LOAD_TIMEOUT });
    expect(decisionPosts).toBe(0);

    await page.getByTestId('mentorship-program-review-confirm-button').getByRole('button').click();

    await expect(page.getByTestId('mentorship-program-review-success')).toContainText('Program approved', { timeout: DATA_LOAD_TIMEOUT });
    expect(decisionPosts).toBe(1);
  });

  test('explains a 409 on Confirm as another reviewer deciding first', async ({ page }) => {
    await page.route(DECISION_API, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'stubbed' }) }));

    await openReview(page, 'reject');
    await page.getByTestId('mentorship-program-review-confirm-button').getByRole('button').click({ timeout: DATA_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-program-review-already-decided')).toContainText('Another reviewer decided this program', {
      timeout: DATA_LOAD_TIMEOUT,
    });
  });
});

test.describe('Program review — outcome states', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('shows the current status when the program was already decided', async ({ page }) => {
    await stubReview(page, 200, { status: 'published' });
    await openReview(page);

    await expect(page.getByTestId('mentorship-program-review-already-decided')).toContainText('current status: Approved', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-program-review-confirm')).toHaveCount(0);
  });

  for (const [status, testId] of [
    [403, 'mentorship-program-review-forbidden'],
    [404, 'mentorship-program-review-not-found'],
    [503, 'mentorship-program-review-error'],
  ] as const) {
    test(`maps a ${status} on load to its own state`, async ({ page }) => {
      await stubReview(page, status);
      await openReview(page);

      await expect(page.getByTestId(testId)).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('mentorship-program-review-confirm')).toHaveCount(0);
    });
  }

  test('treats a link with an unknown decision as invalid', async ({ page }) => {
    await openReview(page, 'publish');

    await expect(page.getByTestId('mentorship-program-review-invalid-link')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });
});
