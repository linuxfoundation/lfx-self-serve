// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Program review page — structural / data-testid contract.
 *
 * Companion to `mentorship-program-review.spec.ts` (confirm flow + outcome copy).
 * This spec asserts presence, nesting, the dynamic `mentorship-program-review-<state>`
 * suffix, and the loading state without user-facing copy.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import {
  enableMentorshipFlag,
  gotoProgramReview,
  openProgramReview,
  PROGRAM_REVIEW_LOAD_TIMEOUT,
  stubProgramDecision,
  stubProgramReview,
} from './helpers/program-review.helper';

test.beforeEach(() => skipWhenAuthMissing());

const ELEMENT_TIMEOUT = 10_000;

test.setTimeout(60_000);

test.describe('Program review — Robust Tests', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test.describe('Data-testid presence', () => {
    test('nests the confirm card and its actions inside the page root', async ({ page }) => {
      await stubProgramReview(page, 200, { status: 'pending' });
      await openProgramReview(page);

      const root = page.getByTestId('mentorship-program-review');
      const confirm = root.getByTestId('mentorship-program-review-confirm');
      await expect(confirm).toBeAttached({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
      await expect(confirm.getByTestId('mentorship-program-review-title')).toBeAttached();
      await expect(confirm.getByTestId('mentorship-program-review-program-name')).toBeAttached();
      await expect(confirm.getByTestId('mentorship-program-review-cancel')).toBeAttached();
      await expect(confirm.getByTestId('mentorship-program-review-confirm-button').getByRole('button')).toHaveCount(1);
      await expect(page.getByTestId('mentorship-program-review-loading')).toHaveCount(0);
    });
  });

  test.describe('State container suffix', () => {
    for (const [label, status, program, state] of [
      ['an already-decided program', 200, { status: 'published' }, 'already-decided'],
      ['a 403', 403, undefined, 'forbidden'],
      ['a 404', 404, undefined, 'not-found'],
      ['a 503', 503, undefined, 'error'],
    ] as const) {
      test(`resolves ${label} to the ${state} container`, async ({ page }) => {
        await stubProgramReview(page, status, program);
        await openProgramReview(page);

        const container = page.getByTestId('mentorship-program-review').getByTestId(`mentorship-program-review-${state}`);
        await expect(container).toHaveAttribute('role', 'status', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
        await expect(page.getByTestId('mentorship-program-review-confirm')).toHaveCount(0);
      });
    }

    test('swaps the confirm card for the success container after Confirm', async ({ page }) => {
      await stubProgramReview(page, 200, { status: 'pending' });
      await stubProgramDecision(page, 200);
      await openProgramReview(page);

      await page.getByTestId('mentorship-program-review-confirm-button').getByRole('button').click({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });

      await expect(page.getByTestId('mentorship-program-review-success')).toHaveAttribute('role', 'status', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
      await expect(page.getByTestId('mentorship-program-review-confirm')).toHaveCount(0);
    });

    test('resolves a link without a valid decision to the invalid-link container', async ({ page }) => {
      await gotoProgramReview(page, 'publish');

      await expect(page.getByTestId('mentorship-program-review-invalid-link')).toHaveAttribute('role', 'status', { timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
    });
  });

  test.describe('Loading state', () => {
    test('shows the loading testid until the program arrives', async ({ page }) => {
      await stubProgramReview(page, 200, { status: 'pending' }, 3_000);
      await gotoProgramReview(page);

      const loading = page.getByTestId('mentorship-program-review-loading');
      const confirm = page.getByTestId('mentorship-program-review-confirm');
      await expect(loading).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(confirm).toHaveCount(0);

      await expect(confirm).toBeAttached({ timeout: PROGRAM_REVIEW_LOAD_TIMEOUT });
      await expect(loading).toHaveCount(0);
    });
  });
});
