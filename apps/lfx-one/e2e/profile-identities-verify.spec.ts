// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

test.describe('Identities Verify Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    // Wait for either section to render
    await expect(page.getByTestId('unverified-identities-section').or(page.getByTestId('verified-identities-section'))).toBeVisible({ timeout: 10000 });
  });

  test.describe('Identities listing', () => {
    test('should display all 5 identity rows', async ({ page }) => {
      const ids = ['idf-1', 'idf-2', 'idf-3', 'idf-5', 'idf-6'];
      for (const id of ids) {
        await expect(page.getByTestId(`identity-row-${id}`)).toBeVisible();
      }
    });

    test('should show identifiers in rows', async ({ page }) => {
      // Verified identities
      await expect(page.getByTestId('identity-row-idf-1')).toContainText('john.doe@example.com');
      await expect(page.getByTestId('identity-row-idf-3')).toContainText('johndoe');
      await expect(page.getByTestId('identity-row-idf-5')).toContainText('johndoe');

      // Unverified identities
      await expect(page.getByTestId('identity-row-idf-2')).toContainText('jdoe@company.org');
      await expect(page.getByTestId('identity-row-idf-6')).toContainText('john-doe-engineer');
    });

    test('should show unverified identities in unverified section', async ({ page }) => {
      const section = page.getByTestId('unverified-identities-section');
      await expect(section.getByTestId('identity-row-idf-2')).toBeVisible();
      await expect(section.getByTestId('identity-row-idf-6')).toBeVisible();
    });

    test('should show verified identities in verified section', async ({ page }) => {
      const section = page.getByTestId('verified-identities-section');
      await expect(section.getByTestId('identity-row-idf-1')).toBeVisible();
      await expect(section.getByTestId('identity-row-idf-3')).toBeVisible();
      await expect(section.getByTestId('identity-row-idf-5')).toBeVisible();
    });
  });

  test.describe('Verify button visibility', () => {
    test('should show Verify buttons only on unverified identities', async ({ page }) => {
      // Unverified identities should have Verify buttons
      await expect(page.getByTestId('verify-btn-idf-2')).toBeVisible();
      await expect(page.getByTestId('verify-btn-idf-6')).toBeVisible();

      // Verified identities should NOT have Verify buttons
      await expect(page.getByTestId('verify-btn-idf-1')).not.toBeAttached();
      await expect(page.getByTestId('verify-btn-idf-3')).not.toBeAttached();
      await expect(page.getByTestId('verify-btn-idf-5')).not.toBeAttached();
    });
  });

  test.describe('Dialog open and content', () => {
    test('should open verify dialog for email identity (idf-2)', async ({ page }) => {
      // Click the Verify button (inner <button> inside lfx-button)
      await page.getByTestId('verify-btn-idf-2').locator('button').click();

      // Dialog should appear
      const dialog = page.getByTestId('verify-identity-dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      // Should show provider name and identifier
      await expect(dialog).toContainText('Email');
      await expect(dialog).toContainText('jdoe@company.org');

      // Should show description text
      await expect(dialog).toContainText('Verify this identity to confirm it belongs to you');

      // Should show info box
      await expect(dialog).toContainText('Clicking verify will link this Email account');
    });

    test('should open verify dialog for LinkedIn identity (idf-6)', async ({ page }) => {
      await page.getByTestId('verify-btn-idf-6').locator('button').click();

      const dialog = page.getByTestId('verify-identity-dialog');
      await expect(dialog).toBeVisible({ timeout: 5000 });

      await expect(dialog).toContainText('LinkedIn');
      await expect(dialog).toContainText('john-doe-engineer');
    });

    test('should show "Verify identity" as dialog header', async ({ page }) => {
      await page.getByTestId('verify-btn-idf-2').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).toBeVisible({ timeout: 5000 });

      // PrimeNG dynamic dialog header
      const dialogTitle = page.locator('.p-dialog-title');
      await expect(dialogTitle).toContainText('Verify identity');
    });
  });

  test.describe('Confirm action', () => {
    test('should move identity from unverified to verified section after confirming', async ({ page }) => {
      // idf-2 should be in unverified section before
      const unverifiedSection = page.getByTestId('unverified-identities-section');
      await expect(unverifiedSection.getByTestId('identity-row-idf-2')).toBeVisible();

      // Open dialog for idf-2
      await page.getByTestId('verify-btn-idf-2').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).toBeVisible({ timeout: 5000 });

      // Click Verify Identity (confirm button)
      await page.getByTestId('verify-confirm').locator('button').click();

      // Dialog should close
      await expect(page.getByTestId('verify-identity-dialog')).not.toBeAttached({ timeout: 5000 });

      // Verify button should be gone from idf-2
      await expect(page.getByTestId('verify-btn-idf-2')).not.toBeAttached();

      // idf-2 should now be in verified section
      const verifiedSection = page.getByTestId('verified-identities-section');
      await expect(verifiedSection.getByTestId('identity-row-idf-2')).toBeVisible();
    });

    test('should not affect other unverified identity when verifying one', async ({ page }) => {
      // Verify idf-2
      await page.getByTestId('verify-btn-idf-2').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('verify-confirm').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).not.toBeAttached({ timeout: 5000 });

      // idf-6 should still have its Verify button
      await expect(page.getByTestId('verify-btn-idf-6')).toBeVisible();
    });
  });

  test.describe('Cancel action', () => {
    test('should leave identity unchanged when cancelling', async ({ page }) => {
      await page.getByTestId('verify-btn-idf-2').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).toBeVisible({ timeout: 5000 });

      // Click Cancel
      await page.getByTestId('verify-cancel').locator('button').click();

      // Dialog should close
      await expect(page.getByTestId('verify-identity-dialog')).not.toBeAttached({ timeout: 5000 });

      // Verify button should still be present
      await expect(page.getByTestId('verify-btn-idf-2')).toBeVisible();
    });
  });

  test.describe('Dismiss', () => {
    test('should leave identity unchanged when dismissing via mask click', async ({ page }) => {
      await page.getByTestId('verify-btn-idf-2').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).toBeVisible({ timeout: 5000 });

      // Click the PrimeNG dialog mask overlay to dismiss
      const mask = page.locator('.p-dialog-mask');
      await mask.click({ position: { x: 10, y: 10 } });

      // Dialog should close
      await expect(page.getByTestId('verify-identity-dialog')).not.toBeAttached({ timeout: 5000 });

      // Verify button should still be present
      await expect(page.getByTestId('verify-btn-idf-2')).toBeVisible();
    });
  });
});

// Generated with [Claude Code](https://claude.ai/code)
