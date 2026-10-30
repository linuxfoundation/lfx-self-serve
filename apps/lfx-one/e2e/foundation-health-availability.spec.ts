// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { seedEdPersona } from './helpers/campaign-planning.helper';
import { FOUNDATION_SLUG, stubFoundationProject, stubNavLensItems } from './helpers/formation-checklist.helper';

// Auth is real; analytics and foundation selection are synthetic and deterministic.
test.beforeEach(() => skipWhenAuthMissing());
test.setTimeout(60_000);

async function stubFoundationContext(page: Page): Promise<void> {
  await seedEdPersona(page);
  await stubNavLensItems(page);
  await stubFoundationProject(page);
  // Unrelated analytics cannot decide whether the two cards under test are usable.
  await page.route('**/api/analytics/**', (route) => route.fulfill({ status: 500, json: { code: 'UPSTREAM_ERROR' } }));
}

test.describe('Foundation Health card-local availability (#4717)', () => {
  test('missing data has no retry and keeps a measured neighbor visible', async ({ page }) => {
    await stubFoundationContext(page);
    await page.route('**/api/analytics/foundation-total-projects*', (route) =>
      route.fulfill({ json: { totalProjects: 7, monthlyData: [6, 7], monthlyLabels: ['Sep', 'Oct'] } })
    );
    await page.route('**/api/analytics/foundation-value-concentration*', (route) => route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } }));

    await page.goto(`/foundation/overview?project=${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    const unavailable = page.getByTestId('foundation-health-card-total-value-unavailable');
    await expect(unavailable).toBeVisible({ timeout: 30_000 });
    await expect(unavailable).toContainText('Data not available yet');
    await expect(page.getByTestId('foundation-health-card-total-value-retry')).toHaveCount(0);
    await expect(page.getByTestId('foundation-health-card-total-value')).not.toContainText('$0.0M');
    const healthy = page.getByTestId('foundation-health-card-total-projects');
    await expect(healthy).toBeVisible();
    await expect(healthy).toContainText('7');
  });

  test('retry recovers the failed card without reloading the measured neighbor', async ({ page }) => {
    let valueRequests = 0;
    let projectsRequests = 0;
    let recovered = false;
    await stubFoundationContext(page);
    await page.route('**/api/analytics/foundation-total-projects*', (route) => {
      projectsRequests++;
      return route.fulfill({ json: { totalProjects: 7, monthlyData: [6, 7], monthlyLabels: ['Sep', 'Oct'] } });
    });
    await page.route('**/api/analytics/foundation-value-concentration*', (route) => {
      valueRequests++;
      if (!recovered) return route.fulfill({ status: 500, json: { code: 'UPSTREAM_ERROR' } });
      return route.fulfill({
        json: {
          totalValue: 12,
          top1Value: 12,
          top3Value: 12,
          top5Value: 12,
          allOtherValue: 0,
          totalProjectsCount: 1,
          top1Percentage: 100,
          top3Percentage: 100,
          top5Percentage: 100,
          allOtherPercentage: 0,
        },
      });
    });

    await page.goto(`/foundation/overview?project=${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    const unavailable = page.getByTestId('foundation-health-card-total-value-unavailable');
    await expect(unavailable).toContainText('This metric could not be loaded', { timeout: 30_000 });
    const healthy = page.getByTestId('foundation-health-card-total-projects');
    await expect(healthy).toContainText('7');
    expect(projectsRequests).toBeGreaterThan(0);
    const healthyRequestsBeforeRetry = projectsRequests;
    const failedRequestsBeforeRetry = valueRequests;

    recovered = true;
    await page.getByTestId('foundation-health-card-total-value-retry').getByRole('button', { name: /Retry/ }).click();
    await expect(page.getByTestId('foundation-health-card-total-value')).toContainText('$12.0M');
    await expect(unavailable).toHaveCount(0);
    await expect(healthy).toContainText('7');
    expect(valueRequests).toBe(failedRequestsBeforeRetry + 1);
    expect(projectsRequests).toBe(healthyRequestsBeforeRetry);
  });
});
