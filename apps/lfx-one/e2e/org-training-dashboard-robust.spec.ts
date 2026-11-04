// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens Training & Certification — structure and responsive layout.
 * Companion to org-training-dashboard.spec.ts (which asserts the numbers): this one pins the shape of the filters card,
 * the "More filters" toggle, the group table and the drill-down drawer, plus one mobile-viewport scenario.
 */

import { expect, test } from '@playwright/test';

import { DATA_LOAD_TIMEOUT, gotoOrgTrainingPage } from './helpers/org-training.helper';

test.setTimeout(120_000);

const COURSE_KEY = 'CKA — Certified Kubernetes Administrator';
const MOBILE_VIEWPORT = { width: 375, height: 812 };

test.describe('Org Training Dashboard — structure', () => {
  test('the filters card keeps search, range and group-by up front and the five filters behind the toggle', async ({ page }) => {
    await gotoOrgTrainingPage(page);
    await expect(page.getByTestId('org-training-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const primary = page.getByTestId('org-training-filter-primary');
    await expect(primary).toBeVisible();
    await expect(primary.getByRole('textbox', { name: 'Search by name' })).toBeVisible();
    await expect(primary.locator('[data-test="org-training-filter-range"]')).toBeVisible();
    await expect(primary.locator('[data-test="org-training-filter-group-by"]')).toBeVisible();

    const moreFilters = page.getByTestId('org-training-more-filters');
    const toggle = page.getByTestId('org-training-more-filters-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(moreFilters).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(moreFilters).toBeVisible();
    for (const name of ['foundation', 'project', 'course', 'level', 'format']) {
      await expect(moreFilters.locator(`[data-test="org-training-filter-${name}"]`)).toBeVisible();
    }

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(moreFilters).toBeHidden();
  });

  test('a filter in the URL is counted on the collapsed toggle and enables Clear all, which removes it', async ({ page }) => {
    await gotoOrgTrainingPage(page, '/company/training?format=Online');
    await expect(page.getByTestId('org-training-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const clearAll = page.getByTestId('org-training-filter-clear-all').getByRole('button');
    await expect(page.getByTestId('org-training-more-filters-toggle')).toContainText('1');
    await expect(clearAll).toBeEnabled();

    await clearAll.click();
    await expect(page).not.toHaveURL(/format=/);
    await expect(clearAll).toBeDisabled();
  });

  test('the group table has a column header per measure, sortable, and count buttons named by value, status and row', async ({ page }) => {
    await gotoOrgTrainingPage(page);
    await expect(page.getByTestId('org-training-groups-data-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    for (const column of ['sort-label', 'sort-people', 'sort-courses-taken', 'sort-completed', 'sort-in-progress']) {
      const header = page.getByTestId(column);
      await expect(header).toBeVisible();
      await expect(header).toHaveAttribute('aria-sort', /none|ascending|descending/);
      await expect(header.getByRole('button')).toBeVisible();
    }
    await expect(page.getByTestId(`org-training-group-row-${COURSE_KEY}`)).toBeVisible();
    await expect(page.getByTestId(`org-training-group-completed-${COURSE_KEY}`).getByRole('button')).toHaveAccessibleName(/5 certified, .*Show people/);
  });

  test('the drawer lists the people behind a count, offers a search and closes with Escape', async ({ page }) => {
    await gotoOrgTrainingPage(page);
    await expect(page.getByTestId('org-training-groups-data-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId(`org-training-group-completed-${COURSE_KEY}`).getByRole('button').click();

    // PrimeNG's Drawer moves its panel (role "complementary") to the body, leaving the `data-testid` on <p-drawer> an empty zero-size host: find the panel by the title it holds.
    const drawer = page.getByRole('complementary').filter({ has: page.getByTestId('org-training-group-employees-title') });
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId('org-training-group-employees-title')).toContainText('Certified');
    await expect(page.getByTestId('org-training-group-employees-subtitle')).toContainText(COURSE_KEY);
    await expect(page.getByTestId('org-training-group-employees-note')).toBeVisible();
    await expect(drawer.getByRole('textbox', { name: 'Search employees' })).toBeVisible();
    await expect(page.getByTestId('org-training-group-employee-certified@example.org')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });
});

test.describe('Org Training Dashboard — mobile viewport', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('stacks the filters card and keeps the table and drawer usable without horizontal page scroll', async ({ page }) => {
    await gotoOrgTrainingPage(page);
    await expect(page.getByTestId('org-training-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const range = page.locator('[data-test="org-training-filter-range"]');
    await expect(range).toBeVisible();
    const toggle = page.getByTestId('org-training-more-filters-toggle');
    await toggle.click();
    await expect(page.locator('[data-test="org-training-filter-course"]')).toBeVisible();

    // The filters stack in one column: each control sits below the previous one.
    const search = await page.getByRole('textbox', { name: 'Search by name' }).boundingBox();
    const rangeBox = await range.boundingBox();
    expect(search).not.toBeNull();
    expect(rangeBox).not.toBeNull();
    expect(rangeBox!.y).toBeGreaterThan(search!.y);

    await expect(page.getByTestId('org-training-groups-data-table')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.getByTestId(`org-training-group-completed-${COURSE_KEY}`).getByRole('button').click();
    // PrimeNG's Drawer moves its panel (role "complementary") to the body, leaving the `data-testid` on <p-drawer> an empty zero-size host: find the panel by the title it holds.
    const drawer = page.getByRole('complementary').filter({ has: page.getByTestId('org-training-group-employees-title') });
    await expect(drawer).toBeVisible();
    const drawerBox = await drawer.boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  });
});
