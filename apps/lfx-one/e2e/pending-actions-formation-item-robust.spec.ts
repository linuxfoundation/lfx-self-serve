// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Me-lens Pending Actions — formation item row, structural contract (#2732). Asserts the
 * data-testid nesting and control shape independent of copy — see
 * pending-actions-formation-item.spec.ts for the content-based behaviour coverage.
 */

import { expect, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, gotoMeDashboardWithFormationRow } from './helpers/formation-checklist.helper';

test.setTimeout(120_000);

test.describe('Me-lens Pending Actions — formation item row structural contract (#2732)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoMeDashboardWithFormationRow(page, true);
    await expect(page.getByTestId('dashboard-pending-actions-item-FormationItem')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('nests the badge, title and meta segments under the row container', async ({ page }) => {
    const row = page.getByTestId('dashboard-pending-actions-item-FormationItem');

    await expect(row.locator('lfx-tag').first()).toBeAttached();
    await expect(row.getByTestId('dashboard-pending-actions-title')).toBeAttached();

    const meta = row.getByTestId('dashboard-pending-actions-formation-meta');
    await expect(meta).toBeAttached();
    await expect(meta.getByTestId('dashboard-pending-actions-formation-project')).toBeAttached();
    await expect(meta.getByTestId('dashboard-pending-actions-formation-due')).toBeAttached();
    await expect(meta.getByTestId('dashboard-pending-actions-formation-gating')).toBeAttached();
  });

  test('renders a status chip and a real, labelled anchor as the only action — no Dismiss, no Open button', async ({ page }) => {
    const row = page.getByTestId('dashboard-pending-actions-item-FormationItem');

    await expect(row.getByTestId('dashboard-pending-actions-formation-status')).toBeAttached();

    const view = row.getByTestId('dashboard-pending-actions-formation-view').locator('a');
    await expect(view).toBeAttached();
    expect(await view.evaluate((el) => el.tagName)).toBe('A');
    await expect(view).toHaveAttribute('href', /\/project\/formation\?project=.+&item=.+/);
    await expect(view).toHaveAttribute('aria-label', /on the formation checklist$/);

    await expect(row.getByTestId('dashboard-pending-actions-dismiss-FormationItem')).toHaveCount(0);
    await expect(row.getByTestId('dashboard-pending-actions-formation-open')).toHaveCount(0);
  });
});
