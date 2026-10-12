// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor My Programs — cards, counts, empty and error states (linuxfoundation/lfx-mentorship#211).
 *
 * The page reads `/api/mentorship/mentor/programs`, which the BFF builds from the mentor's programs,
 * each card counted across all the program's terms. Each test stubs that read via `page.route` with a
 * synthetic payload, so the suite never depends on the signed-in user's real programs: one populated
 * payload proves the cards render with their project, Open/Completed status and counts, an empty one
 * drives the empty state, and a 503 drives the error state and its Retry.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the programs read is made by the
 * browser and the stub answers it; a direct `page.goto()` would read it during SSR, where no stub runs.
 * The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_PROGRAM_STATUS_LABELS } from '@lfx-one/shared/constants';
import { MentorshipMentorProgramsResponse } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, MENTOR_PROGRAMS_URL, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const OPEN_ID = '31111111-1111-4111-8111-111111111111';
const NO_PROJECT_ID = '32222222-2222-4222-8222-222222222222';
const COMPLETED_ID = '33333333-3333-4333-8333-333333333333';

const POPULATED: MentorshipMentorProgramsResponse = {
  data: [
    {
      id: OPEN_ID,
      slug: 'test-program-alpha',
      name: 'Test Program Alpha',
      projectName: 'Test Project',
      status: 'open',
      stats: { mentees: 3, tasksToReview: 2, applicants: 7 },
    },
    {
      id: NO_PROJECT_ID,
      slug: 'test-program-beta',
      name: 'Test Program Beta',
      projectName: '',
      status: 'open',
      stats: { mentees: 0, tasksToReview: 0, applicants: 4 },
    },
    {
      id: COMPLETED_ID,
      slug: 'test-program-gamma',
      name: 'Test Program Gamma',
      projectName: 'Test Project',
      status: 'completed',
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

  test('lists every program in the order the BFF returns them', async ({ page }) => {
    const cards = page.locator('[data-testid^="mentorship-mentor-program-card-"][role="button"]');
    await expect(cards).toHaveCount(3, { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(cards.nth(0)).toContainText('Test Program Alpha');
    await expect(cards.nth(1)).toContainText('Test Program Beta');
    await expect(cards.nth(2)).toContainText('Test Program Gamma');
  });

  test('shows each card with its project, status and counts', async ({ page }) => {
    const open = page.getByTestId(`mentorship-mentor-program-card-${OPEN_ID}`);
    await expect(open).toContainText('Test Project', { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(open).not.toContainText('·');
    await expect(open).toContainText(MENTORSHIP_PROGRAM_STATUS_LABELS.open);

    const metrics = open.getByTestId('mentorship-mentor-program-card-metrics');
    await expect(metrics).toContainText('Mentees');
    await expect(metrics).toContainText('3');
    await expect(metrics).toContainText('Tasks to Review');
    await expect(metrics).toContainText('2');
    await expect(metrics).toContainText('Applicants');
    await expect(metrics).toContainText('7');

    await expect(page.getByTestId(`mentorship-mentor-program-card-${NO_PROJECT_ID}`)).toContainText(MENTORSHIP_PROGRAM_STATUS_LABELS.open);
    await expect(page.getByTestId(`mentorship-mentor-program-card-${COMPLETED_ID}`)).toContainText(MENTORSHIP_PROGRAM_STATUS_LABELS.completed);
  });

  test('shows no project line when the program has no project', async ({ page }) => {
    const noProject = page.getByTestId(`mentorship-mentor-program-card-${NO_PROJECT_ID}`);
    await expect(noProject).toContainText('Test Program Beta', { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(noProject).not.toContainText('Test Project');
    await expect(noProject).not.toContainText('·');
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

    await expect(page.getByTestId(`mentorship-mentor-program-card-${OPEN_ID}`)).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(error).toHaveCount(0);
  });
});
