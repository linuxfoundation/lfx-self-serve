// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { expect, test } from '@playwright/test';

const ENROLLMENT_URL = '/profile/individual-enrollment';
const DATA_LOAD_TIMEOUT = 15_000;

test.setTimeout(60_000);

test.describe('Individual Enrollment — Structural Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ENROLLMENT_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    // Wait for either the loading skeleton or an actual content region to appear
    await expect(
      page
        .getByTestId('individual-enrollment-loading')
        .or(page.getByTestId('individual-enrollment-card'))
        .or(page.getByTestId('individual-enrollment-empty'))
        .or(page.getByTestId('individual-enrollment-error'))
    ).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test.describe('Page root', () => {
    test('should have root container', async ({ page }) => {
      await expect(page.getByTestId('individual-enrollment-page')).toBeAttached();
    });
  });

  test.describe('Card structure (demo user path)', () => {
    test('should render at least one enrollment card', async ({ page }) => {
      const card = page.getByTestId('individual-enrollment-card').first();
      await expect(card).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    });

    test('should show a status chip on the card', async ({ page }) => {
      await page.getByTestId('individual-enrollment-card').first().waitFor({ state: 'visible', timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('individual-enrollment-status').first()).toBeAttached();
    });

    test('should show enrollment details section', async ({ page }) => {
      await page.getByTestId('individual-enrollment-card').first().waitFor({ state: 'visible', timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('individual-enrollment-details').first()).toBeAttached();
    });

    test('should show enrollment CTA section', async ({ page }) => {
      await page.getByTestId('individual-enrollment-card').first().waitFor({ state: 'visible', timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('individual-enrollment-cta').first()).toBeAttached();
    });
  });

  test.describe('Auto-renew row', () => {
    test('should NOT show the toggle for non-Stripe memberships', async ({ page }) => {
      // Demo user has ExtPaymentType: '836366' (not 'stripe') — toggle must not render
      await page.getByTestId('individual-enrollment-card').first().waitFor({ state: 'visible', timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('individual-enrollment-auto-renew-toggle')).not.toBeAttached();
    });
  });

  test.describe('Confirm dialog testid hook', () => {
    test('should have confirm dialog attached in DOM (not visible until triggered)', async ({ page }) => {
      await page.getByTestId('individual-enrollment-card').first().waitFor({ state: 'visible', timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('individual-enrollment-confirm-dialog')).toBeAttached();
    });
  });
});

test.describe('Individual Enrollment — Mocked State Tests', () => {
  test.describe('Empty / error states', () => {
    test('should show empty state when no enrollments exist', async ({ page }) => {
      await page.route('**/api/enrollments', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      await page.goto(ENROLLMENT_URL, { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/auth0\.com/);
      await expect(page.getByTestId('individual-enrollment-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    });

    test('should show error state when API fails', async ({ page }) => {
      await page.route('**/api/enrollments', async (route) => {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal server error' }) });
      });
      await page.goto(ENROLLMENT_URL, { waitUntil: 'domcontentloaded' });
      await expect(page).not.toHaveURL(/auth0\.com/);
      await expect(page.getByTestId('individual-enrollment-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    });
  });
});
