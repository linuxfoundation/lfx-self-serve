// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee Profile page — structural / data-testid contract.
 *
 * Companion to `mentorship-mentee-profile.spec.ts` (content + empty/error copy).
 * This spec asserts presence, nesting, dynamic application-row suffixes, and
 * loading/error/empty structural states without user-facing copy.
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
const ELEMENT_TIMEOUT = 10_000;
const PENDING_APPLICATION_ID = 'hist_pending';
const ACCEPTED_APPLICATION_ID = 'hist_accepted';

test.setTimeout(60_000);

const POPULATED_PROFILE = {
  profile: {
    aboutMe: '<p>Intro</p>',
    skillsHave: ['Python'],
    skillsWant: ['Go'],
    additionalNotes: 'Notes',
    resumeFileName: 'test-user-1-resume.pdf',
    resumeUrl: 'https://example.com/test-user-1-resume.pdf',
  },
  history: [
    {
      id: PENDING_APPLICATION_ID,
      programName: 'Program A',
      termName: 'Fall 2026',
      submittedOn: 'Jul 2, 2026',
      status: 'pending',
    },
    {
      id: ACCEPTED_APPLICATION_ID,
      programName: 'Program B',
      termName: 'Fall 2026',
      submittedOn: 'Jun 28, 2026',
      status: 'accepted',
    },
  ],
};

const EMPTY_PROFILE = {
  profile: { aboutMe: '', skillsHave: [], skillsWant: [], additionalNotes: '', resumeFileName: null, resumeUrl: null },
  history: [],
};

async function enableMentorshipFlag(page: Page): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [MENTORSHIP_ENABLED_FLAG]: true }),
  ] as const);
}

async function fulfillMenteeProfile(page: Page, body: unknown, delayMs = 0): Promise<void> {
  await page.route('**/api/mentorship/mentee/profile', async (route) => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function gotoMenteeProfile(page: Page): Promise<void> {
  await page.goto(MENTEE_PROFILE_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Mentee Profile — Robust Tests', () => {
  test.describe('Data-testid presence', () => {
    test.beforeEach(async ({ page }) => {
      await enableMentorshipFlag(page);
      await fulfillMenteeProfile(page, POPULATED_PROFILE);
      await gotoMenteeProfile(page);
      await expect(page.getByTestId('mentorship-mentee-profile-details')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    });

    test('exposes the page root, details card, and application history', async ({ page }) => {
      const root = page.getByTestId('mentorship-mentee-profile');
      await expect(root).toBeAttached();
      await expect(root.getByTestId('mentorship-mentee-profile-details')).toBeAttached();
      await expect(root.getByTestId('mentorship-application-history')).toBeAttached();
      await expect(page.getByTestId('mentorship-mentee-profile-loading')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-mentee-profile-error-state')).toHaveCount(0);
    });

    test('nests details sections inside the details card', async ({ page }) => {
      const details = page.getByTestId('mentorship-mentee-profile-details');
      await expect(details.getByTestId('mentorship-mentee-profile-details-title')).toBeAttached();
      await expect(details.getByTestId('mentorship-mentee-profile-details-edit')).toBeAttached();
      await expect(details.getByTestId('mentorship-mentee-profile-details-about')).toBeAttached();
      await expect(details.getByTestId('mentorship-mentee-profile-details-skills')).toBeAttached();
      await expect(details.getByTestId('mentorship-mentee-profile-details-areas')).toBeAttached();
      await expect(details.getByTestId('mentorship-mentee-profile-details-notes')).toBeAttached();
      await expect(details.getByTestId('mentorship-mentee-profile-details-resume')).toBeAttached();
    });

    test('renders one application row per id, with nested name/term/status/view ids', async ({ page }) => {
      const list = page.getByTestId('mentorship-application-history-list');
      await expect(list.locator('[data-testid^="mentorship-application-history-row-"]')).toHaveCount(2);

      for (const id of [PENDING_APPLICATION_ID, ACCEPTED_APPLICATION_ID]) {
        const row = page.getByTestId(`mentorship-application-history-row-${id}`);
        await expect(row).toBeAttached();
        await expect(row.getByTestId(`mentorship-application-history-name-${id}`)).toBeAttached();
        await expect(row.getByTestId(`mentorship-application-history-term-${id}`)).toBeAttached();
        await expect(row.getByTestId(`mentorship-application-history-submitted-${id}`)).toBeAttached();
        await expect(row.getByTestId(`mentorship-application-history-status-${id}`)).toBeAttached();
        await expect(row.getByTestId(`mentorship-application-history-view-${id}`)).toBeAttached();
      }
    });

    test('scopes withdraw to the pending row only', async ({ page }) => {
      await expect(page.getByTestId(`mentorship-application-history-withdraw-${PENDING_APPLICATION_ID}`)).toBeAttached();
      await expect(page.getByTestId(`mentorship-application-history-withdraw-${ACCEPTED_APPLICATION_ID}`)).toHaveCount(0);
    });
  });

  test.describe('Loading state', () => {
    test('shows the loading testid before the details card', async ({ page }) => {
      await enableMentorshipFlag(page);
      await fulfillMenteeProfile(page, POPULATED_PROFILE, 3_000);
      await gotoMenteeProfile(page);

      const loading = page.getByTestId('mentorship-mentee-profile-loading');
      const details = page.getByTestId('mentorship-mentee-profile-details');
      await expect(loading).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(details).toHaveCount(0);

      await expect(details).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
      await expect(loading).toHaveCount(0);
    });
  });

  test.describe('Empty state', () => {
    test.beforeEach(async ({ page }) => {
      await enableMentorshipFlag(page);
      await fulfillMenteeProfile(page, EMPTY_PROFILE);
      await gotoMenteeProfile(page);
      await expect(page.getByTestId('mentorship-mentee-profile-details')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    });

    test('attaches the empty-state testids and omits populated list nodes', async ({ page }) => {
      await expect(page.getByTestId('mentorship-mentee-profile-details-about-empty')).toBeAttached();
      await expect(page.getByTestId('mentorship-mentee-profile-details-skills-empty')).toBeAttached();
      await expect(page.getByTestId('mentorship-mentee-profile-details-areas-empty')).toBeAttached();
      await expect(page.getByTestId('mentorship-mentee-profile-details-notes-empty')).toBeAttached();
      await expect(page.getByTestId('mentorship-mentee-profile-details-resume-empty')).toBeAttached();
      await expect(page.getByTestId('mentorship-application-history-empty')).toBeAttached();

      await expect(page.getByTestId('mentorship-mentee-profile-details-about-text')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-mentee-profile-details-skills-list')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-mentee-profile-details-areas-list')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-mentee-profile-details-notes-text')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-mentee-profile-details-resume-link')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-application-history-list')).toHaveCount(0);
    });
  });

  test.describe('Error state', () => {
    test('replaces details and history with the error-state testid', async ({ page }) => {
      await enableMentorshipFlag(page);
      await page.route('**/api/mentorship/mentee/profile', (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Service Unavailable' }));
      await gotoMenteeProfile(page);

      await expect(page.getByTestId('mentorship-mentee-profile-error-state')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('mentorship-mentee-profile-details')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-application-history')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-mentee-profile-loading')).toHaveCount(0);
    });
  });
});
