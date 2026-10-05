// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Current Mentees — application decisions (linuxfoundation/lfx-mentorship#235).
 *
 * Accept (with an attendance type), Decline, Withdraw, Graduate and Decline by Term. The reads are stubbed as in
 * `mentorship-admin-program-tabs.spec.ts`; the three writes are stubbed here via `page.route`, recording each
 * request so a spec asserts the body the browser sent as well as what it rendered. All data is synthetic.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the browser makes the calls and the stubs
 * answer them. The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import {
  ADMIN_PROGRAM_ID,
  ADMIN_PROGRAM_URL,
  AdminProgramRequests,
  adminApplicationId,
  stubAdminMentees,
  stubAdminProgramPage,
  stubAdminTasks,
} from './helpers/mentorship-admin-program.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

/** A pending row and an accepted row (every third synthetic application is accepted; each has 1 of 2 tasks in). */
const PENDING_ID = adminApplicationId(1);
const ACCEPTED_ID = adminApplicationId(3);

interface DecisionRequests {
  status: { id: string; method: string; body: Record<string, unknown> }[];
  withdraw: string[];
  declinePending: string[];
}

interface WriteStubs {
  /** Status code answered for `PATCH …/status` and `POST …/withdraw`; 204 when unset. */
  applicationWrite?: number;
}

const fulfillJson = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function stubWrites(page: Page, decisions: DecisionRequests, stubs: WriteStubs = {}): Promise<void> {
  const answer = (route: Route) => {
    const status = stubs.applicationWrite ?? 204;
    return status === 204 ? route.fulfill({ status }) : fulfillJson(route, status, { error: 'stubbed' });
  };

  await page.route('**/api/mentorship/admin/applications/*/status', (route) => {
    const request = route.request();
    decisions.status.push({ id: new URL(request.url()).pathname.split('/').slice(-2)[0], method: request.method(), body: request.postDataJSON() });
    return answer(route);
  });
  await page.route('**/api/mentorship/admin/applications/*/withdraw', (route) => {
    decisions.withdraw.push(new URL(route.request().url()).pathname.split('/').slice(-2)[0]);
    return answer(route);
  });
  await page.route(`**/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/terms/*/decline-pending`, (route) => {
    decisions.declinePending.push(new URL(route.request().url()).pathname.split('/').slice(-2)[0]);
    return fulfillJson(route, 200, { declinedCount: 3 });
  });
}

async function open(page: Page, requests: AdminProgramRequests, decisions: DecisionRequests, stubs?: WriteStubs): Promise<void> {
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, requests);
  await stubAdminTasks(page, requests);
  await stubWrites(page, decisions, stubs);
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

