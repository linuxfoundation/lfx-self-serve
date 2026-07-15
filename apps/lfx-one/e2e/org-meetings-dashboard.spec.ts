// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, Route, test } from '@playwright/test';

const ORG_MEETINGS_URL = '/org/meetings';
const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';

test.setTimeout(120_000);

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

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

// Stub only what the org lens needs to render (personas + account context). The Org
// Lens meetings BFF endpoints were retired (LFXV2-1902) — there is nothing
// meetings-specific left to stub.
async function stubOrgLensContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, {
      personas: ['contributor'],
      personaProjects: {},
      projects: [],
      organizations: [{ accountId: MOCK_ACCOUNT_ID, accountName: 'Red Hat, Inc.', accountSlug: 'red-hat', membershipTier: '', uid: MOCK_ACCOUNT_ID }],
      isRootWriter: false,
    })
  );

  await page.route('**/api/analytics/org-lens-account-context*', (route) =>
    fulfillJson(route, [{ accountId: MOCK_ACCOUNT_ID, accountName: 'Red Hat, Inc.', accountSlug: 'red-hat', membershipTier: 'Gold' }])
  );
}

async function gotoOrgMeetingsPage(page: Page): Promise<void> {
  await seedSelectedOrgCookie(page);
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

test.describe('Org Meetings (retired — coming soon)', () => {
  test('renders the coming-soon placeholder and no live meetings surface', async ({ page }) => {
    await stubOrgLensContext(page);
    await gotoOrgMeetingsPage(page);

    // Header stays for sibling-tab consistency.
    await expect(page.getByTestId('org-meetings-page')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Meetings' })).toBeVisible();

    // The coming-soon placeholder is shown.
    const placeholder = page.getByTestId('org-meetings-coming-soon');
    await expect(placeholder).toBeVisible();
    await expect(placeholder.getByText('Coming soon')).toBeVisible();

    // The retired live surface (KPI strip, filters, upcoming list, invitee PII panel) is gone.
    await expect(page.getByTestId('org-meetings-kpi-strip')).toHaveCount(0);
    await expect(page.getByTestId('org-meetings-filter-bar')).toHaveCount(0);
    await expect(page.getByTestId('org-upcoming-meetings-list')).toHaveCount(0);
  });

  test('does not call the retired org-lens meetings BFF endpoints', async ({ page }) => {
    await stubOrgLensContext(page);

    let meetingsApiHit = false;
    await page.route('**/api/orgs/**/lens/meetings**', (route) => {
      meetingsApiHit = true;
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });

    await gotoOrgMeetingsPage(page);

    await expect(page.getByTestId('org-meetings-coming-soon')).toBeVisible();

    // Keep observing over a bounded window after the placeholder renders: a deferred/async
    // call to the retired endpoint would resolve waitForRequest and fail this expectation,
    // instead of slipping past an immediate check. No request within the window => the wait
    // times out and rejects, which is the pass condition.
    await expect(page.waitForRequest('**/api/orgs/**/lens/meetings**', { timeout: 1000 })).rejects.toThrow();
    expect(meetingsApiHit).toBe(false);
  });
});
