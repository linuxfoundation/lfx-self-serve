// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA CLA Managers — structural E2E (#1984).
 *
 * Structural half of the dual E2E architecture; `org-easycla-managers.spec.ts` is content.
 * Asserts testids, dialog nesting, and confirm-before-DELETE — not copy.
 *
 * Prerequisites: as `org-easycla-managers.spec.ts`.
 */

import { expect, test } from '@playwright/test';

import {
  addManagerFirstName,
  countManagerWriteRequests,
  gotoManagers,
  managerList,
  PAGE_LOAD_TIMEOUT,
  skipWithoutCredentials,
} from './helpers/org-easycla.helper';

test.setTimeout(120_000);

test.describe('Org Lens EasyCLA managers — structure', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('nests the panel, the table, and the add control', async ({ page }) => {
    await gotoManagers(page);

    const panel = page.getByTestId('org-easycla-managers');
    await expect(panel).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(panel.getByTestId('org-easycla-managers-table')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-managers-add')).toHaveCount(1);
    await expect(page.getByTestId('org-easycla-add-manager-dialog')).toHaveCount(0);
  });

  test('nests remove on each row when more than one manager is listed', async ({ page }) => {
    await gotoManagers(page);

    const panel = page.getByTestId('org-easycla-managers');
    const rows = panel.getByTestId('org-easycla-managers-row');
    await expect(rows).toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(rows.first().getByTestId('org-easycla-managers-remove')).toHaveCount(1);
  });

  test('opens the add dialog with the three required fields', async ({ page }) => {
    await gotoManagers(page);

    await page.getByTestId('org-easycla-managers-add').locator('button').click();

    const dialog = page.getByTestId('org-easycla-add-manager-dialog');
    await expect(dialog).toBeVisible();
    await expect(addManagerFirstName(page)).toBeVisible();
    await expect(dialog.getByTestId('org-easycla-add-manager-submit')).toHaveCount(1);
    await expect(dialog.getByTestId('org-easycla-add-manager-cancel')).toHaveCount(1);
  });

  test('raises the confirm before any DELETE, and dismisses without one', async ({ page }) => {
    await gotoManagers(page);

    await expect(page.getByTestId('org-easycla-managers-row')).toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });

    const writes = countManagerWriteRequests(page);

    await page.getByTestId('org-easycla-managers-remove').first().locator('button').click();

    const confirm = page.locator('.p-confirmdialog');
    await expect(confirm).toBeVisible();
    expect(writes.deleteCount).toBe(0);

    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).not.toBeVisible();
    expect(writes.deleteCount).toBe(0);
    await expect(page.getByTestId('org-easycla-managers-row')).toHaveCount(2);
  });

  test('shows visible guidance when only one manager remains', async ({ page }) => {
    await gotoManagers(page, { initial: managerList({ managers: [managerList().managers[0]!] }) });

    await expect(page.getByTestId('org-easycla-managers-remove-blocked')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-managers-last-manager-hint')).toHaveCount(1);
    await expect(page.getByTestId('org-easycla-managers-remove')).toHaveCount(0);
  });
});