async function pickAction(page: Page, id: string, label: string): Promise<void> {
  await page.getByTestId(`mentorship-current-mentee-actions-${id}`).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

/** Confirms the open confirmation dialog with its accept button. */
async function confirm(page: Page, label: string): Promise<void> {
  await page.locator('.p-confirmdialog').getByRole('button', { name: label, exact: true }).click();
}

test.describe('Admin Current Mentees — application decisions', () => {
  let requests: AdminProgramRequests;
  let decisions: DecisionRequests;

  test.beforeEach(() => {
    requests = { mentees: [], tasks: [] };
    decisions = { status: [], withdraw: [], declinePending: [] };
  });

  test('accepts an application with the chosen attendance type, then reloads the page of rows', async ({ page }) => {
    await open(page, requests, decisions);
    const readsBefore = requests.mentees.length;

    await pickAction(page, PENDING_ID, 'Accept');
    await expect(page.getByTestId('mentorship-admin-accept-dialog')).toContainText('Test Applicant 01');
    await page.locator('[data-test="mentorship-admin-accept-attendance"]').click();
    await page.getByRole('option').first().click();
    await page.getByTestId('mentorship-admin-accept-confirm').getByRole('button').click();

    await expect(page.getByText('Application accepted')).toBeVisible();
    expect(decisions.status).toHaveLength(1);
    expect(decisions.status[0].method).toBe('PATCH');
    expect(decisions.status[0].id).toBe(PENDING_ID);
    expect(decisions.status[0].body.status).toBe('accepted');
    expect(['full_time', 'part_time']).toContain(decisions.status[0].body.attendanceType);
    await expect.poll(() => requests.mentees.length).toBeGreaterThan(readsBefore);
  });

  test('keeps the accept dialog open until an attendance type is chosen', async ({ page }) => {
    await open(page, requests, decisions);

    await pickAction(page, PENDING_ID, 'Accept');
    await page.getByTestId('mentorship-admin-accept-confirm').getByRole('button').click();

    await expect(page.getByTestId('mentorship-admin-accept-dialog')).toBeVisible();
    expect(decisions.status).toHaveLength(0);
  });

  test('declines only after the confirmation, and not when it is cancelled', async ({ page }) => {
    await open(page, requests, decisions);

    await pickAction(page, PENDING_ID, 'Decline');
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(decisions.status).toHaveLength(0);

    await pickAction(page, PENDING_ID, 'Decline');
    await confirm(page, 'Decline');

    await expect(page.getByText('Application declined')).toBeVisible();
    expect(decisions.status.map((entry) => entry.body)).toEqual([{ status: 'declined' }]);
  });

  test('withdraws on the mentee behalf after the confirmation', async ({ page }) => {
    await open(page, requests, decisions);

    await pickAction(page, PENDING_ID, 'Withdraw');
    expect(decisions.withdraw).toHaveLength(0);
    await confirm(page, 'Withdraw');

    await expect(page.getByText('Application withdrawn')).toBeVisible();
    expect(decisions.withdraw).toEqual([PENDING_ID]);
  });

  test('warns about unfinished tasks when graduating, without reading the tasks', async ({ page }) => {
    await open(page, requests, decisions);

    await pickAction(page, ACCEPTED_ID, 'Graduate');

    await expect(page.locator('.p-confirmdialog')).toContainText("1 task isn't Submitted or Completed.");
    expect(requests.tasks).toHaveLength(0);

    await confirm(page, 'Graduate');

    await expect(page.getByText('Mentee graduated')).toBeVisible();
    expect(decisions.status.map((entry) => entry.body)).toEqual([{ status: 'graduated' }]);
    expect(requests.tasks).toHaveLength(0);
  });

  test('declines every pending application in the picked term and reports the count', async ({ page }) => {
    await open(page, requests, decisions);

    await page.getByTestId('mentorship-admin-current-mentees-decline-by-term').getByRole('button').click();
    await page.getByTestId('mentorship-admin-decline-by-term-continue').getByRole('button').click();
    await confirm(page, 'Decline all pending');

    await expect(page.getByText('3 applications declined')).toBeVisible();
    expect(decisions.declinePending).toHaveLength(1);
  });

  test('shows the changed message and reloads when the application changed (409)', async ({ page }) => {
    await open(page, requests, decisions, { applicationWrite: 409 });
    const readsBefore = requests.mentees.length;

    await pickAction(page, PENDING_ID, 'Decline');
    await confirm(page, 'Decline');

    await expect(page.getByText('This application changed. The list has been refreshed.')).toBeVisible();
    await expect.poll(() => requests.mentees.length).toBeGreaterThan(readsBefore);
  });

  test('shows the term-closed message when an accept is refused because the term closed (422)', async ({ page }) => {
    await open(page, requests, decisions, { applicationWrite: 422 });

    await pickAction(page, PENDING_ID, 'Accept');
    await page.locator('[data-test="mentorship-admin-accept-attendance"]').click();
    await page.getByRole('option').first().click();
    await page.getByTestId('mentorship-admin-accept-confirm').getByRole('button').click();

    await expect(page.getByText("This term is closed, so the application can't be accepted.")).toBeVisible();
  });
});
