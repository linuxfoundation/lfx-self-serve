// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentorship Programs in the Projects and Foundation lenses — structure (linuxfoundation/lfx-mentorship#398, covered for
 * linuxfoundation/lfx-mentorship#378). Content checks live in `mentorship-lens-programs.spec.ts`; this spec pins the data-testid
 * contract, which state nodes render together, and the lens links (`?project=<slug>`) the sidebar and the program page carry.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipProgram } from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import {
  ADMIN_PROGRAM_ID,
  ADMIN_PROGRAM_PAGE,
  AdminProgramRequests,
  stubAdminMentees,
  stubAdminProgramPage,
  stubAdminTasks,
} from './helpers/mentorship-admin-program.helper';
import { lensContextOf, lensPath, MENTORSHIP_LENS_PAGE_TIMEOUT, MentorshipLensKind, openLensPage, stubMentorshipLens } from './helpers/mentorship-lens.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(90_000);

test.use({ viewport: { width: 1440, height: 900 } });

const fulfillJson = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const PROGRAM: MentorshipProgram = {
  id: ADMIN_PROGRAM_ID,
  slug: ADMIN_PROGRAM_ID,
  name: ADMIN_PROGRAM_PAGE.program.name,
  projectName: 'Example Project',
  status: 'accepting',
  stats: { mentors: 1, mentees: 2, graduated: 0 },
  createdOn: '2026-06-01',
  updatedOn: '2026-07-20',
};

async function openLensList(page: Page, lens: MentorshipLensKind, listStatus = 200): Promise<void> {
  await page.route('**/api/mentorship/admin/projects/*/programs*', (route) =>
    listStatus === 200 ? fulfillJson(route, { data: [PROGRAM], total: 1 }) : fulfillJson(route, { error: 'stubbed' }, listStatus)
  );
  await openLensPage(page, lens, lensPath(lens));
  await expect(page.getByTestId('mentorship-admin-title')).toBeVisible({ timeout: MENTORSHIP_LENS_PAGE_TIMEOUT });
}

for (const lens of ['project', 'foundation'] as const) {
  const slug = lensContextOf(lens).slug;

  test.describe(`Mentorship Programs ${lens} lens — structure`, () => {
    test.beforeEach(async ({ page }) => {
      await stubMentorshipLens(page, lens);
    });

    test('renders the title as the page heading, the Enroll button, and one card per program keyed by id', async ({ page }) => {
      await openLensList(page, lens);

      await expect(page.getByTestId('mentorship-admin-title')).toHaveJSProperty('tagName', 'H1');
      await expect(page.getByTestId('mentorship-admin-enroll-button')).toBeVisible();
      await expect(page.getByTestId('mentorship-programs-list').getByTestId(`mentorship-program-card-${ADMIN_PROGRAM_ID}`)).toBeVisible();
      await expect(page.getByTestId('mentorship-admin-programs-no-access')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-admin-programs-load-error')).toHaveCount(0);
    });

    test('links the sidebar entry to the lens page with the lens slug', async ({ page }) => {
      await openLensList(page, lens);

      // The test id sits on the nav item's own anchor.
      const link = page.getByTestId(`sidebar-${lens}-mentorship-programs`);
      await expect(link).toHaveJSProperty('tagName', 'A');
      await expect(link).toHaveAttribute('href', new RegExp(`/${lens}/mentorship\\?project=${slug}`));
    });

    test('renders only the no-access state for a 403, and keeps the header', async ({ page }) => {
      await openLensList(page, lens, 403);

      await expect(page.getByTestId('mentorship-admin-programs-no-access')).toBeVisible();
      await expect(page.getByTestId('mentorship-admin-programs-load-error')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-admin-programs-retry')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-programs-empty-state')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-admin-enroll-button')).toBeVisible();
    });

    test('renders the load error with a Retry, not the no-access state, for any other failure', async ({ page }) => {
      await openLensList(page, lens, 503);

      await expect(page.getByTestId('mentorship-admin-programs-load-error')).toBeVisible();
      await expect(page.getByTestId('mentorship-admin-programs-retry')).toBeVisible();
      await expect(page.getByTestId('mentorship-admin-programs-no-access')).toHaveCount(0);
    });

    test("points the program page's back link at the lens list with the lens slug", async ({ page }) => {
      const requests: AdminProgramRequests = { mentees: [], tasks: [] };
      await stubAdminProgramPage(page);
      await stubAdminMentees(page, requests);
      await stubAdminTasks(page, requests);
      await openLensPage(page, lens, lensPath(lens, `/${ADMIN_PROGRAM_ID}`));

      await expect(page.getByTestId('mentorship-program-detail-title')).toBeVisible({ timeout: MENTORSHIP_LENS_PAGE_TIMEOUT });
      await expect(page.getByTestId('mentorship-program-detail-back').getByRole('link')).toHaveAttribute('href', `/${lens}/mentorship?project=${slug}`);
    });
  });
}
