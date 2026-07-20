// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, test } from '@playwright/test';

// Mock GET /api/profile so the profile shell + panel render with a known display name.
// PATCH /api/profile and nested /api/profile/* routes are matched separately below.
async function mockProfile(page: Page): Promise<void> {
  await page.route('**/api/profile', (route) => {
    if (route.request().method() !== 'GET') {
      return route.continue();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'e2e-user',
          email: 'ada@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
          username: 'alovelace',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        profile: { given_name: 'Ada', family_name: 'Lovelace' },
      }),
    });
  });
}

// Mock GET /api/profile/identities with a CDP-only (unowned) GitHub row listed BEFORE the
// Auth0-owned one. This guards the panel's ownership filter: it must pick the owned identity
// (inAuth0 === true), not simply the first GitHub row it encounters.
async function mockIdentities(page: Page): Promise<void> {
  await page.route('**/api/profile/identities', (route) => {
    if (route.request().method() !== 'GET') {
      return route.continue();
    }
    const now = new Date().toISOString();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'gh-cdp-only',
          platform: 'github',
          type: 'username',
          value: 'not-my-github',
          verified: false,
          source: 'cdp',
          icon: 'fa-brands fa-github',
          createdAt: now,
          updatedAt: now,
          displayState: 'unverified',
          inAuth0: false,
        },
        {
          id: 'gh-owned',
          platform: 'github',
          type: 'username',
          value: 'my-github',
          verified: true,
          source: 'auth0',
          icon: 'fa-brands fa-github',
          createdAt: now,
          updatedAt: now,
          displayState: 'verified',
          inAuth0: true,
          auth0UserId: 'github|123',
        },
      ]),
    });
  });
}

// Skip cleanly when Auth0 test credentials aren't configured (global-setup.ts only logs and
// returns, leaving the app on the Auth0 login redirect). Hostname-exact matching avoids the
// CodeQL substring-sanitization issue (e.g. `https://auth0.com.evil.com/`).
function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — keep the test running rather than silently skip.
  }
}

test.describe('Profile panel GitHub handle', () => {
  test('renders only the Auth0-owned GitHub handle, not an unowned CDP-only row', async ({ page }) => {
    await mockProfile(page);
    await mockIdentities(page);
    await page.goto('/profile/attributions', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page.getByTestId('profile-display-name')).toContainText('Ada Lovelace', { timeout: 10000 });

    const github = page.getByTestId('profile-panel-github');
    await expect(github).toBeVisible();
    await expect(github).toContainText('my-github');
    await expect(github).not.toContainText('not-my-github');
  });
});
