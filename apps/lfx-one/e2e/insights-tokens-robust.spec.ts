// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * LFX Insights API tokens (IN-1233) — Developer Settings group, structural spec.
 *
 * Asserts the data-testid contract `lfx-insights-tokens` and its dialogs promise to maintain:
 * group/list/row ids and per-row nesting, which state container renders for each eligibility
 * outcome, and the create/reveal dialog ids. Kept free of user-facing copy so a wording change
 * breaks only the content spec (insights-tokens.spec.ts).
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { CHECK_FAILED, DATA_LOAD_TIMEOUT, ELIGIBLE, EXISTING_TOKENS, NOT_KEY_CONTACT, openInsightsTokens } from './helpers/insights-tokens.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

test.describe('LFX Insights API tokens — Robust Tests', () => {
  test.describe('Token list', () => {
    test('renders one row per token, each with name, value, meta and revoke ids', async ({ page }) => {
      await openInsightsTokens(page, { tokens: EXISTING_TOKENS, eligibility: ELIGIBLE });

      const list = page.getByTestId('insights-tokens-list');
      await expect(list).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
      await expect(list.locator('[data-testid^="insights-tokens-row-"]')).toHaveCount(EXISTING_TOKENS.length);
      for (const token of EXISTING_TOKENS) {
        const row = list.getByTestId(`insights-tokens-row-${token.uid}`);
        await expect(row).toHaveCount(1);
        await expect(row.getByTestId('insights-tokens-name')).toHaveCount(1);
        await expect(row.getByTestId('insights-tokens-value')).toHaveCount(1);
        await expect(row.getByTestId('insights-tokens-meta')).toHaveCount(1);
        await expect(row.getByTestId('insights-tokens-revoke-button')).toHaveCount(1);
      }
      await expect(page.getByTestId('insights-tokens-loading')).toHaveCount(0);
      await expect(page.getByTestId('insights-tokens-empty')).toHaveCount(0);
      await expect(page.getByTestId('insights-tokens-error')).toHaveCount(0);
    });

    test('keeps revoke available to a user who is no longer a Key Contact', async ({ page }) => {
      await openInsightsTokens(page, { tokens: EXISTING_TOKENS, eligibility: NOT_KEY_CONTACT });

      await expect(page.getByTestId('insights-tokens-revoke-button')).toHaveCount(EXISTING_TOKENS.length, { timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('insights-tokens-lock-notice')).toBeAttached();
      await expect(page.getByTestId('insights-tokens-new-button')).toHaveCount(0);
    });
  });

  test.describe('Eligibility states', () => {
    test('eligible: header create CTA, no lock or eligibility-error container', async ({ page }) => {
      await openInsightsTokens(page, { tokens: EXISTING_TOKENS, eligibility: ELIGIBLE });

      await expect(page.getByTestId('insights-tokens-new-button')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('insights-tokens-lock-notice')).toHaveCount(0);
      await expect(page.getByTestId('insights-tokens-eligibility-error')).toHaveCount(0);
    });

    test('check failed: eligibility-error container with retry, never the lock notice', async ({ page }) => {
      await openInsightsTokens(page, { tokens: [], eligibility: CHECK_FAILED });

      const notice = page.getByTestId('insights-tokens-eligibility-error');
      await expect(notice).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
      await expect(notice.getByTestId('insights-tokens-eligibility-retry-button')).toHaveCount(1);
      await expect(page.getByTestId('insights-tokens-lock-notice')).toHaveCount(0);
      await expect(page.getByTestId('insights-tokens-new-button')).toHaveCount(0);
      await expect(page.getByTestId('insights-tokens-empty-new-button')).toHaveCount(0);
    });
  });

  test.describe('Dialogs', () => {
    test('create dialog exposes name, org, submit and cancel ids', async ({ page }) => {
      await openInsightsTokens(page, { tokens: [], eligibility: ELIGIBLE });

      await page.getByTestId('insights-tokens-empty-new-button').click();
      const dialog = page.getByTestId('insights-token-create-dialog');
      await expect(dialog).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
      // lfx-input-text renders its dataTest as `data-test`, not `data-testid`.
      await expect(dialog.locator('[data-test="insights-token-create-name-input"]')).toHaveCount(1);
      await expect(dialog.getByTestId('insights-token-create-org')).toHaveCount(1);
      await expect(dialog.getByTestId('insights-token-create-submit-button')).toHaveCount(1);
      await expect(dialog.getByTestId('insights-token-create-cancel-button')).toHaveCount(1);
      await expect(dialog.getByTestId('insights-token-create-error')).toHaveCount(0);
    });

    test('reveal dialog exposes secret, copy, warning and close ids', async ({ page }) => {
      await openInsightsTokens(page, { tokens: [], eligibility: ELIGIBLE });

      await page.getByTestId('insights-tokens-empty-new-button').click();
      await page.locator('[data-test="insights-token-create-name-input"]').fill('ci-pipeline');
      await page.getByTestId('insights-token-create-submit-button').click();

      const dialog = page.getByTestId('insights-token-reveal-dialog');
      await expect(dialog).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
      await expect(dialog.getByTestId('insights-token-reveal-secret')).toHaveCount(1);
      await expect(dialog.getByTestId('insights-token-reveal-copy-button')).toHaveCount(1);
      await expect(dialog.getByTestId('insights-token-reveal-warning')).toHaveCount(1);
      await expect(dialog.getByTestId('insights-token-reveal-close-button')).toHaveCount(1);
    });
  });
});
