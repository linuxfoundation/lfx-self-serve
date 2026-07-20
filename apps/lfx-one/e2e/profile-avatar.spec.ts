// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, test } from '@playwright/test';

// 1x1 transparent PNG as a data URI — loads without a network request so the
// "picture present" assertion is deterministic in headless runs.
const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const BROKEN_PICTURE_URL = 'https://broken.test.invalid/avatar.png';

// Mock GET /api/profile with a controlled user_metadata.picture value.
// PATCH /api/profile (and nested /api/profile/* routes) are left untouched.
async function mockProfile(page: Page, picture: string | null): Promise<void> {
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
        profile: {
          given_name: 'Ada',
          family_name: 'Lovelace',
          picture: picture ?? undefined,
        },
      }),
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

test.describe('Profile header avatar', () => {
  test('renders user_metadata.picture as the avatar image when set', async ({ page }) => {
    await mockProfile(page, PNG_DATA_URI);
    // Enter via the legacy singular URL to also cover the backward-compat redirect.
    await page.goto('/profile/attribution', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page.getByTestId('profile-display-name')).toContainText('Ada Lovelace', { timeout: 10000 });
    // The legacy /profile/attribution URL must redirect to the canonical /profile/attributions.
    await expect(page).toHaveURL(/\/profile\/attributions$/, { timeout: 10000 });

    const image = page.getByTestId('profile-avatar-image');
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', PNG_DATA_URI);
  });

  test('falls back to initials when no picture is set', async ({ page }) => {
    await mockProfile(page, null);
    await page.goto('/profile/attributions', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page.getByTestId('profile-display-name')).toContainText('Ada Lovelace', { timeout: 10000 });

    await expect(page.getByTestId('profile-avatar-image')).not.toBeAttached();
    await expect(page.getByTestId('profile-avatar')).toContainText('A');
  });

  test('falls back to initials when the picture URL fails to load', async ({ page }) => {
    await mockProfile(page, BROKEN_PICTURE_URL);
    // Force the image request to fail so the (error) handler fires.
    await page.route(BROKEN_PICTURE_URL, (route) => route.abort());

    await page.goto('/profile/attributions', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page.getByTestId('profile-display-name')).toContainText('Ada Lovelace', { timeout: 10000 });

    // After the load error the image is removed and initials are shown.
    await expect(page.getByTestId('profile-avatar-image')).not.toBeAttached();
    await expect(page.getByTestId('profile-avatar')).toContainText('A');
  });
});
