// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor My Programs — cards, counts, empty and error states (linuxfoundation/lfx-mentorship#211).
 *
 * The page reads `/api/mentorship/mentor/programs`, which the BFF builds from the mentor's programs,
 * each card counted from its chosen term's applications and submitted tasks. Each test stubs that read
 * via `page.route` with a synthetic payload, so the suite never depends on the signed-in user's real
 * programs: one populated payload proves the cards render in their groups with their counts, an empty
 * one drives the empty state, and a 503 drives the error state and its Retry.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the programs read is made by the
 * browser and the stub answers it; a direct `page.goto()` would read it during SSR, where no stub runs.
 * The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipMentorProgramsResponse } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, MENTOR_PROGRAMS_URL, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const ACTIVE_ID = '31111111-1111-4111-8111-111111111111';
const UPCOMING_ID = '32222222-2222-4222-8222-222222222222';
const COMPLETED_ID = '33333333-3333-4333-8333-333333333333';

const POPULATED: MentorshipMentorProgramsResponse = {
  data: [
    {
      id: ACTIVE_ID,
      slug: 'test-program-alpha',
      name: 'Test Program Alpha',
      projectName: 'Test Project',
      term: 'Test Term Fall',
      termStatus: 'active-term',
      stats: { mentees: 3, tasksToReview: 2, applicants: 7 },
    },
    {
      id: UPCOMING_ID,
      slug: 'test-program-beta',
      name: 'Test Program Beta',
      projectName: '',
      term: 'Test Term Winter',
      termStatus: 'upcoming',
      stats: { mentees: 0, tasksToReview: 0, applicants: 4 },
    },
    {
      id: COMPLETED_ID,
      slug: 'test-program-gamma',
      name: 'Test Program Gamma',
      projectName: 'Test Project',
      term: 'Test Term Spring',
      termStatus: 'completed',
      stats: { mentees: 5, tasksToReview: 0, applicants: 9 },
    },
  ],
  total: 3,
};

/** Answers the programs read with `body`, or with `status` and a plain-text body when it is not 200. */
async function stubPrograms(page: Page, body: MentorshipMentorProgramsResponse, status = 200): Promise<void> {
  await page.route('**/api/mentorship/mentor/programs', (route) =>
    status === 200
      ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      : route.fulfill({ status, contentType: 'text/plain', body: 'Service Unavailable' })
  );
}

test.describe('Mentor My Programs — loaded', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubPrograms(page, POPULATED);
    await openMentorPage(page, MENTOR_PROGRAMS_URL);
  });

  test('lists every program in the order the BFF groups them', async ({ page }) => {
    const cards = page.locator('[data-testid^="mentorship-mentor-program-card-"][role="button"]');
    await expect(cards).toHaveCount(3, { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(cards.nth(0)).toContainText('Test Program Alpha');
    await expect(cards.nth(1)).toContainText('Test Program Beta');
    await expect(cards.nth(2)).toContainText('Test Program Gamma');
  });

  test('shows each card with its project, term, group and counts', async ({ page }) => {
    const active = page.getByTestId(`mentorship-mentor-program-card-${ACTIVE_ID}`);
    await expect(active).toContainText('Test Project · Test Term Fall', { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(active).toContainText(MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS['active-term']);

    const metrics = active.getByTestId('mentorship-mentor-program-card-metrics');
    await expect(metrics).toContainText('Mentees');
    await expect(metrics).toContainText('3');
    await expect(metrics).toContainText('Tasks to Review');
    await expect(metrics).toContainText('2');
    await expect(metrics).toContainText('Applicants');
    await expect(metrics).toContainText('7');

    await expect(page.getByTestId(`mentorship-mentor-program-card-${UPCOMING_ID}`)).toContainText(MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS.upcoming);
    await expect(page.getByTestId(`mentorship-mentor-program-card-${COMPLETED_ID}`)).toContainText(MENTORSHIP_MENTOR_PROGRAM_TERM_STATUS_LABELS.completed);
  });

  test('shows only the term when the program has no project', async ({ page }) => {
    const upcoming = page.getByTestId(`mentorship-mentor-program-card-${UPCOMING_ID}`);
    await expect(upcoming).toContainText('Test Term Winter', { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(upcoming).not.toContainText('·');
  });
});

test.describe('Mentor My Programs — empty state', () => {
  test('shows the empty state when the mentor has no programs', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubPrograms(page, { data: [], total: 0 });
    await openMentorPage(page, MENTOR_PROGRAMS_URL);

    const empty = page.getByTestId('mentorship-mentor-programs-empty-state');
    await expect(empty).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(empty).toContainText('No programs yet');
    await expect(page.getByTestId('mentorship-mentor-programs-cards')).toHaveCount(0);
  });
});

test.describe('Mentor My Programs — error state', () => {
  test('shows the error state and loads the programs on Retry', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubPrograms(page, POPULATED, 503);
    await openMentorPage(page, MENTOR_PROGRAMS_URL);

    const error = page.getByTestId('mentorship-mentor-programs-error-state');
    await expect(error).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(error).toContainText('Could not load your programs');

    await page.unroute('**/api/mentorship/mentor/programs');
    await stubPrograms(page, POPULATED);
    await error.getByRole('button', { name: 'Retry' }).click();

    await expect(page.getByTestId(`mentorship-mentor-program-card-${ACTIVE_ID}`)).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(error).toHaveCount(0);
  });
});
