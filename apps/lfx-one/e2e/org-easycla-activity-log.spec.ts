// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA Activity Log — content E2E (#1987).
 *
 * The content half of the repository's dual E2E architecture; `org-easycla-activity-log-robust.spec.ts`
 * is the structural half. Search filters rows already loaded, so a no-match on this page must not
 * hide Load more while a later page exists.
 *
 * Nothing in this file may reach a real CLA service. The activity GET is stubbed.
 *
 * Prerequisites: as `org-easycla-detail.spec.ts`.
 */

import { expect, test } from '@playwright/test';

import { activityLogEntry, activityLogPage, gotoActivityLog, PAGE_LOAD_TIMEOUT, skipWithoutCredentials } from './helpers/org-easycla.helper';

test.setTimeout(120_000);

const ROW = activityLogEntry();
const POPULATED = activityLogPage({ list: [ROW], nextKey: 'cursor-2' });

test.describe('Org Lens EasyCLA activity log — content', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials());

  test('shows the summary and the actor', async ({ page }) => {
    await gotoActivityLog(page, { initial: POPULATED });

    await expect(page.getByTestId('org-easycla-activity-log-summary')).toHaveText('Ada Porter signed a corporate CLA', { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-activity-log-actor')).toHaveText('Ada Porter');
  });

  test('keeps Load more when the term matches nothing on the loaded page', async ({ page }) => {
    await gotoActivityLog(page, { initial: POPULATED });

    await expect(page.getByTestId('org-easycla-activity-log-summary')).toHaveText('Ada Porter signed a corporate CLA', { timeout: PAGE_LOAD_TIMEOUT });
    await page.locator('#org-easycla-activity-log-search-input').fill('nomatch');

    await expect(page.getByTestId('org-easycla-activity-log-filter-empty')).toBeVisible();
    await expect(page.getByTestId('org-easycla-activity-log-load-more')).toBeVisible();
    await expect(page.getByTestId('org-easycla-activity-log-empty')).toHaveCount(0);
  });

  test('appends the next page when Load more is clicked', async ({ page }) => {
    const pending = page.waitForRequest((request) => request.url().includes('/activity') && request.url().includes('nextKey=cursor-2'));

    await gotoActivityLog(page, {
      initial: POPULATED,
      next: activityLogPage({
        list: [activityLogEntry({ id: 'event-2', actor: 'Ken Mensah', summary: 'Ken Mensah added an approval domain' })],
        nextKey: null,
      }),
    });

    await expect(page.getByTestId('org-easycla-activity-log-summary')).toHaveText('Ada Porter signed a corporate CLA', { timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId('org-easycla-activity-log-load-more').locator('button').click();
    await pending;

    await expect(page.getByTestId('org-easycla-activity-log-summary')).toHaveText(['Ada Porter signed a corporate CLA', 'Ken Mensah added an approval domain']);
    await expect(page.getByTestId('org-easycla-activity-log-load-more')).toHaveCount(0);
  });
});
