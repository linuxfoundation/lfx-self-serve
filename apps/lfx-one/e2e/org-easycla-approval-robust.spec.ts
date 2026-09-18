// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA Approval List — structural E2E (GH-2410).
 *
 * The structural half of the repository's dual E2E architecture; `org-easycla-approval.spec.ts` is
 * the content half. This one asserts the `data-testid` contract, the dialog nesting and the
 * confirm that has to appear before a PUT — not the copy — so the pair fails independently:
 * reworded invalidation text breaks only the content spec, and a panel rebuilt behind the same
 * testids leaves this one green.
 *
 * Same standing constraint as the content spec: both verbs on the approval-list path are stubbed,
 * so no run writes a real list or invalidates a real acknowledgement.
 *
 * Prerequisites: as `org-easycla-approval.spec.ts`.
 */

import { expect, test } from '@playwright/test';

import { approvalDialogValue, approvalList, countPutRequests, gotoApproval, PAGE_LOAD_TIMEOUT, skipWithoutCredentials } from './helpers/org-easycla.helper';

test.setTimeout(120_000);

const DOMAIN = 'example.com';
const EXISTING = approvalList({ entries: [{ kind: 'domain', value: DOMAIN, addedOn: '2026-03-04T00:00:00Z' }] });

test.describe('Org Lens EasyCLA approval — structure', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('nests the panel, the empty state and the add control', async ({ page }) => {
    await gotoApproval(page, { get: approvalList() });

    const panel = page.getByTestId('org-easycla-approval-list');
    await expect(panel).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(panel.getByTestId('org-easycla-approval-empty')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-approval-add')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-approval-table')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-approval-dialog')).toHaveCount(0);
  });

  test('nests a populated table under the panel, with edit and delete on the row', async ({ page }) => {
    await gotoApproval(page, { get: EXISTING });

    const panel = page.getByTestId('org-easycla-approval-list');
    const row = panel.getByTestId('org-easycla-approval-row');
    await expect(row).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });

    await expect(panel.getByTestId('org-easycla-approval-table')).toHaveCount(1);
    await expect(row.getByTestId('org-easycla-approval-edit')).toHaveCount(1);
    await expect(row.getByTestId('org-easycla-approval-delete')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-approval-empty')).toHaveCount(0);
  });

  test('opens the add dialog without the edit warning', async ({ page }) => {
    await gotoApproval(page, { get: approvalList() });

    await page.getByTestId('org-easycla-approval-add').locator('button').click();

    const dialog = page.getByTestId('org-easycla-approval-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('org-easycla-approval-dialog-submit')).toHaveCount(1);
    await expect(dialog.getByTestId('org-easycla-approval-dialog-edit-warning')).toHaveCount(0);
    await expect(approvalDialogValue(page)).toBeVisible();
  });

  test('opens the edit dialog with its warning nested inside', async ({ page }) => {
    await gotoApproval(page, { get: EXISTING });

    await page.getByTestId('org-easycla-approval-edit').locator('button').click();

    const dialog = page.getByTestId('org-easycla-approval-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('org-easycla-approval-dialog-edit-warning')).toHaveCount(1);
    await expect(dialog.getByTestId('org-easycla-approval-dialog-submit')).toHaveCount(1);
  });

  test('raises the confirm before any PUT, and dismisses without one', async ({ page }) => {
    await gotoApproval(page, { get: EXISTING });

    await expect(page.getByTestId('org-easycla-approval-row')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });

    const puts = countPutRequests(page);

    await page.getByTestId('org-easycla-approval-delete').locator('button').click();

    const confirm = page.locator('.p-confirmdialog');
    await expect(confirm).toBeVisible();
    expect(puts.count).toBe(0);

    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).not.toBeVisible();
    expect(puts.count).toBe(0);
    await expect(page.getByTestId('org-easycla-approval-row')).toHaveCount(1);
  });
});
