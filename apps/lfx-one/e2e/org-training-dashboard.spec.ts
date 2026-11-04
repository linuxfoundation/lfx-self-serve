// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';

import {
  DATA_LOAD_TIMEOUT,
  gotoOrgTrainingPage,
  MOCK_ACCOUNT_ID,
  ORG_TRAINING_URL,
  seedSelectedOrgCookie,
  skipWhenAuthMissing,
  stubOrgTrainingRoutes,
} from './helpers/org-training.helper';

test.setTimeout(120_000);

test.describe('Org Training Dashboard', () => {
  test('renders the filter bar, stat tiles and the Certifications group table, and opens the certified drawer', async ({ page }) => {
    await gotoOrgTrainingPage(page);
    await expect(page.getByTestId('org-training-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-training-filter-bar')).toBeVisible();
    await expect(page.getByTestId('org-training-stat-certifications-value')).toHaveText('18');
    await expect(page.getByTestId('org-training-panel-certifications')).toBeVisible();
    await expect(page.getByTestId('org-training-groups-data-table')).toBeVisible();
    await expect(page.getByTestId('org-training-group-name-CKA — Certified Kubernetes Administrator')).toBeVisible();
    // The footer Certified total is the Certifications tile.
    await expect(page.getByTestId('org-training-groups-totals-completed')).toHaveText('18');

    await page.getByTestId('org-training-group-completed-CKA — Certified Kubernetes Administrator').getByRole('button').click();
    await expect(page.getByTestId('org-training-group-employees-title')).toBeVisible();
    await expect(page.getByTestId('org-training-group-employee-certified@example.org')).toBeVisible();
  });

  test('trainings tab keeps the URL filters, shows Completed / In progress and opens the drawer', async ({ page }) => {
    await gotoOrgTrainingPage(page);
    await expect(page.getByTestId('org-training-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const groupsRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith(`/api/orgs/${MOCK_ACCOUNT_ID}/lens/training/groups`) && url.searchParams.get('tab') === 'trainings';
    });
    await page.getByTestId('filter-pill-trainings').click();
    await groupsRequest;

    await expect(page.getByTestId('org-training-panel-trainings')).toBeVisible();
    await expect(page.getByTestId('sort-completed')).toContainText('Completed');
    await expect(page.getByTestId('org-training-group-name-LFS258 — Kubernetes Fundamentals')).toBeVisible();

    await page.getByTestId('org-training-group-completed-LFS258 — Kubernetes Fundamentals').getByRole('button').click();
    await expect(page.getByTestId('org-training-group-employees-title')).toBeVisible();
    await expect(page.getByTestId('org-training-group-employee-trainee@example.org')).toBeVisible();
  });

  test('group-by in the URL regroups the table', async ({ page }) => {
    await seedSelectedOrgCookie(page);
    await stubOrgTrainingRoutes(page);
    const groupsRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith('/lens/training/groups') && url.searchParams.get('groupBy') === 'foundation';
    });
    await page.goto(`${ORG_TRAINING_URL}?groupBy=foundation&range=365d`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await groupsRequest;
    await expect(page.getByTestId('sort-label')).toContainText('Foundation');
  });
});
