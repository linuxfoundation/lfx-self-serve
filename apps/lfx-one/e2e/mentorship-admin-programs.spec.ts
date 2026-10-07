// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin programs list — the real list, status badges, search, the status filter, load more, the failed-load state and Retry
 * (linuxfoundation/lfx-mentorship#232), and the "Logo missing" hint with its "Add logo" upload (linuxfoundation/lfx-mentorship#261).
 *
 * The page reads `/api/mentorship/admin/programs`, which the BFF serves from upstream `GET /me/programs`.
 * Each test stubs that read via `page.route` with a synthetic payload, so the suite never
 * depends on upstream data: one payload proves each program's name, project, term and status badge, another
 * a failed read followed by a successful Retry. The logo upload is stubbed too (`page.route` on `.../programs/:id/logo`), so
 * nothing is ever sent to a real bucket.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the read is made by the browser and
 * the stub answers it; a direct `page.goto()` would read it during SSR, where no stub runs. The module is
 * behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_PROGRAM_CARD_ADD_LOGO, MENTORSHIP_PROGRAM_CARD_LOGO_ADDED, MENTORSHIP_PROGRAM_CARD_LOGO_FORBIDDEN } from '@lfx-one/shared/constants';
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

test.describe('Admin programs list — logo missing', () => {
  const LOGO_ROUTE = '**/api/mentorship/admin/programs/*/logo';
  const PENDING_NO_LOGO_ID = '75555555-5555-4555-8555-555555555555';
  const PUBLISHED_NO_LOGO_ID = '76666666-6666-4666-8666-666666666666';
  const PENDING_WITH_LOGO_ID = '77777777-7777-4777-8777-777777777777';
  const REJECTED_NO_LOGO_ID = '78888888-8888-4888-8888-888888888888';

  // Rows as the BFF maps them: `logoMissing` is set for an upstream `pending` or `published` program without a logo only.
  const rows = (pendingLogoAdded = false): MentorshipProgramsResponse => ({
    data: [
      { ...program(PENDING_NO_LOGO_ID, 'Acme Rocket Mentorship', 'pending-review', ''), logoMissing: !pendingLogoAdded },
      { ...program(PUBLISHED_NO_LOGO_ID, 'Acme Orbit Mentorship', 'open', 'Test Term Open'), logoMissing: true },
      { ...program(PENDING_WITH_LOGO_ID, 'Acme Lander Mentorship', 'pending-review', ''), logoMissing: false },
      { ...program(REJECTED_NO_LOGO_ID, 'Acme Probe Mentorship', 'rejected', ''), logoMissing: false },
    ],
    total: 4,
  });

  const PNG = { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) };
  const card = (page: Page, id: string) => page.getByTestId(`mentorship-program-card-${id}`);

  /** Every write the page sends to the mentorship BFF, so a test proves the upload is the only one. */
  const trackWrites = (page: Page): string[] => {
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().includes('/api/mentorship/')) writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    return writes;
  };

  async function addLogo(page: Page, id: string): Promise<void> {
    const chooser = page.waitForEvent('filechooser');
    await card(page, id)
      .getByTestId('mentorship-program-card-finish')
      .getByRole('button', { name: new RegExp(MENTORSHIP_PROGRAM_CARD_ADD_LOGO) })
      .click();
    await (await chooser).setFiles(PNG);
  }

  test('shows the hint on a pending or published program without a logo, and on no other', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubPrograms(page, rows());
    await openMentorPage(page, ADMIN_URL);
    await expect(card(page, PENDING_NO_LOGO_ID)).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    for (const id of [PENDING_NO_LOGO_ID, PUBLISHED_NO_LOGO_ID]) {
      await expect(card(page, id).getByTestId('mentorship-program-card-hint')).toHaveText('Logo missing');
      await expect(card(page, id).getByTestId('mentorship-program-card-finish')).toContainText('Add logo');
    }
    for (const id of [PENDING_WITH_LOGO_ID, REJECTED_NO_LOGO_ID]) {
      await expect(card(page, id).getByTestId('mentorship-program-card-hint')).toHaveCount(0);
      await expect(card(page, id).getByTestId('mentorship-program-card-finish')).toHaveCount(0);
    }
  });

  test('Add logo uploads the picked PNG, stays on the list, and the reloaded list drops the hint', async ({ page }) => {
    await enableMentorshipFlag(page);
    let logoAdded = false;
    await page.route(PROGRAMS_ROUTE, (route) => fulfillJson(route, rows(logoAdded)));
    const logoRequests: string[] = [];
    await page.route(LOGO_ROUTE, (route) => {
      logoRequests.push(route.request().headers()['content-type'] ?? '');
      logoAdded = true;
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ logoUrl: 'https://cdn.example/logo.png' }) });
    });
    const writes = trackWrites(page);
    await openMentorPage(page, ADMIN_URL);
    await expect(card(page, PENDING_NO_LOGO_ID).getByTestId('mentorship-program-card-hint')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await addLogo(page, PENDING_NO_LOGO_ID);

    await expect(page.getByText(MENTORSHIP_PROGRAM_CARD_LOGO_ADDED)).toBeVisible();
    await expect(card(page, PENDING_NO_LOGO_ID).getByTestId('mentorship-program-card-hint')).toHaveCount(0);
    await expect(page).toHaveURL(/\/mentorship\/admin$/);
    expect(logoRequests).toEqual(['image/png']);
    expect(writes).toEqual([`POST /api/mentorship/admin/programs/${PENDING_NO_LOGO_ID}/logo`]);
  });

  test('a 403 shows the permission message once, with no back-off, and keeps the hint', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubPrograms(page, rows());
    let logoRequests = 0;
    await page.route(LOGO_ROUTE, (route) => {
      logoRequests++;
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) });
    });
    await openMentorPage(page, ADMIN_URL);
    await expect(card(page, PUBLISHED_NO_LOGO_ID).getByTestId('mentorship-program-card-hint')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await addLogo(page, PUBLISHED_NO_LOGO_ID);

    await expect(page.getByText(MENTORSHIP_PROGRAM_CARD_LOGO_FORBIDDEN)).toBeVisible();
    await expect(card(page, PUBLISHED_NO_LOGO_ID).getByTestId('mentorship-program-card-hint')).toBeVisible();
    await expect(card(page, PUBLISHED_NO_LOGO_ID).getByTestId('mentorship-program-card-finish')).toBeVisible();
    await expect(page).toHaveURL(/\/mentorship\/admin$/);
    expect(logoRequests).toBe(1);
  });
});
