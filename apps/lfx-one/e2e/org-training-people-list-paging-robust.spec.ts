// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * People › Trainees paging — structure and responsive layout, with every training request stubbed (synthetic data).
 * Companion to org-training-people-list-paging.spec.ts (which asserts the counts and page reports): this one pins where
 * each paginator sits, that its rows-per-page menu renders outside the clipping containers, that no page shows more rows
 * than its size, and one mobile-viewport scenario.
 */

import { expect, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, gotoOrgPageWithTrainees, type OrgTrainingApiGuard } from './helpers/org-training.helper';

test.setTimeout(120_000);

const TRAINEES_URL = '/org/people?tab=training';
const MOBILE_VIEWPORT = { width: 375, height: 812 };

let guard: OrgTrainingApiGuard;

test.afterEach(() => {
  expect(guard?.unstubbedTrainingRequests ?? []).toEqual([]);
});

test.describe('Org People Trainees paging — structure', () => {
  test('each list has its own paginator inside its own container, and no Show All', async ({ page }) => {
    guard = await gotoOrgPageWithTrainees(page, TRAINEES_URL);
    const table = page.getByTestId('org-people-trainees-table');
    const outside = page.getByTestId('org-people-trainees-outside');
    await expect(page.getByTestId('org-people-trainees-rows')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // The list of learners not on the people list starts collapsed.
    await outside.getByTestId('org-people-trainees-outside-toggle').click();

    await expect(table.getByTestId('org-people-trainees-paginator')).toHaveCount(1);
    await expect(outside.getByTestId('org-people-trainees-outside-paginator')).toHaveCount(1);
    await expect(table.getByTestId('org-people-trainees-outside-paginator')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /show all/i })).toHaveCount(0);

    await expect(page.getByTestId('org-people-trainees-rows').locator('tbody tr[role="button"]')).toHaveCount(10);
    await expect(outside.locator('ul li')).toHaveCount(10);
  });

  test('the rows-per-page menu renders outside the overflow-hidden containers and every option is clickable', async ({ page }) => {
    guard = await gotoOrgPageWithTrainees(page, TRAINEES_URL);
    const table = page.getByTestId('org-people-trainees-table');
    await expect(page.getByTestId('org-people-trainees-rows')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await table.getByTestId('org-people-trainees-paginator').locator('p-select').click();
    const options = page.getByRole('option');
    await expect(options).toHaveText(['10', '25', '50']);
    await expect(table.getByRole('option')).toHaveCount(0);
    await options.filter({ hasText: /^50$/ }).click();

    await expect(page.getByTestId('org-people-trainees-rows').locator('tbody tr[role="button"]')).toHaveCount(50);
  });

  test('on a phone-sized screen both paginators render and page', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    guard = await gotoOrgPageWithTrainees(page, TRAINEES_URL);
    await expect(page.getByTestId('org-people-trainees-rows')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('org-people-trainees-outside-toggle').click();

    for (const testId of ['org-people-trainees-paginator', 'org-people-trainees-outside-paginator']) {
      const paginator = page.getByTestId(testId);
      await paginator.scrollIntoViewIfNeeded();
      await expect(paginator).toBeVisible();
      await paginator.getByRole('button', { name: 'Next Page' }).click();
      await expect(paginator).toContainText('Showing 11 to 20');
    }
  });
});
