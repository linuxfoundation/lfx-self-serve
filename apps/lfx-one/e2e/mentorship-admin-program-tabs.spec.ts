// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin program detail — the Current Mentees and Past Mentees tabs (linuxfoundation/lfx-mentorship#231).
 *
 * The page reads `/api/mentorship/admin/programs/:programId`, which the BFF builds by splitting the
 * program's applications by their term's status: an open term's rows are current, a closed term's are
 * past, whatever the row's own status. Each test stubs that read via `page.route` with a synthetic
 * payload, so the suite never depends on the BFF's mock programs: one populated payload proves the tab
 * counts, each tab's rows (including an "On hold" row), the row actions by status and each tab's term
 * options, and an empty one drives the two tabs' empty messages.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the detail read is made by the
 * browser and the stub answers it; a direct `page.goto()` would read it during SSR, where no stub runs.
 * The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipProgramApplicant, MentorshipProgramDetail, MentorshipProgramTermRow } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PROGRAM_ID = '61111111-1111-4111-8111-111111111111';
const DETAIL_URL = `/mentorship/admin/${PROGRAM_ID}`;
const DETAIL_ROUTE = `**/api/mentorship/admin/programs/${PROGRAM_ID}`;
const PENDING_ID = '62222222-2222-4222-8222-222222222222';
const HOLD_ID = '63333333-3333-4333-8333-333333333333';
const ACCEPTED_ID = '64444444-4444-4444-8444-444444444444';
const GRADUATED_ID = '65555555-5555-4555-8555-555555555555';

const OPEN_TERM = 'Test Term Open';
const CLOSED_TERM = 'Test Term Closed';

const term = (id: string, name: string, status: MentorshipProgramTermRow['status']): MentorshipProgramTermRow => ({
  id,
  name,
  status,
  pending: 0,
  declined: 0,
  accepted: 0,
  graduated: 0,
  startDate: '2026-09-01',
  endDate: '2026-11-30',
  applicationStartDate: '2026-07-01',
  applicationEndDate: '2026-08-15',
});

const application = (id: string, name: string, status: MentorshipProgramApplicant['status'], termName: string): MentorshipProgramApplicant => ({
  id,
  name,
  email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
  status,
  termName,
  createdOn: '2026-07-10',
  updatedOn: '2026-07-20',
});

const PROGRAM: MentorshipProgramDetail['program'] = {
  id: PROGRAM_ID,
  slug: 'test-program-admin',
  name: 'Test Program Admin',
  projectName: 'Test Project',
  term: OPEN_TERM,
  status: 'open',
  stats: { mentors: 0, mentees: 1, graduated: 1 },
  createdOn: '2026-06-01',
  updatedOn: '2026-07-20',
};

const TERMS = [term('66666666-6666-4666-8666-666666666666', OPEN_TERM, 'open'), term('67777777-7777-4777-8777-777777777777', CLOSED_TERM, 'closed')];

const POPULATED: MentorshipProgramDetail = {
  program: PROGRAM,
  tabCounts: { currentMentees: 3, pastMentees: 1, mentors: 0, terms: 2 },
  currentMentees: [
    application(PENDING_ID, 'Test Applicant One', 'pending', OPEN_TERM),
    application(HOLD_ID, 'Test Applicant Two', 'hold', OPEN_TERM),
    application(ACCEPTED_ID, 'Test Mentee Three', 'accepted', OPEN_TERM),
  ],
  pastMentees: [application(GRADUATED_ID, 'Test Mentee Four', 'graduated', CLOSED_TERM)],
  mentors: [],
  terms: TERMS,
};

const EMPTY: MentorshipProgramDetail = {
  ...POPULATED,
  tabCounts: { currentMentees: 0, pastMentees: 0, mentors: 0, terms: 2 },
  currentMentees: [],
  pastMentees: [],
};

