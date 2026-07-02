// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, test } from '@playwright/test';

const ORG_MEETINGS_URL = '/org/meetings';
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

async function stubOrgMeetingsRoutes(page: Page): Promise<void> {
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
}

async function gotoOrgMeetingsPage(page: Page): Promise<void> {
  await seedSelectedOrgCookie(page);
  await stubOrgMeetingsRoutes(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(ORG_MEETINGS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/meetings')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/meetings redirected away');
  }
}

test.describe('Org Meetings Dashboard', () => {
  test('renders the meetings page with KPI strip and upcoming tab by default', async ({ page }) => {
    await gotoOrgMeetingsPage(page);
    await expect(page.getByTestId('org-meetings-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-meetings-kpi-strip')).toBeVisible();
    await expect(page.getByTestId('org-meetings-tab-bar')).toBeVisible();
    await expect(page.getByTestId('org-meetings-upcoming-tab')).toBeVisible();
    await expect(page.getByTestId('org-upcoming-meetings-list')).toBeVisible();
  });

  test('switches to past tab and renders past meeting list', async ({ page }) => {
    await gotoOrgMeetingsPage(page);
    await expect(page.getByTestId('org-meetings-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-meetings-tab-past').click();
    await expect(page).toHaveURL(/tab=past/);
    await expect(page.getByTestId('org-meetings-past-tab')).toBeVisible();
    await expect(page.getByTestId('org-past-meetings-list')).toBeVisible();
  });

  test('switching back to upcoming tab clears tab query param', async ({ page }) => {
    await gotoOrgMeetingsPage(page);
    await expect(page.getByTestId('org-meetings-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-meetings-tab-past').click();
    await expect(page).toHaveURL(/tab=past/);

    await page.getByTestId('org-meetings-tab-upcoming').click();
    await expect(page).not.toHaveURL(/tab=/);
    await expect(page.getByTestId('org-meetings-upcoming-tab')).toBeVisible();
  });

  test('search narrows the upcoming meetings list', async ({ page }) => {
    await gotoOrgMeetingsPage(page);
    await expect(page.getByTestId('org-meetings-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const list = page.getByTestId('org-upcoming-meetings-list');
    const initialCount = await list.locator('[data-testid^="org-upcoming-meeting-card-"]').count();
    expect(initialCount).toBeGreaterThan(1);

    await page.getByTestId('org-meetings-search').locator('input').fill('Security TAG');
    await expect(list.locator('[data-testid^="org-upcoming-meeting-card-"]')).toHaveCount(1);
    await expect(list).toContainText('Security TAG Monthly');
  });

  test('pending RSVP toggle narrows the upcoming meetings list', async ({ page }) => {
    await gotoOrgMeetingsPage(page);
    await expect(page.getByTestId('org-meetings-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const list = page.getByTestId('org-upcoming-meetings-list');
    const initialCount = await list.locator('[data-testid^="org-upcoming-meeting-card-"]').count();

    await page.getByTestId('org-meetings-pending-rsvp-toggle').click();
    const filteredCount = await list.locator('[data-testid^="org-upcoming-meeting-card-"]').count();
    expect(filteredCount).toBeLessThan(initialCount);
  });
});
