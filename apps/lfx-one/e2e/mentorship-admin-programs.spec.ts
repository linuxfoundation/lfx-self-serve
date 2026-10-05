// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin programs list — the real list, status badges, search, the status filter, load more, the failed-load state and Retry
 * (linuxfoundation/lfx-mentorship#232).
 *
 * The page reads `/api/mentorship/admin/programs`, which the BFF serves from upstream `GET /me/programs`.
 * Each test stubs that read via `page.route` with a synthetic payload, so the suite never
 * depends on upstream data: one payload proves each program's name, project, term and status badge, another
 * a failed read followed by a successful Retry.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the read is made by the browser and
 * the stub answers it; a direct `page.goto()` would read it during SSR, where no stub runs. The module is
 * behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipProgram, MentorshipProgramsResponse } from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const ADMIN_URL = '/mentorship/admin';
const PROGRAMS_ROUTE = '**/api/mentorship/admin/programs*';

const OPEN_ID = '71111111-1111-4111-8111-111111111111';
const PENDING_ID = '72222222-2222-4222-8222-222222222222';
const REJECTED_ID = '73333333-3333-4333-8333-333333333333';
const HIDDEN_ID = '74444444-4444-4444-8444-444444444444';

const program = (id: string, name: string, status: MentorshipProgram['status'], term: string): MentorshipProgram => ({
  id,
  slug: id,
  name,
  projectName: 'Test Project',
  term,
  status,
  stats: { mentors: 1, mentees: 2, graduated: 0 },
  createdOn: '2026-06-01',
  updatedOn: '2026-07-20',
});

const POPULATED: MentorshipProgramsResponse = {
  data: [
    program(OPEN_ID, 'Test Program Open', 'open', 'Test Term Open'),
    program(PENDING_ID, 'Test Program Pending', 'pending-review', ''),
    program(REJECTED_ID, 'Test Program Rejected', 'rejected', ''),
    program(HIDDEN_ID, 'Test Program Hidden', 'hidden', 'Test Term Closed'),
  ],
  total: 4,
};

const fulfillJson = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function stubPrograms(page: Page, body: MentorshipProgramsResponse): Promise<void> {
  await page.route(PROGRAMS_ROUTE, (route) => fulfillJson(route, body));
}

test.describe('Admin programs list — real programs', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubPrograms(page, POPULATED);
    await openMentorPage(page, ADMIN_URL);
  });

  test('lists one card per program the BFF returns', async ({ page }) => {
    await expect(page.getByTestId(`mentorship-program-card-${OPEN_ID}`)).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-programs-cards')).toHaveCount(4);
    await expect(page.getByTestId(`mentorship-program-card-${OPEN_ID}`)).toContainText('Test Program Open');
    await expect(page.getByTestId(`mentorship-program-card-${OPEN_ID}`)).toContainText('Test Project · Test Term Open');
  });

  test('shows each program status badge, and no dangling separator when the term is empty', async ({ page }) => {
    await expect(page.getByTestId(`mentorship-program-card-${PENDING_ID}`)).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    const badge = (id: string) => page.getByTestId(`mentorship-program-card-${id}`).getByTestId('mentorship-program-card-status');
    await expect(badge(OPEN_ID)).toHaveText('Open');
    await expect(badge(PENDING_ID)).toHaveText('Pending Review');
    await expect(badge(REJECTED_ID)).toHaveText('Rejected');
    await expect(badge(HIDDEN_ID)).toHaveText('Hidden');
    await expect(page.getByTestId(`mentorship-program-card-${PENDING_ID}`)).not.toContainText('·');
  });

  test('does not show the load error when the read succeeds', async ({ page }) => {
    await expect(page.getByTestId(`mentorship-program-card-${OPEN_ID}`)).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-admin-programs-load-error')).toHaveCount(0);
  });
});

test.describe('Admin programs list — search, status filter and load more', () => {
  // Each read is answered by its query, so a test proves which request the control made.
  const pageOf = (...data: MentorshipProgram[]): MentorshipProgramsResponse => ({ data, total: data.length });
  const card = (page: Page, id: string) => page.getByTestId(`mentorship-program-card-${id}`);

  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await page.route(PROGRAMS_ROUTE, (route) => {
      const params = new URL(route.request().url()).searchParams;
      if (params.get('search') === 'Hidden') return fulfillJson(route, pageOf(POPULATED.data[3]));
      if (params.get('status') === 'rejected') return fulfillJson(route, pageOf(POPULATED.data[2]));
      // An unfiltered list of two, served a page at a time: offset 0, then offset 12 (one page size on).
      const second = params.get('offset') === '12';
      return fulfillJson(route, { data: [POPULATED.data[second ? 1 : 0]], total: 2 });
    });
    await openMentorPage(page, ADMIN_URL);
    await expect(card(page, OPEN_ID)).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  });

  test('Load more appends the next page and goes once every program is listed', async ({ page }) => {
    await expect(page.getByTestId('mentorship-programs-cards')).toHaveCount(1);

    await page.getByTestId('mentorship-programs-load-more').getByRole('button', { name: 'Load more' }).click();

    await expect(card(page, PENDING_ID)).toBeVisible();
    await expect(page.getByTestId('mentorship-programs-cards')).toHaveCount(2);
    await expect(page.getByTestId('mentorship-programs-load-more')).toHaveCount(0);
  });

  test('search replaces the page with the matching programs', async ({ page }) => {
    await page.locator('[data-test="mentorship-programs-search"]').fill('Hidden');

    await expect(card(page, HIDDEN_ID)).toBeVisible();
    await expect(page.getByTestId('mentorship-programs-cards')).toHaveCount(1);
  });

  test('the status filter replaces the page with programs in that status', async ({ page }) => {
    await page.getByTestId('mentorship-programs-status-filter').locator('.p-select').first().click();
    await page.getByRole('option', { name: 'Rejected', exact: true }).click();

    await expect(card(page, REJECTED_ID)).toBeVisible();
    await expect(page.getByTestId('mentorship-programs-cards')).toHaveCount(1);
  });
});

test.describe('Admin programs list — failed load', () => {
  test('shows an inline error with Retry, and lists the programs once Retry succeeds', async ({ page }) => {
    await enableMentorshipFlag(page);
    let failing = true;
    await page.route(PROGRAMS_ROUTE, (route) =>
      failing ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) }) : fulfillJson(route, POPULATED)
    );
    await openMentorPage(page, ADMIN_URL);

    await expect(page.getByTestId('mentorship-admin-programs-load-error')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-programs-empty-state')).toHaveCount(0);

    failing = false;
    await page.getByTestId('mentorship-admin-programs-retry').click();

    await expect(page.getByTestId(`mentorship-program-card-${OPEN_ID}`)).toBeVisible();
    await expect(page.getByTestId('mentorship-admin-programs-load-error')).toHaveCount(0);
  });
});
