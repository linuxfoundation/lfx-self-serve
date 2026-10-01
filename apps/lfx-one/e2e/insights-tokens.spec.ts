// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * LFX Insights API tokens (IN-1233) — Developer Settings group, content spec.
 *
 * Locks each branch of `lfx-insights-tokens` in place (KB: `code-truthiness/missing-e2e-for-empty-state`):
 * empty state, non-Key-Contact lock notice, failed eligibility check, list load error, and the
 * create → one-time reveal flow. The structural data-testid contract lives in
 * insights-tokens-robust.spec.ts; route stubs and fixtures in ./helpers/insights-tokens.helper.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { CHECK_FAILED, CREATED, DATA_LOAD_TIMEOUT, ELIGIBLE, NOT_KEY_CONTACT, openInsightsTokens } from './helpers/insights-tokens.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

test.describe('LFX Insights API tokens', () => {
  test('shows the empty state with a create CTA for an eligible Key Contact', async ({ page }) => {
    await openInsightsTokens(page, { tokens: [], eligibility: ELIGIBLE });

    await expect(page.getByTestId('insights-tokens-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('insights-tokens-empty-new-button')).toBeVisible();
    await expect(page.getByTestId('insights-tokens-lock-notice')).toHaveCount(0);
  });

  test('shows the lock notice and no create CTA for a non-Key-Contact', async ({ page }) => {
    await openInsightsTokens(page, { tokens: [], eligibility: NOT_KEY_CONTACT });

    await expect(page.getByTestId('insights-tokens-lock-notice')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('insights-tokens-empty')).toHaveCount(0);
    await expect(page.getByTestId('insights-tokens-new-button')).toHaveCount(0);
  });

  test('shows a retryable notice instead of the lock notice when eligibility could not be verified', async ({ page }) => {
    await openInsightsTokens(page, { tokens: [], eligibility: CHECK_FAILED });

    await expect(page.getByTestId('insights-tokens-eligibility-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('insights-tokens-eligibility-retry-button')).toBeVisible();
    await expect(page.getByTestId('insights-tokens-lock-notice')).toHaveCount(0);
  });

  test('shows a retryable error state when the token list fails to load', async ({ page }) => {
    await openInsightsTokens(page, { tokens: { status: 503 }, eligibility: ELIGIBLE });

    await expect(page.getByTestId('insights-tokens-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('insights-tokens-retry-button')).toBeVisible();
    await expect(page.getByTestId('insights-tokens-empty')).toHaveCount(0);
  });

  test('creates a token, reveals the secret once, and lists the new row', async ({ page }) => {
    await openInsightsTokens(page, { tokens: [], eligibility: ELIGIBLE });

    await page.getByTestId('insights-tokens-empty-new-button').click();
    // lfx-input-text renders its dataTest as `data-test`, not `data-testid`.
    await page.locator('[data-test="insights-token-create-name-input"]').fill('ci-pipeline');
    await page.getByTestId('insights-token-create-submit-button').click();

    await expect(page.getByTestId('insights-token-reveal-secret')).toHaveText(CREATED.secret, { timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('insights-token-reveal-close-button').click();

    const row = page.getByTestId(`insights-tokens-row-${CREATED.token.uid}`);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('insights-tokens-name')).toHaveText('ci-pipeline');
    await expect(row.getByTestId('insights-tokens-value')).toHaveText('lfi_Ab3kZ9QmT2xL********');
    await expect(page.getByText(CREATED.secret)).toHaveCount(0);
  });
});
