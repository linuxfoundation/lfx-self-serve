// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

test.describe('Identities Verify Flow - Robust Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('unverified-identities-section').or(page.getByTestId('verified-identities-section'))).toBeVisible({ timeout: 10000 });
  });

  test.describe('Data-testid presence', () => {
    test('should have root container with grid class', async ({ page }) => {
      const root = page.getByTestId('profile-identities');
      await expect(root).toBeAttached();
      await expect(root).toHaveClass(/grid/);
    });

    test('should have unverified-identities-section', async ({ page }) => {
      await expect(page.getByTestId('unverified-identities-section')).toBeAttached();
    });

    test('should have verified-identities-section', async ({ page }) => {
      await expect(page.getByTestId('verified-identities-section')).toBeAttached();
    });

    test('should have Add identity button in header', async ({ page }) => {
      await expect(page.getByTestId('add-identity-btn')).toBeAttached();
    });

    test('should not show empty state when identities exist', async ({ page }) => {
      await expect(page.getByTestId('identities-empty')).not.toBeAttached();
    });

    test('should have all 5 rows with identity-row-{id} testid pattern', async ({ page }) => {
      const ids = ['idf-1', 'idf-2', 'idf-3', 'idf-5', 'idf-6'];
      for (const id of ids) {
        await expect(page.getByTestId(`identity-row-${id}`)).toBeAttached();
      }
    });
  });

  test.describe('Section structure', () => {
    test('should have warning icon in unverified section header', async ({ page }) => {
      const section = page.getByTestId('unverified-identities-section');
      await expect(section.locator('.fa-triangle-exclamation')).toBeAttached();
    });

    test('should have checkmark icon in verified section header', async ({ page }) => {
      const section = page.getByTestId('verified-identities-section');
      await expect(section.locator('.fa-circle-check')).toBeAttached();
    });

    test('should have 2 rows in unverified section (idf-2, idf-6)', async ({ page }) => {
      const section = page.getByTestId('unverified-identities-section');
      const rows = section.locator('[data-testid^="identity-row-"]');
      await expect(rows).toHaveCount(2);
      await expect(section.getByTestId('identity-row-idf-2')).toBeAttached();
      await expect(section.getByTestId('identity-row-idf-6')).toBeAttached();
    });

    test('should have 3 rows in verified section (idf-1, idf-3, idf-5)', async ({ page }) => {
      const section = page.getByTestId('verified-identities-section');
      const rows = section.locator('[data-testid^="identity-row-"]');
      await expect(rows).toHaveCount(3);
      await expect(section.getByTestId('identity-row-idf-1')).toBeAttached();
      await expect(section.getByTestId('identity-row-idf-3')).toBeAttached();
      await expect(section.getByTestId('identity-row-idf-5')).toBeAttached();
    });

    test('should render identity rows as div elements', async ({ page }) => {
      const row = page.getByTestId('identity-row-idf-1');
      const tagName = await row.evaluate((el) => el.tagName.toLowerCase());
      expect(tagName).toBe('div');
    });
  });

  test.describe('Row actions', () => {
    test('should have verify-btn testids only on unverified rows', async ({ page }) => {
      await expect(page.getByTestId('verify-btn-idf-2')).toBeAttached();
      await expect(page.getByTestId('verify-btn-idf-6')).toBeAttached();

      await expect(page.getByTestId('verify-btn-idf-1')).not.toBeAttached();
      await expect(page.getByTestId('verify-btn-idf-3')).not.toBeAttached();
      await expect(page.getByTestId('verify-btn-idf-5')).not.toBeAttached();
    });

    test('should have this-is-not-me buttons on unverified rows', async ({ page }) => {
      await expect(page.getByTestId('this-is-not-me-btn-idf-2')).toBeAttached();
      await expect(page.getByTestId('this-is-not-me-btn-idf-6')).toBeAttached();
    });

    test('should have identity-menu testids only on verified rows', async ({ page }) => {
      // Verified identities have menus
      await expect(page.getByTestId('identity-menu-idf-1')).toBeAttached();
      await expect(page.getByTestId('identity-menu-idf-3')).toBeAttached();
      await expect(page.getByTestId('identity-menu-idf-5')).toBeAttached();

      // Unverified identities do not have menus
      await expect(page.getByTestId('identity-menu-idf-2')).not.toBeAttached();
      await expect(page.getByTestId('identity-menu-idf-6')).not.toBeAttached();
    });
  });

  test.describe('Dialog structure', () => {
    test.beforeEach(async ({ page }) => {
      // Open verify dialog for idf-2
      await page.getByTestId('verify-btn-idf-2').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).toBeVisible({ timeout: 5000 });
    });

    test('should have verify-identity-dialog testid attached', async ({ page }) => {
      await expect(page.getByTestId('verify-identity-dialog')).toBeAttached();
    });

    test('should have cancel and confirm button testids', async ({ page }) => {
      await expect(page.getByTestId('verify-cancel')).toBeAttached();
      await expect(page.getByTestId('verify-confirm')).toBeAttached();
    });

    test('should contain identity detail card with provider icon', async ({ page }) => {
      const dialog = page.getByTestId('verify-identity-dialog');
      // idf-2 is email, icon is fa-light fa-envelope
      await expect(dialog.locator('.fa-envelope')).toBeAttached();
    });

    test('should have blue info box with circle-info icon', async ({ page }) => {
      const dialog = page.getByTestId('verify-identity-dialog');
      const infoBox = dialog.locator('.bg-blue-50.border-blue-200');
      await expect(infoBox).toBeAttached();
      await expect(infoBox.locator('.fa-circle-info')).toBeAttached();
    });

    test('should render inside PrimeNG dynamic dialog wrapper', async ({ page }) => {
      await expect(page.locator('p-dynamicdialog')).toBeAttached();
    });
  });

  test.describe('Signal reactivity after verification', () => {
    test('should move identity from unverified to verified section after confirmation', async ({ page }) => {
      // Before: idf-2 in unverified section
      const unverifiedSection = page.getByTestId('unverified-identities-section');
      await expect(unverifiedSection.getByTestId('identity-row-idf-2')).toBeAttached();

      // Verify idf-2
      await page.getByTestId('verify-btn-idf-2').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('verify-confirm').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).not.toBeAttached({ timeout: 5000 });

      // After: idf-2 should be in verified section
      const verifiedSection = page.getByTestId('verified-identities-section');
      await expect(verifiedSection.getByTestId('identity-row-idf-2')).toBeAttached();

      // Unverified section should now have only 1 row
      const unverifiedRows = unverifiedSection.locator('[data-testid^="identity-row-"]');
      await expect(unverifiedRows).toHaveCount(1);

      // Verified section should now have 4 rows
      const verifiedRows = verifiedSection.locator('[data-testid^="identity-row-"]');
      await expect(verifiedRows).toHaveCount(4);
    });

    test('should remove verify button from DOM after confirmation', async ({ page }) => {
      await page.getByTestId('verify-btn-idf-2').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('verify-confirm').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).not.toBeAttached({ timeout: 5000 });

      // Button should be removed from DOM, not just hidden
      await expect(page.getByTestId('verify-btn-idf-2')).not.toBeAttached();
    });

    test('should keep all 5 rows after verification', async ({ page }) => {
      await page.getByTestId('verify-btn-idf-2').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('verify-confirm').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).not.toBeAttached({ timeout: 5000 });

      // All 5 rows still present across both sections
      const ids = ['idf-1', 'idf-2', 'idf-3', 'idf-5', 'idf-6'];
      for (const id of ids) {
        await expect(page.getByTestId(`identity-row-${id}`)).toBeAttached();
      }
    });

    test('should add menu to newly verified identity', async ({ page }) => {
      // Before: idf-2 has no menu (unverified)
      await expect(page.getByTestId('identity-menu-idf-2')).not.toBeAttached();

      // Verify idf-2
      await page.getByTestId('verify-btn-idf-2').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('verify-confirm').locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).not.toBeAttached({ timeout: 5000 });

      // After: idf-2 should have a menu with "Remove"
      await expect(page.getByTestId('identity-menu-idf-2')).toBeAttached();
      await page.getByTestId('identity-menu-idf-2').click();
      const menuItem = page.locator('.p-menuitem');
      await expect(menuItem).toContainText('Remove');
    });
  });

  test.describe('Menu items', () => {
    test('should show "Remove" for verified identity menu', async ({ page }) => {
      await page.getByTestId('identity-menu-idf-1').click();
      const menuItem = page.locator('.p-menuitem');
      await expect(menuItem).toContainText('Remove');
      await page.keyboard.press('Escape');
    });
  });

  test.describe('Linux.com email card', () => {
    test('should render linux-com-email-card', async ({ page }) => {
      await expect(page.getByTestId('linux-com-email-card')).toBeAttached();
    });
  });
});

// Generated with [Claude Code](https://claude.ai/code)
