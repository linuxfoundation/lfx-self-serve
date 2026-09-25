// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA Overview Recent activity — structural E2E (#2857).
 *
 * The structural half of the repository's dual E2E architecture; `org-easycla-recent-activity.spec.ts`
 * is the content half. This one asserts the `data-testid` contract and the tab hand-off's ARIA
 * wiring, not the copy.
 *
 * Same standing constraint as the content spec: the activity GET is stubbed.
 *
 * Prerequisites: as `org-easycla-recent-activity.spec.ts`.
 */

import { expect, test } from '@playwright/test';

import { activityLogEntry, activityLogPage, gotoRecentActivity, PAGE_LOAD_TIMEOUT, skipWithoutCredentials } from './helpers/org-easycla.helper';

test.setTimeout(120_000);

const FOUR_EVENTS = activityLogPage({
  list: ['event-1', 'event-2', 'event-3', 'event-4'].map((id) => activityLogEntry({ id })),
});

test.describe('Org Lens EasyCLA recent activity — structure', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('nests the block under the Overview with three rows of three cells', async ({ page }) => {
    await gotoRecentActivity(page, FOUR_EVENTS);

    const block = page.getByTestId('org-easycla-detail-overview').getByTestId('org-easycla-recent-activity');
    await expect(block).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(block.getByTestId('org-easycla-recent-activity-heading')).toHaveCount(1);
    await expect(block.getByTestId('org-easycla-recent-activity-view-all')).toHaveCount(1);
    await expect(block.getByTestId('org-easycla-recent-activity-table')).toHaveCount(1);

    for (const id of ['event-1', 'event-2', 'event-3']) {
      const row = block.getByTestId(`org-easycla-recent-activity-row-${id}`);
      await expect(row).toHaveCount(1);
      for (const cell of ['summary', 'actor', 'when']) {
        await expect(row.getByTestId(`org-easycla-recent-activity-${cell}`)).toHaveCount(1);
      }
    }
    await expect(block.getByTestId('org-easycla-recent-activity-row-event-4')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-recent-activity-loading')).toHaveCount(0);
  });

  test('selects the Activity Log tab, points it at its panel, and gives it the tab stop', async ({ page }) => {
    await gotoRecentActivity(page, FOUR_EVENTS);

    await page.getByTestId('org-easycla-recent-activity-view-all').click({ timeout: PAGE_LOAD_TIMEOUT });

    const trigger = page.locator('#org-easycla-detail-tab-trigger-activity');
    await expect(trigger).toHaveAttribute('aria-selected', 'true');
    await expect(trigger).toHaveAttribute('aria-controls', 'org-easycla-detail-tab-panel-activity');
    await expect(trigger).toHaveAttribute('tabindex', '0');
    await expect(trigger).toBeFocused();
    await expect(page.locator('#org-easycla-detail-tab-panel-activity')).toHaveCount(1);
    await expect(page.getByTestId('org-easycla-detail-overview')).toHaveCount(0);
  });

  test('renders neither the block nor its skeleton for an empty first page', async ({ page }) => {
    const answered = page.waitForResponse((response) => response.url().includes('/activity') && response.request().method() === 'GET');

    await gotoRecentActivity(page, activityLogPage({ list: [], resultCount: 0 }));
    await answered;

    await expect(page.getByTestId('org-easycla-recent-activity-loading')).toHaveCount(0, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-recent-activity')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-recent-activity-table')).toHaveCount(0);
  });
});
