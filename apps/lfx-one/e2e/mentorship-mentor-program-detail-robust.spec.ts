// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor program detail — structural / data-testid contract (linuxfoundation/lfx-mentorship#212).
 *
 * Companion to `mentorship-mentor-program-detail.spec.ts` (content + empty/not-found/error copy). This
 * spec asserts presence, the tablist/tabpanel wiring, the application-id row suffixes, and the
 * loading/error/not-found structural states without user-facing copy. Every read is stubbed with
 * synthetic data and reached by client-side navigation.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipMentorProgramDetail } from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, MENTOR_PROGRAMS_URL, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PROGRAM_ID = '61111111-1111-4111-8111-111111111111';
const DETAIL_URL = `${MENTOR_PROGRAMS_URL}/${PROGRAM_ID}`;
const DETAIL_ROUTE = `**/api/mentorship/mentor/programs/${PROGRAM_ID}`;
const MENTEE_ID = '62222222-2222-4222-8222-222222222222';
const APPLICANT_ID = '63333333-3333-4333-8333-333333333333';
const OTHER_PROGRAM_ID = '64444444-4444-4444-8444-444444444444';

const MENTEE: MentorshipMentorProgramDetail['mentees'][number] = {
  id: MENTEE_ID,
  name: 'Person A',
  email: 'person.a@example.com',
  status: 'accepted',
  termName: 'Term A',
  tasksSubmitted: 0,
  tasksTotal: 0,
  tasks: [],
};

const POPULATED: MentorshipMentorProgramDetail = {
  program: {
    id: PROGRAM_ID,
    slug: 'program-a',
    name: 'Program A',
    projectName: 'Project A',
    term: 'Term A',
    termStatus: 'active-term',
    stats: { mentees: 1, tasksToReview: 0, applicants: 2 },
  },
  tabCounts: { tasks: 0, mentees: 1, applicants: 2 },
  mentees: [MENTEE],
  applicants: [
    { ...MENTEE, createdOn: '2026-08-01', updatedOn: '2026-08-02' },
    {
      id: APPLICANT_ID,
      name: 'Person B',
      email: 'person.b@example.com',
      status: 'pending',
      termName: 'Term A',
      createdOn: '2026-08-03',
      updatedOn: '2026-08-04',
      otherApplications: [{ programId: OTHER_PROGRAM_ID, programName: 'Program B', status: 'pending' }],
    },
  ],
};

const TABS = ['tasks', 'mentees', 'applicants'] as const;

const fulfillJson = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function stubDetail(page: Page, body: MentorshipMentorProgramDetail): Promise<void> {
  await page.route(DETAIL_ROUTE, (route) => fulfillJson(route, body));
}

test.describe('Mentor program detail — structure', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubDetail(page, POPULATED);
    await openMentorPage(page, DETAIL_URL);
  });

  test('renders the back link, the header and one tab per section', async ({ page }) => {
    const detail = page.getByTestId('mentorship-mentor-program-detail');
    await expect(detail.getByTestId('mentorship-mentor-program-detail-header')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(detail.getByTestId('mentorship-mentor-program-detail-back')).toHaveCount(1);
    await expect(detail.getByTestId('mentorship-mentor-program-detail-title')).toHaveCount(1);
    await expect(detail.getByTestId('mentorship-mentor-program-detail-season')).toHaveCount(1);
    await expect(detail.getByTestId('mentorship-mentor-program-detail-status')).toHaveCount(1);

    const tablist = page.getByTestId('mentorship-mentor-program-detail-tabs');
    await expect(tablist).toHaveAttribute('role', 'tablist');
    await expect(tablist.getByRole('tab')).toHaveCount(TABS.length);
    for (const tab of TABS) {
      await expect(tablist.getByTestId(`mentorship-mentor-program-detail-tab-${tab}`)).toHaveAttribute('role', 'tab');
    }
  });

  test('selects Tasks first and wires each selected tab to its panel', async ({ page }) => {
    for (const tab of TABS) {
      const trigger = page.getByTestId(`mentorship-mentor-program-detail-tab-${tab}`);
      await trigger.click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
      await expect(trigger).toHaveAttribute('aria-selected', 'true');
      await expect(trigger).toHaveAttribute('aria-controls', `mentorship-mentor-program-detail-tab-panel-${tab}`);
      const panel = page.locator(`#mentorship-mentor-program-detail-tab-panel-${tab}`);
      await expect(panel).toHaveAttribute('role', 'tabpanel');
      await expect(panel.getByTestId(`mentorship-mentor-${tab}-tab`)).toHaveCount(1);
    }
  });

  test('keys mentee and applicant rows by application id', async ({ page }) => {
    await page.getByTestId('mentorship-mentor-program-detail-tab-mentees').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(`mentorship-mentor-mentee-row-${MENTEE_ID}`)).toHaveCount(1);

    await page.getByTestId('mentorship-mentor-program-detail-tab-applicants').click();
    await page.getByTestId('mentorship-mentor-applicants-status-pill-all').click();
    await expect(page.getByTestId(`mentorship-mentor-applicant-row-${MENTEE_ID}`)).toHaveCount(1);
    await expect(page.getByTestId(`mentorship-mentor-applicant-row-${APPLICANT_ID}`)).toHaveCount(1);
    const other = page.getByTestId(`mentorship-mentor-applicant-row-${APPLICANT_ID}`).getByTestId('mentorship-mentor-applicant-other-application');
    await expect(other).toHaveCount(1);
    const link = other.getByTestId('mentorship-mentor-applicant-other-application-link');
    await expect(link).toHaveAttribute('href', new RegExp(`/programs/${OTHER_PROGRAM_ID}$`));
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(other.getByTestId('mentorship-mentor-applicant-other-application-status')).toHaveCount(1);
  });

  test('renders none of the loading, error or not-found states', async ({ page }) => {
    await expect(page.getByTestId('mentorship-mentor-program-detail-header')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-program-detail-loading')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentor-program-detail-error-state')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentor-program-detail-not-found')).toHaveCount(0);
  });
});

test.describe('Mentor program detail — structural states', () => {
  test('shows the loading state while the detail read is in flight', async ({ page }) => {
    await enableMentorshipFlag(page);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(DETAIL_ROUTE, async (route) => {
      await held;
      await fulfillJson(route, POPULATED);
    });
    await openMentorPage(page, DETAIL_URL);

    await expect(page.getByTestId('mentorship-mentor-program-detail-loading')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    release();
    await expect(page.getByTestId('mentorship-mentor-program-detail-loading')).toHaveCount(0, { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-program-detail-header')).toHaveCount(1);
  });

  test('shows only the not-found state on a 404', async ({ page }) => {
    await enableMentorshipFlag(page);
    await page.route(DETAIL_ROUTE, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not found' }) }));
    await openMentorPage(page, DETAIL_URL);

    await expect(page.getByTestId('mentorship-mentor-program-detail-not-found')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-program-detail-header')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentor-program-detail-error-state')).toHaveCount(0);
  });

  test('shows only the error state when the detail read fails', async ({ page }) => {
    await enableMentorshipFlag(page);
    await page.route(DETAIL_ROUTE, (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'Service Unavailable' }));
    await openMentorPage(page, DETAIL_URL);

    await expect(page.getByTestId('mentorship-mentor-program-detail-error-state')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-program-detail-header')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-mentor-program-detail-not-found')).toHaveCount(0);
  });
});
