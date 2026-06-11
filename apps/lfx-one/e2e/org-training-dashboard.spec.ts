// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, test } from '@playwright/test';

const ORG_TRAINING_URL = '/org/training';
const DATA_LOAD_TIMEOUT = 30_000;
const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';

test.setTimeout(120_000);

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Let malformed URLs fail naturally.
  }
}

async function seedSelectedOrgCookie(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'lfx-selected-account',
      value: JSON.stringify({ uid: MOCK_ACCOUNT_ID }),
      domain: 'localhost',
      path: '/',
    },
  ]);
}

async function stubOrgTrainingRoutes(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [
          {
            accountId: MOCK_ACCOUNT_ID,
            accountName: 'Red Hat LLC',
            accountSlug: 'red-hat-llc',
            membershipTier: '',
            uid: MOCK_ACCOUNT_ID,
          },
        ],
        isRootWriter: false,
      }),
    })
  );

  await page.route('**/api/analytics/org-lens-account-context*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          accountId: MOCK_ACCOUNT_ID,
          accountName: 'Red Hat LLC',
          accountSlug: 'red-hat-llc',
          membershipTier: 'Gold',
        },
      ]),
    })
  );

  await page.route(`**/api/orgs/${MOCK_ACCOUNT_ID}/lens/training/stats`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        certifiedEmployees: 12,
        certificationsEarned: 18,
        employeesInTraining: 7,
        trainingCoursesEnrolled: 9,
      }),
    })
  );

  await page.route(`**/api/orgs/${MOCK_ACCOUNT_ID}/lens/training/certifications?**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            courseId: 'cert-cka',
            name: 'CKA — Certified Kubernetes Administrator',
            foundation: 'CNCF',
            level: 'Advanced',
            certifiedCount: 5,
            inProgressCount: 2,
          },
        ],
        total: 1,
        pageSize: 10,
        offset: 0,
      }),
    })
  );

  await page.route(`**/api/orgs/${MOCK_ACCOUNT_ID}/lens/training/trainings?**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            courseId: 'training-lfs258',
            name: 'LFS258 — Kubernetes Fundamentals',
            foundation: 'Linux Foundation',
            level: 'Beginner',
            completedCount: 4,
            inProgressCount: 3,
          },
        ],
        total: 1,
        pageSize: 10,
        offset: 0,
      }),
    })
  );

  await page.route(`**/api/orgs/${MOCK_ACCOUNT_ID}/lens/training/certifications/cert-cka/employees*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        courseId: 'cert-cka',
        certificationName: 'CKA — Certified Kubernetes Administrator',
        status: 'certified',
        total: 1,
        data: [{ contactId: 'certified@example.org', name: 'Certified Engineer', jobTitle: 'SRE' }],
      }),
    })
  );

  await page.route(`**/api/orgs/${MOCK_ACCOUNT_ID}/lens/training/trainings/training-lfs258/employees*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        courseId: 'training-lfs258',
        trainingName: 'LFS258 — Kubernetes Fundamentals',
        status: 'completed',
        total: 1,
        data: [{ contactId: 'trainee@example.org', name: 'Training Graduate', jobTitle: 'Developer' }],
      }),
    })
  );
}

async function gotoOrgTrainingPage(page: Page): Promise<void> {
  await seedSelectedOrgCookie(page);
  await stubOrgTrainingRoutes(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(ORG_TRAINING_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/training')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/training redirected away');
  }
}

test.describe('Org Training Dashboard', () => {
  test('renders certifications tab with stat strip and opens certified drawer', async ({ page }) => {
    await gotoOrgTrainingPage(page);
    await expect(page.getByTestId('org-training-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-training-panel-certifications')).toBeVisible();
    await expect(page.getByTestId('org-certifications-data-table')).toBeVisible();
    await expect(page.getByTestId('org-certification-name-cert-cka')).toHaveText('CKA — Certified Kubernetes Administrator');

    await page.getByTestId('org-certification-certified-cert-cka').getByRole('button').click();
    await expect(page.getByTestId('cert-employees-drawer-title')).toBeVisible();
    await expect(page.getByTestId('cert-employee-certified@example.org')).toBeVisible();
  });

  test('trainings tab renders completed/in-progress columns and opens training drawer', async ({ page }) => {
    await gotoOrgTrainingPage(page);
    await expect(page.getByTestId('org-training-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const trainingsRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith(`/api/orgs/${MOCK_ACCOUNT_ID}/lens/training/trainings`);
    });
    await page.getByTestId('filter-pill-trainings').click();
    await trainingsRequest;

    await expect(page.getByTestId('org-training-panel-trainings')).toBeVisible();
    await expect(page.getByTestId('org-trainings-data-table')).toBeVisible();
    await expect(page.getByTestId('org-training-name-training-lfs258')).toHaveText('LFS258 — Kubernetes Fundamentals');
    await expect(page.getByTestId('org-training-completed-training-lfs258')).toBeVisible();
    await expect(page.getByTestId('org-training-in-progress-training-lfs258')).toBeVisible();

    await page.getByTestId('org-training-completed-training-lfs258').getByRole('button').click();
    await expect(page.getByTestId('training-employees-drawer-title')).toBeVisible();
    await expect(page.getByTestId('training-employee-trainee@example.org')).toBeVisible();
  });

  test('stat cards switch tabs', async ({ page }) => {
    await gotoOrgTrainingPage(page);
    await expect(page.getByTestId('org-training-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-training-stat-employees-in-training').click();
    await expect(page.getByTestId('org-training-panel-trainings')).toBeVisible();

    await page.getByTestId('org-training-stat-certified-employees').click();
    await expect(page.getByTestId('org-training-panel-certifications')).toBeVisible();
  });
});
