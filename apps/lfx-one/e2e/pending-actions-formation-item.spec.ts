// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Me-lens Pending Actions — formation item rows (#2732). A checklist item assigned to the signed-in
 * user renders per the dashboard design and its one action lands on the project's checklist with
 * that item's panel open. Deterministic via route mocks; see
 * pending-actions-formation-item-robust.spec.ts for the structural contract.
 */

import { expect, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, FORMATION_PROJECT_SLUG, gotoMeDashboardWithFormationRow } from './helpers/formation-checklist.helper';

test.setTimeout(120_000);

test.describe('Me-lens Pending Actions — formation item row (#2732)', () => {
  test('renders the design row and View item lands on the checklist with that item open', async ({ page }) => {
    await gotoMeDashboardWithFormationRow(page, true);

    const row = page.getByTestId('dashboard-pending-actions-item-FormationItem');
    await expect(row).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Violet "Formation item" badge (lfx-tag's accent branch), bold title, gray meta line.
    await expect(row.locator('lfx-tag').first()).toContainText('Formation item');
    await expect(row.locator('lfx-tag .bg-violet-50').first()).toBeVisible();
    await expect(row.getByTestId('dashboard-pending-actions-title')).toContainText('Contribution agreement executed');
    await expect(row.getByTestId('dashboard-pending-actions-formation-project')).toContainText('Cascade Data Alliance');
    await expect(row.getByTestId('dashboard-pending-actions-formation-due')).toContainText('due Mar 31');
    await expect(row.getByTestId('dashboard-pending-actions-formation-gating')).toContainText('required for Active');
    await expect(row.getByTestId('dashboard-pending-actions-formation-status')).toContainText('In progress');
    await expect(row.getByTestId('dashboard-pending-actions-dismiss-FormationItem')).toHaveCount(0);

    // One real link, so the URL is inspectable before following it.
    const view = row.getByTestId('dashboard-pending-actions-formation-view').locator('a');
    await expect(view).toHaveAttribute('href', `/project/formation?project=${FORMATION_PROJECT_SLUG}&item=contribution_agreement_executed`);

    await view.click();
    await expect(page).toHaveURL(new RegExp(`/project/formation\\?project=${FORMATION_PROJECT_SLUG}$`), { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('formation-item-drawer')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('renders no formation row while formation-enabled is off', async ({ page }) => {
    // The row is served either way — the client-side flag gate is what hides it — so wait for the
    // served response before asserting the row's absence, or an unloaded page would pass vacuously.
    const pendingActionsServed = page.waitForResponse((response) => response.url().includes('/api/user/pending-actions'), { timeout: DATA_LOAD_TIMEOUT });
    await gotoMeDashboardWithFormationRow(page, false);
    await pendingActionsServed;

    await expect(page.getByTestId('dashboard-pending-actions-item-FormationItem')).toHaveCount(0);
  });
});
