// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee Profile page — empty/error states plus the populated edit-drawer golden path
 * (KB: `code-truthiness/missing-e2e-for-empty-state`).
 *
 * The mentorship module is still mock-backed (`MOCK_MENTORSHIP_MENTEE_PROFILE`), so the profile
 * page renders through distinct empty-state branches: profile error, about-me empty, skills empty,
 * areas-to-improve empty, additional-notes empty, resume empty, application-history empty. This
 * suite locks each empty-state independently of the mock's default payload, and drives the
 * Edit Mentee Profile drawer through its seeded cancel/save workflow.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MENTORSHIP_COMING_SOON_DETAIL, MENTORSHIP_ENABLED_FLAG } from '@lfx-one/shared/constants';
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

const POPULATED_PROFILE = {
  profile: {
    aboutMe: '<p>Campus microgrid telemetry.</p><p>Want production pipelines.</p>',
    skillsHave: ['Python', 'Go'],
    skillsWant: ['Observability'],
    additionalNotes: 'Comfortable working asynchronously.',
    resumeFileName: 'test-user-1-resume.pdf',
    resumeUrl: 'https://example.com/test-user-1-resume.pdf',
  },
  history: [{ id: 'hist_pending', programName: 'GridFlow Ingestion', termName: 'Fall 2026', submittedOn: 'Jul 2, 2026', status: 'pending' }],
};

test.describe('Mentee Profile — edit drawer golden path', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await page.route('**/api/mentorship/mentee/profile', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(POPULATED_PROFILE),
      })
    );
    await page.goto(MENTEE_PROFILE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('mentorship-mentee-profile-details')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('shows the populated profile and seeds the edit drawer, then cancel leaves it closed', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentee-profile-details-about-text')).toContainText('Campus microgrid telemetry.');
    await expect(page.getByTestId('mentorship-mentee-profile-details-about-text')).toContainText('Want production pipelines.');
    await expect(page.getByTestId('mentorship-mentee-profile-details-skills-list')).toContainText('Python');
    await expect(page.getByTestId('mentorship-mentee-profile-details-notes-text')).toHaveText('Comfortable working asynchronously.');
    await expect(page.getByTestId('mentorship-mentee-profile-details-resume-link')).toContainText('test-user-1-resume.pdf');
    await expect(page.getByTestId('mentorship-application-history-name-hist_pending')).toHaveText('GridFlow Ingestion');

    await page.getByTestId('mentorship-mentee-profile-details-edit').click();
    await expect(page.getByTestId('mentee-profile-edit-drawer-body')).toBeVisible();
    await expect(page.locator('[data-test="mentee-profile-edit-about-me"]')).toHaveValue(
      'Campus microgrid telemetry.\nWant production pipelines.'
    );
    await expect(page.locator('[data-test="mentee-profile-edit-additional-notes"]')).toHaveValue('Comfortable working asynchronously.');
    await expect(page.getByTestId('mentee-profile-edit-have-skill-list')).toContainText('Python');

    await page.getByTestId('mentee-profile-edit-drawer-cancel').click();
    await expect(page.getByTestId('mentee-profile-edit-drawer-body')).toBeHidden();
  });

  test('Save Changes closes the drawer and shows the coming-soon toast', async ({ page }) => {
    await page.getByTestId('mentorship-mentee-profile-details-edit').click();
    await expect(page.getByTestId('mentee-profile-edit-drawer-body')).toBeVisible();

    await page.getByTestId('mentee-profile-edit-drawer-save').click();
    await expect(page.getByTestId('mentee-profile-edit-drawer-body')).toBeHidden();
    await expect(page.locator('.p-toast')).toContainText(MENTORSHIP_COMING_SOON_DETAIL);
  });
});
