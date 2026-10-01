// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor Profile page — loaded profile and history, empty states and the error state (linuxfoundation/lfx-mentorship#210).
 *
 * The page reads `/api/mentorship/mentor/profile`, which the BFF builds from the mentor's profile row
 * and their mentoring history. Each test stubs that read via `page.route` with a synthetic payload, so
 * the suite never depends on the signed-in user's real profile: one populated payload proves the
 * profile and history render, an empty one drives every empty-state branch (about-me, skills,
 * resume, mentoring history), and a 503 drives the error state.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the profile read is made by the
 * browser and the stub answers it; a direct `page.goto()` would read it during SSR, where no stub runs.
 * The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_MENTORING_HISTORY_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipMentorProfileResponse } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const MENTOR_PROFILE_URL = '/mentorship/mentor/profile';

const ACTIVE_ROW_ID = '11111111-1111-4111-8111-111111111111:Test Term Fall';
const PAST_ROW_ID = '22222222-2222-4222-8222-222222222222:Test Term Spring';

const POPULATED: MentorshipMentorProfileResponse = {
  profile: {
    aboutMe: '<p>Test User 1 mentor introduction.</p>',
    skills: ['Kubernetes', 'Angular'],
    resumeFileName: null,
    resumeUrl: null,
  },
  history: [
    { id: ACTIVE_ROW_ID, programName: 'Test Program Alpha', term: 'Test Term Fall', menteesCount: 0, status: 'in-progress' },
    { id: PAST_ROW_ID, programName: 'Test Program Beta', term: 'Test Term Spring', menteesCount: 2, status: 'completed' },
  ],
};

const EMPTY: MentorshipMentorProfileResponse = {
  profile: { aboutMe: '', skills: [], resumeFileName: null, resumeUrl: null },
  history: [],
};

/** Answers the profile read with `body`, or with `status` and a plain-text body when it is not 200. */
async function stubProfile(page: Page, body: MentorshipMentorProfileResponse, status = 200): Promise<void> {
  await page.route('**/api/mentorship/mentor/profile', (route) =>
    status === 200
      ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      : route.fulfill({ status, contentType: 'text/plain', body: 'Service Unavailable' })
  );
}

test.describe('Mentor Profile — loaded', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubProfile(page, POPULATED);
    await openMentorPage(page, MENTOR_PROFILE_URL);
  });

  test('shows the introduction and skills from the profile', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentor-profile-details-about-text')).toHaveText('Test User 1 mentor introduction.', {
      timeout: MENTOR_PAGE_LOAD_TIMEOUT,
    });
    const skills = page.getByTestId('mentorship-mentor-profile-details-skills-list');
    await expect(skills).toContainText('Kubernetes');
    await expect(skills).toContainText('Angular');
  });

  test('lists one history row per program term, with its mentees and status', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentoring-history-list')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId(`mentorship-mentoring-history-name-${ACTIVE_ROW_ID}`)).toHaveText('Test Program Alpha');
    await expect(page.getByTestId(`mentorship-mentoring-history-term-${ACTIVE_ROW_ID}`)).toHaveText('Test Term Fall');
    await expect(page.getByTestId(`mentorship-mentoring-history-status-${ACTIVE_ROW_ID}`)).toHaveText(
      MENTORSHIP_MENTORING_HISTORY_STATUS_LABELS['in-progress']
    );
    await expect(page.getByTestId(`mentorship-mentoring-history-status-${PAST_ROW_ID}`)).toHaveText(MENTORSHIP_MENTORING_HISTORY_STATUS_LABELS.completed);
    await expect(page.getByTestId(`mentorship-mentoring-history-mentees-${PAST_ROW_ID}`)).toContainText('2');
    await expect(page.getByTestId('mentorship-mentoring-history-empty')).toHaveCount(0);
  });
});

test.describe('Mentor Profile — empty states', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    // An empty profile with no history sends every section through its empty-state branch.
    await stubProfile(page, EMPTY);
    await openMentorPage(page, MENTOR_PROFILE_URL);
  });

  test('shows the about-me empty label when the mentor has no introduction', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentor-profile-details-about-empty')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  });

  test('shows the skills empty label when the mentor has none', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentor-profile-details-skills-empty')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  });

  test('shows the resume empty label when the mentor has not uploaded one', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentor-profile-details-resume-empty')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    // Empty resume ⇒ no anchor and no filename span, only the label.
    await expect(page.getByTestId('mentorship-mentor-profile-details-resume-link')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentor-profile-details-resume-name')).toHaveCount(0);
  });

  test('shows the mentoring-history empty state when the mentor has no programs', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentoring-history-empty')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentoring-history-list')).toHaveCount(0);
  });
});

test.describe('Mentor Profile — error state', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubProfile(page, EMPTY, 503);
    await openMentorPage(page, MENTOR_PROFILE_URL);
  });

  test('renders the error state when the BFF fails to serve the profile', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentor-profile-error-state')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    // Error state replaces the details + history composition entirely — a partial render would
    // be worse than the error itself, per MentorProfileComponent's degrade-to-empty pattern.
    await expect(page.getByTestId('mentorship-mentor-profile-details')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentoring-history')).toHaveCount(0);
  });
});
