// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor My Programs — structural / data-testid contract (linuxfoundation/lfx-mentorship#211).
 *
 * Companion to `mentorship-mentor-programs.spec.ts` (content + empty/error copy). This spec asserts
 * presence, nesting, the dynamic card-id suffixes, and the loading/error/empty structural states without
 * user-facing copy. Every read is stubbed with synthetic data and reached by client-side navigation.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipMentorProgramsResponse } from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, MENTOR_PROGRAMS_URL, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PROGRAMS_ROUTE = '**/api/mentorship/mentor/programs';
const FIRST_ID = '41111111-1111-4111-8111-111111111111';
const SECOND_ID = '42222222-2222-4222-8222-222222222222';

const POPULATED: MentorshipMentorProgramsResponse = {
  data: [
    {
      id: FIRST_ID,
      slug: 'program-a',
      name: 'Program A',
      projectName: 'Project A',
      status: 'open',
      stats: { mentees: 1, tasksToReview: 1, applicants: 1 },
    },
    {
      id: SECOND_ID,
      slug: 'program-b',
      name: 'Program B',
      projectName: 'Project B',
      status: 'completed',
      stats: { mentees: 0, tasksToReview: 0, applicants: 0 },
    },
  ],
  total: 2,
};

const fulfillJson = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function stubPrograms(page: Page, body: MentorshipMentorProgramsResponse): Promise<void> {
  await page.route(PROGRAMS_ROUTE, (route) => fulfillJson(route, body));
}

test.describe('Mentor My Programs — structure', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubPrograms(page, POPULATED);
    await openMentorPage(page, MENTOR_PROGRAMS_URL);
  });

  test('wraps one card per program in the list, each keyed by program id', async ({ page }) => {
    const list = page.getByTestId('mentorship-mentor-programs-list');
    await expect(list).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(list.getByTestId('mentorship-mentor-programs-cards')).toHaveCount(2);
    await expect(list.getByTestId(`mentorship-mentor-program-card-${FIRST_ID}`)).toBeVisible();
    await expect(list.getByTestId(`mentorship-mentor-program-card-${SECOND_ID}`)).toBeVisible();
  });

  test('gives every card its metrics block and a button role', async ({ page }) => {
    for (const id of [FIRST_ID, SECOND_ID]) {
      const card = page.getByTestId(`mentorship-mentor-program-card-${id}`);
      await expect(card).toHaveAttribute('role', 'button', { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
      await expect(card).toHaveAttribute('tabindex', '0');
      await expect(card.getByTestId('mentorship-mentor-program-card-metrics')).toHaveCount(1);
    }
  });

  test('renders neither the empty nor the error state', async ({ page }) => {
    await expect(page.getByTestId(`mentorship-mentor-program-card-${FIRST_ID}`)).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-programs-empty-state')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentor-programs-error-state')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentor-programs-loading')).toHaveCount(0);
  });
});

test.describe('Mentor My Programs — structural states', () => {
  test('shows the loading state while the programs read is in flight', async ({ page }) => {
    await enableMentorshipFlag(page);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(PROGRAMS_ROUTE, async (route) => {
      await held;
      await fulfillJson(route, POPULATED);
    });
    await openMentorPage(page, MENTOR_PROGRAMS_URL);

    await expect(page.getByTestId('mentorship-mentor-programs-loading')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    release();
    await expect(page.getByTestId('mentorship-mentor-programs-loading')).toHaveCount(0, { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-programs-cards')).toHaveCount(2);
  });

  test('shows only the empty state when there are no programs', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubPrograms(page, { data: [], total: 0 });
    await openMentorPage(page, MENTOR_PROGRAMS_URL);

    await expect(page.getByTestId('mentorship-mentor-programs-empty-state')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-programs-cards')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentor-programs-error-state')).toHaveCount(0);
  });

  test('shows only the error state when the programs read fails', async ({ page }) => {
    await enableMentorshipFlag(page);
    await page.route(PROGRAMS_ROUTE, (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Service Unavailable' }));
    await openMentorPage(page, MENTOR_PROGRAMS_URL);

    await expect(page.getByTestId('mentorship-mentor-programs-error-state')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-programs-cards')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentor-programs-empty-state')).toHaveCount(0);
  });
});
