// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA CLA Managers — content E2E (#1984).
 *
 * Content half of the dual E2E architecture; `org-easycla-managers-robust.spec.ts` is structural.
 * Walks add / remove the way a CLA manager does and asserts on toast copy and request bodies.
 * Every manager write is stubbed — no real CLA state may change.
 *
 * Prerequisites: as `org-easycla-approval.spec.ts`.
 */

import { expect, Page, test } from '@playwright/test';

import {
  addManagerEmail,
  addManagerFirstName,
  addManagerLastName,
  countManagerWriteRequests,
  gotoManagers,
  isManagersDelete,
  isManagersPost,
  managerList,
  PAGE_LOAD_TIMEOUT,
  skipWithoutCredentials,
} from './helpers/org-easycla.helper';

test.setTimeout(120_000);

function managersPost(page: Page) {
  return page.waitForRequest(isManagersPost);
}

function managersDelete(page: Page) {
  return page.waitForRequest(isManagersDelete);
}

test.describe('Org Lens EasyCLA managers — content', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('adds a manager through the dialog and refreshes the roster', async ({ page }) => {
    await gotoManagers(page);

    await expect(page.getByTestId('org-easycla-managers-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId('org-easycla-managers-add').locator('button').click();
    await expect(page.getByTestId('org-easycla-add-manager-dialog')).toBeVisible();

    await addManagerFirstName(page).fill('New');
    await addManagerLastName(page).fill('Manager');
    await addManagerEmail(page).fill('new.manager@example.org');

    const pending = managersPost(page);
    await page.getByTestId('org-easycla-add-manager-submit').locator('button').click();

    const body = (await (await pending).postDataJSON()) as { firstName: string; lastName: string; email: string };
    expect(body).toEqual({ firstName: 'New', lastName: 'Manager', email: 'new.manager@example.org' });

    await expect(page.locator('.p-toast')).toContainText('CLA Manager added');
    await expect(page.getByTestId('org-easycla-managers-name').filter({ hasText: 'New Manager' })).toBeVisible();
  });

  test('names the person in the remove confirmation, then drops them from the roster', async ({ page }) => {
    await gotoManagers(page, { afterDelete: managerList({ managers: [managerList().managers[1]!] }) });

    await expect(page.getByTestId('org-easycla-managers-row')).toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });

    const writes = countManagerWriteRequests(page);

    await page.getByTestId('org-easycla-managers-remove').first().locator('button').click();

    const confirm = page.locator('.p-confirmdialog');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('Remove Kwame Mensah as CLA Manager?');
    expect(writes.deleteCount).toBe(0);

    const pending = managersDelete(page);
    await confirm.getByRole('button', { name: 'Remove' }).click();

    await pending;
    await expect(page.locator('.p-toast')).toContainText('CLA Manager removed');
    await expect(page.getByTestId('org-easycla-managers-row')).toHaveCount(1);
  });

  test('sends nothing if the remove confirmation is dismissed', async ({ page }) => {
    await gotoManagers(page);

    await expect(page.getByTestId('org-easycla-managers-row')).toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });

    const writes = countManagerWriteRequests(page);

    await page.getByTestId('org-easycla-managers-remove').first().locator('button').click();
    const confirm = page.locator('.p-confirmdialog');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();

    await expect(confirm).not.toBeVisible();
    expect(writes.deleteCount).toBe(0);
    await expect(page.getByTestId('org-easycla-managers-row')).toHaveCount(2);
  });
});
