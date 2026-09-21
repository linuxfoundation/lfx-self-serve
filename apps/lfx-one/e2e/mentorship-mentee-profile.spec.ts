// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee Profile page — empty states + error state (KB: `code-truthiness/missing-e2e-for-empty-state`).
 *
 * The mentorship module is still mock-backed (`MOCK_MENTORSHIP_MENTEE_PROFILE`), so the profile
 * page renders through distinct empty-state branches: profile error, about-me empty, skills empty,
 * areas-to-improve empty, additional-notes empty, resume empty, application-history empty. This
 * suite locks each empty-state test id independently of the mock's default payload.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MENTORSHIP_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';

test.beforeEach(() => skipWhenAuthMissing());

const MENTEE_PROFILE_URL = '/mentorship/mentee/profile';
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(60_000);

async function enableMentorshipFlag(page: Page): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [MENTORSHIP_ENABLED_FLAG]: true }),
  ] as const);
}

test.describe('Mentee Profile — empty states', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await page.route('**/api/mentorship/mentee/profile', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          profile: { aboutMe: '', skillsHave: [], skillsWant: [], additionalNotes: '', resumeFileName: null, resumeUrl: null },
          history: [],
        }),
      })
    );
    await page.goto(MENTEE_PROFILE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
  });

  test('shows the about-me empty label when the mentee has no introduction', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentee-profile-details-about-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('shows the skills empty label when the mentee has none', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentee-profile-details-skills-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('shows the areas-to-improve empty label when the mentee has none', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentee-profile-details-areas-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('shows the additional-notes empty label when skill_set.comments is absent', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentee-profile-details-notes-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('shows the resume empty label when the mentee has not uploaded one', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentee-profile-details-resume-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentee-profile-details-resume-link')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentee-profile-details-resume-name')).toHaveCount(0);
  });

  test('shows the application-history empty state when the mentee has no applications', async ({ page }) => {
    await expect(page.getByTestId('mentorship-application-history-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-application-history-list')).toHaveCount(0);
  });
});

test.describe('Mentee Profile — error state', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await page.route('**/api/mentorship/mentee/profile', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Service Unavailable' }));
    await page.goto(MENTEE_PROFILE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
  });

  test('renders the error state when the BFF fails to serve the profile', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentee-profile-error-state')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentee-profile-details')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-application-history')).toHaveCount(0);
  });
});
