// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * LFX Insights API tokens (IN-1233) — Developer Settings group, content spec.
 *
 * Locks each branch of `lfx-insights-tokens` in place (KB: `code-truthiness/missing-e2e-for-empty-state`):
 * empty state, not-enabled lock notice, failed eligibility check, list load error, and the
 * create → one-time reveal flow. The structural data-testid contract lives in
 * insights-tokens-robust.spec.ts; route stubs and fixtures in ./helpers/insights-tokens.helper.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { CHECK_FAILED, CREATED, DATA_LOAD_TIMEOUT, ELIGIBLE, EXPIRED_TOKEN, NOT_ENABLED, openInsightsTokens } from './helpers/insights-tokens.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

test.describe('LFX Insights API tokens', () => {
  test('shows the empty state with a create CTA for a user with access', async ({ page }) => {
    await openInsightsTokens(page, { tokens: [], eligibility: ELIGIBLE });

    await expect(page.getByTestId('insights-tokens-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('insights-tokens-empty-new-button')).toBeVisible();
    await expect(page.getByTestId('insights-tokens-lock-notice')).toHaveCount(0);
  });

  test('shows the lock notice and no create CTA for a user without access', async ({ page }) => {
    await openInsightsTokens(page, { tokens: [], eligibility: NOT_ENABLED });

    const notice = page.getByTestId('insights-tokens-lock-notice');
    await expect(notice).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(notice).toContainText("LFX Insights API tokens aren't enabled for your account yet");
    await expect(notice.getByTestId('insights-tokens-contact-support')).toHaveText('LFX Support');
    await expect(page.getByTestId('insights-tokens-empty')).toHaveCount(0);
    await expect(page.getByTestId('insights-tokens-new-button')).toHaveCount(0);
  });

  test('shows a retryable notice instead of the lock notice when eligibility could not be verified', async ({ page }) => {
    await openInsightsTokens(page, { tokens: [], eligibility: CHECK_FAILED });

    const notice = page.getByTestId('insights-tokens-eligibility-error');
    await expect(notice).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(notice).toContainText("We couldn't check if you are eligible");
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

    const createRequest = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/profile/insights-tokens');
    await page.getByTestId('insights-tokens-empty-new-button').click();
    // lfx-input-text renders its dataTest as `data-test`, not `data-testid`.
    await page.locator('[data-test="insights-token-create-name-input"]').fill('ci-pipeline');
    await expect(page.getByTestId('insights-token-create-expiration-help')).toContainText('Expires on');
    await page.getByTestId('insights-token-create-submit-button').click();
    expect((await createRequest).postDataJSON()).toEqual({ name: 'ci-pipeline', expiration: '90d' });

    await expect(page.getByTestId('insights-token-reveal-secret')).toHaveText(CREATED.secret, { timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('insights-token-reveal-close-button').click();

    const row = page.getByTestId(`insights-tokens-row-${CREATED.token.uid}`);
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId('insights-tokens-name')).toHaveText('ci-pipeline');
    await expect(row.getByTestId('insights-tokens-value')).toHaveText('lfi_Ab3kZ9QmT2xL********');
    await expect(row.getByTestId('insights-tokens-meta')).toContainText('Expires');
    await expect(page.getByText(CREATED.secret)).toHaveCount(0);
  });

  test('shows an expired token with its expiry date and removes it without asking to confirm', async ({ page }) => {
    await page.route('**/api/profile/insights-tokens/*', (route) =>
      route.request().method() === 'DELETE' ? route.fulfill({ status: 204 }) : route.fallback()
    );
    await openInsightsTokens(page, { tokens: [EXPIRED_TOKEN], eligibility: ELIGIBLE });

    const row = page.getByTestId(`insights-tokens-row-${EXPIRED_TOKEN.uid}`);
    await expect(row.getByTestId('insights-tokens-meta')).toContainText('Expired 1 Apr 2026', { timeout: DATA_LOAD_TIMEOUT });
    await row.getByTestId('insights-tokens-remove-button').click();

    await expect(row).toHaveCount(0);
    await expect(page.getByText('Token removed.')).toBeVisible();
  });
});