async function stubDetail(page: Page, body: MentorshipProgramDetail): Promise<void> {
  await page.route(DETAIL_ROUTE, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
}

/** Opens a tab's term select and returns the option labels it lists. */
async function termOptions(page: Page, dataTest: string): Promise<string[]> {
  await page.locator(`[data-test="${dataTest}"]`).click();
  const options = page.getByRole('option');
  await expect(options.first()).toBeVisible();
  const labels = (await options.allTextContents()).map((label) => label.trim());
  await page.keyboard.press('Escape');
  return labels;
}

test.describe('Admin program detail — mentee tabs', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubDetail(page, POPULATED);
    await openMentorPage(page, DETAIL_URL);
  });

  test('shows the four tabs, each with its count', async ({ page }) => {
    await expect(page.getByTestId('mentorship-program-detail-title')).toHaveText('Test Program Admin', { timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-program-detail-tab-current-mentees')).toHaveText(/Current Mentees\s*3/);
    await expect(page.getByTestId('mentorship-program-detail-tab-past-mentees')).toHaveText(/Past Mentees\s*1/);
    await expect(page.getByTestId('mentorship-program-detail-tab-mentors')).toHaveText(/Mentors\s*0/);
    await expect(page.getByTestId('mentorship-program-detail-tab-terms')).toHaveText(/Terms\s*2/);
  });

  test('opens on Current Mentees with the open-term rows, including the one on hold', async ({ page }) => {
    await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(page.locator('[data-testid^="mentorship-current-mentee-row-"]')).toHaveCount(3);
    await expect(page.getByTestId(`mentorship-current-mentee-row-${PENDING_ID}`)).toContainText('Test Applicant One');
    await expect(page.getByTestId(`mentorship-current-mentee-row-${HOLD_ID}`)).toContainText('On hold');
    await expect(page.getByTestId(`mentorship-current-mentee-row-${ACCEPTED_ID}`)).toContainText('Test Mentee Three');
    await expect(page.getByTestId(`mentorship-current-mentee-row-${GRADUATED_ID}`)).toHaveCount(0);
  });

  test('offers the row actions that fit each status', async ({ page }) => {
    const pendingActions = page.getByTestId(`mentorship-current-mentee-actions-${PENDING_ID}`);
    await pendingActions.click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByRole('menuitem')).toHaveText(['Accept', 'Decline', 'Withdraw']);
    // The trigger toggles its popup, so a second click closes it before the next row's opens.
    await pendingActions.click();
    await expect(page.getByRole('menuitem')).toHaveCount(0);

    await page.getByTestId(`mentorship-current-mentee-actions-${ACCEPTED_ID}`).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Create task', 'Graduate', 'Decline', 'Withdraw']);
  });

  test('lists only the open terms on Current Mentees', async ({ page }) => {
    await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    expect(await termOptions(page, 'mentorship-current-mentees-term')).toEqual(['All open terms', OPEN_TERM]);
  });

  test('shows the closed-term rows on Past Mentees, with only the closed terms to filter by', async ({ page }) => {
    await page.getByTestId('mentorship-program-detail-tab-past-mentees').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(page.locator('[data-testid^="mentorship-past-mentee-row-"]')).toHaveCount(1);
    await expect(page.getByTestId(`mentorship-past-mentee-row-${GRADUATED_ID}`)).toContainText('Test Mentee Four');

    expect(await termOptions(page, 'mentorship-past-mentees-term')).toEqual(['All closed terms', CLOSED_TERM]);
  });
});

test.describe('Admin program detail — empty mentee tabs', () => {
  test('shows each mentee tab empty with a zero count', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubDetail(page, EMPTY);
    await openMentorPage(page, DETAIL_URL);

    await expect(page.getByTestId('mentorship-program-detail-tab-current-mentees')).toHaveText(/Current Mentees\s*0/, { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-current-mentees-empty')).toHaveText('No current mentees.');

    await page.getByTestId('mentorship-program-detail-tab-past-mentees').click();
    await expect(page.getByTestId('mentorship-program-detail-tab-past-mentees')).toHaveText(/Past Mentees\s*0/);
    await expect(page.getByTestId('mentorship-past-mentees-empty')).toHaveText('No past mentees.');
  });
});
