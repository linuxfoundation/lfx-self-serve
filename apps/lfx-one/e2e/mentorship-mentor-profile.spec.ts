// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor Profile page — empty states + error state (KB: `code-truthiness/missing-e2e-for-empty-state`).
 *
 * The mentorship module is still mock-backed (`MOCK_MENTORSHIP_MENTOR_PROFILE`), so the profile
 * page renders through five distinct empty-state branches: profile error, about-me empty, skills
 * empty, resume empty, mentoring-history empty. Each one was introduced in the same commit that
 * shipped the tabbed shell, and none had e2e coverage — a silent regression would only surface
 * once the upstream service returned real data. This suite locks each empty-state test id in
 * place independently of the mock's default payload.
 *
 * The module is behind the `mentorship-enabled` client flag; the flag is pinned per-test via the
 * localStorage override (`FEATURE_FLAG_OVERRIDE_STORAGE_KEY`) — same pattern marketing-access.spec.ts
 * uses — so the suite is hermetic and does not depend on real LaunchDarkly targeting.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MENTORSHIP_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';

test.beforeEach(() => skipWhenAuthMissing());

const MENTOR_PROFILE_URL = '/mentorship/mentor/profile';
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(60_000);

/**
 * Pins the client `mentorship-enabled` flag before app code runs. Without this pin, `mentorshipEnabledGuard`
 * evaluates the real (default-off) LaunchDarkly flag and the route rewrites to `/`, so the empty-state
 * assertions below never see the profile page.
 */
async function enableMentorshipFlag(page: Page): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [MENTORSHIP_ENABLED_FLAG]: true }),
  ] as const);
}

test.describe('Mentor Profile — empty states', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    // Return an empty profile so every section renders through its empty-state branch. The mock
    // BFF's default payload is populated (see MOCK_MENTORSHIP_MENTOR_PROFILE), so the stub is
    // what forces the empty path — otherwise the assertions below would race the mock.
    await page.route('**/api/mentorship/mentor/profile', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: { aboutMe: '', skills: [], resumeFileName: null, resumeUrl: null },
          history: [],
        }),
      })
    );
    await page.goto(MENTOR_PROFILE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
  });

  test('shows the about-me empty label when the mentor has no introduction', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentor-profile-details-about-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('shows the skills empty label when the mentor has none', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentor-profile-details-skills-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('shows the resume empty label when the mentor has not uploaded one', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentor-profile-details-resume-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // Empty resume ⇒ no anchor and no filename span, only the label.
    await expect(page.getByTestId('mentorship-mentor-profile-details-resume-link')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentor-profile-details-resume-name')).toHaveCount(0);
  });

  test('shows the mentoring-history empty state when the mentor has no prior programs', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentoring-history-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentoring-history-list')).toHaveCount(0);
  });
});

test.describe('Mentor Profile — error state', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await page.route('**/api/mentorship/mentor/profile', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Service Unavailable' }));
    await page.goto(MENTOR_PROFILE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
  });

  test('renders the error state when the BFF fails to serve the profile', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentor-profile-error-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // Error state replaces the details + history composition entirely — a partial render would
    // be worse than the error itself, per MentorProfileComponent's degrade-to-empty pattern.
    await expect(page.getByTestId('mentorship-mentor-profile-details')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentoring-history')).toHaveCount(0);
  });
});
