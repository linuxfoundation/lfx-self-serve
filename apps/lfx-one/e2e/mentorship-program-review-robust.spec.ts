// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Program review page — structural / data-testid contract.
 *
 * Companion to `mentorship-program-review.spec.ts` (program details, decision flow, outcome copy).
 * This spec asserts presence, nesting, the dynamic `mentorship-program-review-<state>` suffix of the
 * error states, and the loading state without user-facing copy.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import {
  gotoProgramReview,
  openProgramReview,
  PROGRAM_REVIEW_LOAD_TIMEOUT,
  reviewProgram,
  stubProgramDecision,
  stubProgramReview,
} from './helpers/program-review.helper';

test.beforeEach(() => skipWhenAuthMissing());

const ELEMENT_TIMEOUT = 10_000;

test.setTimeout(60_000);

test.describe('Program review — Robust Tests', () => {
  test.describe('Data-testid presence', () => {
    test('nests the program sections and the review card inside the page root', async ({ page }) => {
      await stubProgramReview(page, 200, reviewProgram());
      await openProgramReview(page);

      const root = page.getByTestId('mentorship-program-review');
      const summary = root.getByTestId('mentorship-program-review-summary');
      await expect(summary).toBeAttached({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
      await expect(summary.getByTestId('mentorship-program-review-title')).toBeAttached();
      await expect(summary.getByTestId('mentorship-program-review-status')).toBeAttached();

      const details = root.getByTestId('mentorship-program-review-details');
      await expect(details.getByTestId('mentorship-program-review-description')).toBeAttached();
      await expect(details.getByTestId('mentorship-program-review-skills')).toBeAttached();
      await expect(details.getByTestId('mentorship-program-review-repo').getByTestId('mentorship-program-review-repo-link')).toBeAttached();
      await expect(details.getByTestId('mentorship-program-review-coc').getByTestId('mentorship-program-review-coc-link')).toBeAttached();
      await expect(details.getByTestId('mentorship-program-review-cii').getByTestId('mentorship-program-review-cii-link')).toBeAttached();

      const choice = root.getByTestId('mentorship-program-review-request').getByTestId('mentorship-program-review-choice');
      await expect(choice.getByTestId('mentorship-program-review-approve').getByRole('button')).toHaveCount(1);
      await expect(choice.getByTestId('mentorship-program-review-reject').getByRole('button')).toHaveCount(1);
      await expect(page.getByTestId('mentorship-program-review-loading')).toHaveCount(0);
    });

    test('swaps the choice for the reject step and back', async ({ page }) => {
      await stubProgramReview(page, 200, reviewProgram());
      await openProgramReview(page);

      await page.getByTestId('mentorship-program-review-reject').getByRole('button').click({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
      const step = page.getByTestId('mentorship-program-review-reject-step');
      await expect(step.getByTestId('mentorship-program-review-reject-confirm').getByRole('button')).toHaveCount(1);
      await expect(page.getByTestId('mentorship-program-review-choice')).toHaveCount(0);

      await step.getByTestId('mentorship-program-review-reject-cancel').getByRole('button').click();
      await expect(page.getByTestId('mentorship-program-review-choice')).toBeAttached();
      await expect(step).toHaveCount(0);
    });
  });

  test.describe('State container suffix', () => {
    for (const [label, status, state] of [
      ['a 403', 403, 'forbidden'],
      ['a 404', 404, 'not-found'],
      ['a 503', 503, 'error'],
    ] as const) {
      test(`resolves ${label} to the ${state} container`, async ({ page }) => {
        await stubProgramReview(page, status);
        await openProgramReview(page);

        const container = page.getByTestId('mentorship-program-review').getByTestId(`mentorship-program-review-${state}`);
        await expect(container).toHaveAttribute('role', 'status', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
        await expect(page.getByTestId('mentorship-program-review-request')).toHaveCount(0);
      });
    }

    test('swaps the choice for the approved status after Approve program', async ({ page }) => {
      await stubProgramReview(page, 200, reviewProgram());
      await stubProgramDecision(page, 200);
      await openProgramReview(page);

      await page.getByTestId('mentorship-program-review-approve').getByRole('button').click({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });

      await expect(page.getByTestId('mentorship-program-review-approved')).toHaveAttribute('role', 'status', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
      await expect(page.getByTestId('mentorship-program-review-choice')).toHaveCount(0);
    });

    test('resolves a link with a program slug to the invalid-link container', async ({ page }) => {
      await gotoProgramReview(page, '', 'mp_gridflow_fall26');

      await expect(page.getByTestId('mentorship-program-review-invalid-link')).toHaveAttribute('role', 'status', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
    });
  });

  test.describe('Loading state', () => {
    test('shows the loading testid until the program arrives', async ({ page }) => {
      await stubProgramReview(page, 200, reviewProgram(), 3_000);
      await gotoProgramReview(page);

      const loading = page.getByTestId('mentorship-program-review-loading');
      const request = page.getByTestId('mentorship-program-review-request');
      await expect(loading).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(request).toHaveCount(0);

      await expect(request).toBeAttached({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
      await expect(loading).toHaveCount(0);
    });
  });
});
