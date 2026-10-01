// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA Overview Recent activity — content E2E (#2857).
 *
 * The content half of the repository's dual E2E architecture; `org-easycla-recent-activity-robust.spec.ts`
 * is the structural half. The block previews the first page of the Activity Log on a signed
 * Overview and hands off to the full tab.
 *
 * Nothing in this file may reach a real CLA service. The activity GET is stubbed.
 *
 * Prerequisites: as `org-easycla-detail.spec.ts`.
 */

import { expect, test } from '@playwright/test';

import { activityLogEntry, activityLogPage, gotoRecentActivity, PAGE_LOAD_TIMEOUT, skipWithoutCredentials } from './helpers/org-easycla.helper';

test.setTimeout(120_000);

const FOUR_EVENTS = activityLogPage({
  list: [
    activityLogEntry({ id: 'event-1', actor: 'Ada Porter', summary: 'Ada Porter signed a corporate CLA' }),
    activityLogEntry({ id: 'event-2', actor: 'Ken Mensah', summary: 'Ken Mensah added an approval domain' }),
    activityLogEntry({ id: 'event-3', actor: 'Lena Ortiz', summary: 'Lena Ortiz added a CLA Manager' }),
    activityLogEntry({ id: 'event-4', actor: 'Omar Reyes', summary: 'Omar Reyes enabled Auto ECLA' }),
  ],
  nextKey: 'cursor-2',
});

test.describe('Org Lens EasyCLA recent activity — content', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('previews at most three events under Action, By and When', async ({ page }) => {
    await gotoRecentActivity(page, FOUR_EVENTS);

    const block = page.getByTestId('org-easycla-recent-activity');
    await expect(block.getByTestId('org-easycla-recent-activity-heading')).toHaveText('Recent activity', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(block.locator('thead th')).toHaveText(['Action', 'By', 'When']);
    await expect(block.getByTestId('org-easycla-recent-activity-summary')).toHaveText([
      'Ada Porter signed a corporate CLA',
      'Ken Mensah added an approval domain',
      'Lena Ortiz added a CLA Manager',
    ]);
    await expect(block.getByTestId('org-easycla-recent-activity-actor')).toHaveText(['Ada Porter', 'Ken Mensah', 'Lena Ortiz']);
    await expect(block.getByTestId('org-easycla-recent-activity-when')).toHaveCount(3);
    await expect(block.getByTestId('org-easycla-recent-activity-when').first()).not.toHaveText('—');
  });

  test('opens the Activity Log tab and focuses its trigger from View full activity log', async ({ page }) => {
    await gotoRecentActivity(page, FOUR_EVENTS);

    const viewAll = page.getByTestId('org-easycla-recent-activity-view-all');
    await expect(viewAll).toHaveText('View full activity log', { timeout: PAGE_LOAD_TIMEOUT });
    await viewAll.click();

    const trigger = page.getByTestId('org-easycla-detail-tab-activity');
    await expect(trigger).toHaveAttribute('aria-selected', 'true');
    await expect(trigger).toBeFocused();
    await expect(page.getByTestId('org-easycla-activity-log')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test('renders no block when the first page is empty', async ({ page }) => {
    const answered = page.waitForResponse((response) => response.url().includes('/activity') && response.request().method() === 'GET');

    await gotoRecentActivity(page, activityLogPage({ list: [], resultCount: 0 }));
    await answered;

    await expect(page.getByTestId('org-easycla-recent-activity-loading')).toHaveCount(0, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-recent-activity')).toHaveCount(0);
    await expect(page.getByTestId('org-easycla-detail-overview').getByText('View full activity log')).toHaveCount(0);
  });
});
