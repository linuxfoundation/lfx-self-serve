// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Terms tab — manage a program's terms (linuxfoundation/lfx-mentorship#239).
 *
 * Close, Re-Open and Delete a term. The reads are stubbed as in `mentorship-admin-program-tabs.spec.ts`; the writes
 * are stubbed here via `page.route`, recording each request so a spec asserts what the browser sent as well as what it
 * rendered. All data is synthetic. The four-open-term limit and the 409 refusals are shown with the server's reason.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the browser makes the calls and the stubs
 * answer them. The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_MAX_OPEN_TERMS_MESSAGE } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import { ADMIN_PROGRAM_ID, ADMIN_PROGRAM_URL, stubAdminMentees, stubAdminProgramPage, stubAdminTasks } from './helpers/mentorship-admin-program.helper';
import {
  newTermRows,
  newTermStubState,
  TERM_ACCEPTED_ID,
  TERM_CLOSABLE_ID,
  TERM_CLOSED_ID,
  TERM_EMPTY_ID,
  TermStubState,
  stubTermActions,
} from './helpers/mentorship-admin-terms.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

/** Counts the program page reads (the source of the tab counts) the browser makes. */
function countProgramReads(page: Page): { count: () => number } {
  let reads = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}`) reads += 1;
  });
  return { count: () => reads };
}

async function open(page: Page, state: TermStubState, writeStatus?: number): Promise<void> {
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, { mentees: [], tasks: [] });
  await stubAdminTasks(page, { mentees: [], tasks: [] });
  await stubTermActions(page, state, writeStatus);
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  await page.getByTestId('mentorship-program-detail-tab-terms').click();
  await expect(page.getByTestId(`mentorship-term-row-${TERM_CLOSABLE_ID}`)).toBeVisible();
}

/** Picks one of a row's menu actions. */
async function chooseAction(page: Page, termId: string, label: string): Promise<void> {
  await page.getByTestId(`mentorship-term-actions-${termId}`).getByRole('button').click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

/** Confirms the open confirmation dialog with its accept button. */
async function confirm(page: Page, label: string): Promise<void> {
  await page.locator('.p-confirmdialog').getByRole('button', { name: label, exact: true }).click();
}

test.describe('Admin Terms tab — manage terms', () => {
  let state: TermStubState;

  test.beforeEach(() => {
    state = newTermStubState();
  });

  test('closes a term with no accepted applications, then refreshes the counts', async ({ page }) => {
    const programReads = countProgramReads(page);
    await open(page, state);
    const before = programReads.count();

    await chooseAction(page, TERM_CLOSABLE_ID, 'Close');
    await confirm(page, 'Close Term');

    await expect(page.getByText('Term closed.')).toBeVisible();
    expect(state.writes).toEqual([{ method: 'POST', path: `/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/terms/${TERM_CLOSABLE_ID}/close` }]);
    await expect(page.getByTestId(`mentorship-term-row-${TERM_CLOSABLE_ID}`)).toContainText('Closed');
    expect(programReads.count()).toBeGreaterThan(before);
  });

  test('explains why a term with accepted applications cannot be closed, and sends nothing', async ({ page }) => {
    await open(page, state);

    await chooseAction(page, TERM_ACCEPTED_ID, 'Close');

    await expect(page.locator('.p-confirmdialog')).toContainText('Cannot Close Term');
    await confirm(page, 'Ok');
    expect(state.writes).toEqual([]);
  });

  test('re-opens a closed term', async ({ page }) => {
    await open(page, state);

    await chooseAction(page, TERM_CLOSED_ID, 'Re-Open');
    await confirm(page, 'Re-Open Term');

    await expect(page.getByText('Term re-opened.')).toBeVisible();
    expect(state.writes.map((write) => write.path)).toEqual([`/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/terms/${TERM_CLOSED_ID}/reopen`]);
    await expect(page.getByTestId(`mentorship-term-row-${TERM_CLOSED_ID}`)).toContainText('Open');
  });

  test('deletes a term that has no applications, and offers no Delete for one that has', async ({ page }) => {
    await open(page, state);

    await page.getByTestId(`mentorship-term-actions-${TERM_CLOSED_ID}`).getByRole('button').click();
    await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await chooseAction(page, TERM_EMPTY_ID, 'Delete');
    await confirm(page, 'Delete Term');

    await expect(page.getByText('Term deleted.')).toBeVisible();
    expect(state.writes).toEqual([{ method: 'DELETE', path: `/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/terms/${TERM_EMPTY_ID}` }]);
    await expect(page.getByTestId(`mentorship-term-row-${TERM_EMPTY_ID}`)).toHaveCount(0);
  });

  test('shows the server reason when a write is refused with a 409', async ({ page }) => {
    await open(page, state, 409);

    await chooseAction(page, TERM_CLOSABLE_ID, 'Close');
    await confirm(page, 'Close Term');

    await expect(page.getByText('Stubbed server reason.')).toBeVisible();
    await expect(page.getByTestId(`mentorship-term-row-${TERM_CLOSABLE_ID}`)).toBeVisible();
  });

  test('with four open terms, disables Add Term and says why', async ({ page }) => {
    state = newTermStubState(newTermRows().map((term) => ({ ...term, status: 'open' as const })));
    await open(page, state);

    await expect(page.getByTestId('mentorship-terms-create')).toBeDisabled();
    await expect(page.getByTestId('mentorship-terms-tab')).toContainText(MENTORSHIP_MAX_OPEN_TERMS_MESSAGE);
    expect(state.writes).toEqual([]);
  });
});
