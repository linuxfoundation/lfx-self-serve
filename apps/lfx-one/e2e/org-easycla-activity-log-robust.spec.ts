// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA Activity Log — structural E2E (#1987).
 *
 * The structural half of the repository's dual E2E architecture; `org-easycla-activity-log.spec.ts`
 * is the content half. This one asserts the `data-testid` contract, not the copy.
 *
 * Same standing constraint as the content spec: the activity GET is stubbed.
 *
 * Prerequisites: as `org-easycla-activity-log.spec.ts`.
 */

import { expect, test } from '@playwright/test';

import { activityLogEntry, activityLogPage, gotoActivityLog, PAGE_LOAD_TIMEOUT, skipWithoutCredentials } from './helpers/org-easycla.helper';

test.setTimeout(120_000);

test.describe('Org Lens EasyCLA activity log — structure', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('nests the panel, the search box, and the empty state', async ({ page }) => {
    await gotoActivityLog(page);

    const panel = page.getByTestId('org-easycla-activity-log');
    await expect(panel).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(panel.getByTestId('org-easycla-activity-log-search')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-activity-log-empty')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-activity-log-table')).toHaveCount(0);
    await expect(page.locator('#org-easycla-activity-log-search-input')).toHaveCount(1);
  });

  test('nests the table and Load more under the panel when another page exists', async ({ page }) => {
    await gotoActivityLog(page, {
      initial: activityLogPage({
        list: [activityLogEntry()],
        nextKey: 'cursor-2',
      }),
    });

    const panel = page.getByTestId('org-easycla-activity-log');
    await expect(panel.getByTestId('org-easycla-activity-log-table')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(panel.getByTestId('org-easycla-activity-log-summary')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-activity-log-actor')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-activity-log-when')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-activity-log-load-more')).toHaveCount(1);
    await expect(panel.getByTestId('org-easycla-activity-log-empty')).toHaveCount(0);
  });
});
