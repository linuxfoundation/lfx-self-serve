// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, test } from '@playwright/test';

const ORG_PROJECTS_URL = '/org/projects';
const DATA_LOAD_TIMEOUT = 30_000;
const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_UID = '4c46585f-878c-8285-b2e9-2dbfc38ddd9b';

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

// The Projects page renders from a client-side demo-data service (no projects API yet), so the only
// stub needed is the personas endpoint to give the org context an account to select.
async function stubOrgContext(page: Page): Promise<void> {
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
            uid: MOCK_UID,
          },
        ],
        isRootWriter: false,
      }),
    })
  );
}

async function gotoOrgProjectsPage(page: Page): Promise<void> {
  await stubOrgContext(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(ORG_PROJECTS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/projects')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/projects redirected away');
  }
}

test.describe('Org Projects', () => {
  test('renders the projects table with demo data', async ({ page }) => {
    await gotoOrgProjectsPage(page);

    await expect(page.getByTestId('org-projects-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-projects-table')).toBeVisible();
    // Demo dataset always includes Kubernetes (Leading / Leading).
    const kubernetesRow = page.getByTestId('org-projects-row-kubernetes');
    await expect(kubernetesRow).toBeVisible();
    await expect(kubernetesRow.getByText('Leading').first()).toBeVisible();
    await expect(page.getByTestId('org-projects-export-csv')).toBeVisible();
  });

  test('sorts by project name from the column header (persists to the URL)', async ({ page }) => {
    await gotoOrgProjectsPage(page);
    await expect(page.getByTestId('org-projects-table')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-projects-sort-name').click();
    await expect(page).toHaveURL(/[?&]sort=name/);
  });

  test('opens the workspace dropdown and the add-workspace dialog', async ({ page }) => {
    await gotoOrgProjectsPage(page);
    await expect(page.getByTestId('org-projects-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-projects-workspace-trigger').click();
    // Each company is seeded with only the default workspace.
    await expect(page.getByTestId('org-projects-workspace-option-all-activities')).toBeVisible();

    await page.getByTestId('org-projects-add-workspace').click();
    await expect(page.getByTestId('org-projects-workspace-dialog')).toBeVisible();
    await expect(page.getByTestId('org-projects-workspace-save')).toBeVisible();
  });

  test('reveals the LFX Insights health detail on hover', async ({ page }) => {
    await gotoOrgProjectsPage(page);
    await expect(page.getByTestId('org-projects-row-kubernetes')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-projects-health-kubernetes').hover();
    const popover = page.getByTestId('org-projects-health-popover');
    await expect(popover).toBeVisible();
    await expect(popover.getByRole('link', { name: /LFX Insights/ })).toBeVisible();
  });
});
