// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin programs list — structural / data-testid contract (linuxfoundation/lfx-mentorship#232), including the
 * "Logo missing" hint, its "Add logo" button and hidden file input (linuxfoundation/lfx-mentorship#261).
 *
 * Companion to `mentorship-admin-programs.spec.ts` (content). This spec asserts presence, nesting, the
 * dynamic card-id suffixes, and the error/empty structural states without user-facing copy.
 * Every read is stubbed with synthetic data and reached by client-side navigation; the logo upload is stubbed too.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipProgramsResponse } from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const ADMIN_URL = '/mentorship/admin';
const PROGRAMS_ROUTE = '**/api/mentorship/admin/programs*';
const FIRST_ID = '81111111-1111-4111-8111-111111111111';
const SECOND_ID = '82222222-2222-4222-8222-222222222222';

const POPULATED: MentorshipProgramsResponse = {
  data: [
    {
      id: FIRST_ID,
      slug: 'program-a',
      name: 'Program A',
      projectName: 'Project A',
      status: 'open',
      stats: { mentors: 1, mentees: 1, graduated: 0 },
      createdOn: '2026-06-01',
      updatedOn: '2026-07-20',
    },
    {
      id: SECOND_ID,
      slug: 'program-b',
      name: 'Program B',
      projectName: 'Project B',
      status: 'rejected',
      stats: { mentors: 0, mentees: 0, graduated: 0 },
      createdOn: '2026-06-01',
      updatedOn: '2026-07-20',
    },
  ],
  total: 2,
};

const fulfillJson = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function stubPrograms(page: Page, body: MentorshipProgramsResponse): Promise<void> {
  await page.route(PROGRAMS_ROUTE, (route) => fulfillJson(route, body));
}

test.describe('Admin programs list — structure', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubPrograms(page, POPULATED);
    await openMentorPage(page, ADMIN_URL);
  });

  test('wraps one card per program in the list, each keyed by program id', async ({ page }) => {
    const list = page.getByTestId('mentorship-programs-list');
    await expect(list).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(list.getByTestId(`mentorship-program-card-${FIRST_ID}`)).toBeVisible();
    await expect(list.getByTestId(`mentorship-program-card-${SECOND_ID}`)).toBeVisible();
  });

  test('offers the search and the status filter', async ({ page }) => {
    await expect(page.getByTestId('mentorship-programs-list')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-programs-status-filter')).toBeVisible();
    await expect(page.locator('[data-test="mentorship-programs-search"]')).toBeVisible();
  });

  test('renders neither the load error nor the empty state when programs are listed', async ({ page }) => {
    await expect(page.getByTestId('mentorship-programs-list')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('mentorship-admin-programs-load-error')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-programs-empty-state')).toHaveCount(0);
  });
});

test.describe('Admin programs list — empty', () => {
  test('renders the empty state and no cards or load error', async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubPrograms(page, { data: [], total: 0 });
    await openMentorPage(page, ADMIN_URL);

    await expect(page.getByTestId('mentorship-programs-empty-state')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-programs-cards')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-admin-programs-load-error')).toHaveCount(0);
  });
});

test.describe('Admin programs list — failed load', () => {
  test('renders the load error with a Retry in place of the empty state', async ({ page }) => {
    await enableMentorshipFlag(page);
    await page.route(PROGRAMS_ROUTE, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) }));
    await openMentorPage(page, ADMIN_URL);

    const error = page.getByTestId('mentorship-admin-programs-load-error');
    await expect(error).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(error.getByTestId('mentorship-admin-programs-retry')).toBeVisible();
    await expect(page.getByTestId('mentorship-programs-empty-state')).toHaveCount(0);
  });
});

test.describe('Admin programs list — logo missing structure', () => {
  const LOGO_ROUTE = '**/api/mentorship/admin/programs/*/logo';
  const card = (page: Page, id: string) => page.getByTestId(`mentorship-program-card-${id}`);

  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    // The first row lacks its logo (as the BFF flags it); the second does not.
    await stubPrograms(page, {
      ...POPULATED,
      data: [
        { ...POPULATED.data[0], logoMissing: true },
        { ...POPULATED.data[1], logoMissing: false },
      ],
    });
    await openMentorPage(page, ADMIN_URL);
    await expect(card(page, FIRST_ID)).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  });

  test('nests the hint, the button and a hidden image input in the flagged card only', async ({ page }) => {
    await expect(card(page, FIRST_ID).getByTestId('mentorship-program-card-hint')).toBeVisible();
    await expect(card(page, FIRST_ID).getByTestId('mentorship-program-card-add-logo')).toBeVisible();
    const input = card(page, FIRST_ID).getByTestId('mentorship-program-card-logo-input');
    await expect(input).toBeHidden();
    await expect(input).toHaveAttribute('type', 'file');
    await expect(input).toHaveAttribute('accept', /image\/png/);

    await expect(card(page, SECOND_ID).getByTestId('mentorship-program-card-hint')).toHaveCount(0);
    await expect(card(page, SECOND_ID).getByTestId('mentorship-program-card-add-logo')).toHaveCount(0);
    await expect(card(page, SECOND_ID).getByTestId('mentorship-program-card-logo-input')).toHaveCount(0);
  });

  test('the button opens a file chooser without leaving the list', async ({ page }) => {
    const chooser = page.waitForEvent('filechooser');
    await card(page, FIRST_ID).getByTestId('mentorship-program-card-add-logo').locator('button').click();

    expect((await chooser).isMultiple()).toBe(false);
    await expect(page).toHaveURL(/\/mentorship\/admin$/);
  });

  test('the button is busy and disabled while the upload runs, and the card keeps its hint after a failure', async ({ page }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(LOGO_ROUTE, async (route) => {
      await held;
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) });
    });

    await card(page, FIRST_ID)
      .getByTestId('mentorship-program-card-logo-input')
      .setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) });

    await expect(card(page, FIRST_ID).getByTestId('mentorship-program-card-add-logo').locator('button')).toBeDisabled();
    release();
    await expect(card(page, FIRST_ID).getByTestId('mentorship-program-card-add-logo').locator('button')).toBeEnabled();
    await expect(card(page, FIRST_ID).getByTestId('mentorship-program-card-hint')).toBeVisible();
  });
});
