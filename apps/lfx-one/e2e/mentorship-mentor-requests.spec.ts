// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor program requests — request, withdraw, and the 404 and 409 refusals (linuxfoundation/lfx-mentorship#209).
 *
 * Runs in the mentor profile edit drawer, which sends a picked program's request and a confirmed
 * withdraw right away. Every mentor request route is stubbed via `page.route` with synthetic
 * programs, so nothing is requested or withdrawn for the signed-in user. The stubbed request list
 * changes as the writes land, standing in for upstream, so the re-read after each write shows the
 * new status. The page is reached by client-side navigation (`openMentorPage`), so the reads the
 * stubs answer are made by the browser.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import {
  MENTORSHIP_MENTOR_PICKER_ITEM_SIZE,
  MENTORSHIP_MENTOR_PICKER_UNAVAILABLE_NOTE,
  MENTORSHIP_MENTOR_PROGRAMS_EMPTY_MESSAGE,
  MENTORSHIP_MENTOR_PROGRAMS_SEARCHING_MESSAGE,
  MENTORSHIP_MENTOR_REQUEST_ERROR_MESSAGES,
  MENTORSHIP_MENTOR_REQUEST_ERROR_SUMMARY,
  MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS,
  MENTORSHIP_MENTOR_REQUEST_SUCCESS_SUMMARY,
  MENTORSHIP_MENTOR_WITHDRAW_CANCEL_LABEL,
  MENTORSHIP_MENTOR_WITHDRAW_CONFIRM_HEADER,
  MENTORSHIP_MENTOR_WITHDRAW_LABEL,
  MENTORSHIP_MENTOR_WITHDRAW_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { MentorshipMentorOpenProgram, MentorshipMentorProgramRequest } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const MENTOR_PROFILE_URL = '/mentorship/mentor/profile';

const ALPHA: MentorshipMentorOpenProgram = { id: '11111111-1111-4111-8111-111111111111', name: 'Test Program Alpha' };
const BETA: MentorshipMentorOpenProgram = { id: '22222222-2222-4222-8222-222222222222', name: 'Test Program Beta' };
const BETA_REQUEST_ID = '33333333-3333-4333-8333-333333333333';

interface RequestStubOptions {
  /** The requests listed when the drawer opens. */
  requests?: MentorshipMentorProgramRequest[];
  /** Status the request POST answers with; a 204 lists the program as pending, like upstream. */
  requestStatus?: number;
  requestBody?: unknown;
}

/**
 * Stubs the profile read, the picker's read, the request list, and both writes. A sent request
 * joins the list as pending and a withdraw marks its row withdrawn, so the drawer's re-read after
 * each write sees what upstream would. Returns the request bodies and withdrawn ids sent, and the
 * search of each program page the picker read.
 */
async function stubMentorRequests(
  page: Page,
  options: RequestStubOptions = {}
): Promise<{ requestBodies: unknown[]; withdrawnIds: string[]; programSearches: string[] }> {
  const { requestStatus = 204, requestBody } = options;
  const requests = [...(options.requests ?? [])];
  const requestBodies: unknown[] = [];
  const withdrawnIds: string[] = [];
  const programSearches: string[] = [];

  await page.route('**/api/mentorship/mentor/profile', (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ profile: { aboutMe: '', skills: [] }, history: [] }),
    });
  });

  await page.route('**/api/mentorship/mentor/open-programs**', (route) => {
    programSearches.push(new URL(route.request().url()).searchParams.get('search') ?? '');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [ALPHA, BETA], total: 2 }) });
  });

  await page.route('**/api/mentorship/mentor/requests', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: requests, invitedProgramIds: [] }) });
    }
    const body = route.request().postDataJSON() as { programId: string };
    requestBodies.push(body);
    if (requestStatus !== 204) {
      return route.fulfill({ status: requestStatus, contentType: 'application/json', body: JSON.stringify(requestBody ?? {}) });
    }
    const program = [ALPHA, BETA].find((item) => item.id === body.programId);
    requests.push({ id: `req-${requests.length + 1}`, programId: body.programId, programName: program?.name ?? '', status: 'pending' });
    return route.fulfill({ status: 204 });
  });

  await page.route('**/api/mentorship/mentor/requests/*/withdraw', (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2) ?? '');
    withdrawnIds.push(id);
    const row = requests.find((item) => item.id === id);
    if (row) row.status = 'withdrawn';
    return route.fulfill({ status: 204 });
  });

  return { requestBodies, withdrawnIds, programSearches };
}

async function openEditDrawer(page: Page): Promise<void> {
  await openMentorPage(page, MENTOR_PROFILE_URL);
  await page.getByTestId('mentorship-mentor-profile-details-edit').getByRole('button').click();
  await expect(page.getByTestId('mentor-profile-edit-drawer-body')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

async function openPicker(page: Page): Promise<void> {
  await page.locator('[data-test="mentorship-mentor-program"]').click();
}

async function pickProgram(page: Page, program: MentorshipMentorOpenProgram): Promise<void> {
  await openPicker(page);
  await page.getByRole('option', { name: program.name, exact: true }).click();
}

/**
 * The withdraw confirm dialog. PrimeNG appends it to `<body>`, outside the drawer, so it is found
 * by role and header.
 */
function confirmDialog(page: Page) {
  return page.getByRole('alertdialog').filter({ hasText: MENTORSHIP_MENTOR_WITHDRAW_CONFIRM_HEADER });
}

test.describe('Mentor program requests — request', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('picking a program sends the request at once, toasts success and lists it as Pending', async ({ page }) => {
    const { requestBodies } = await stubMentorRequests(page);
    await openEditDrawer(page);

    await pickProgram(page, ALPHA);

    await expect(page.locator('p-toast .p-toast-message-success')).toContainText(MENTORSHIP_MENTOR_REQUEST_SUCCESS_SUMMARY);
    await expect(page.getByTestId('mentorship-mentor-request-status-req-1')).toHaveText(MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS.pending);
    await expect(page.getByTestId('mentorship-mentor-withdraw-req-1')).toBeVisible();
    expect(requestBodies).toEqual([{ programId: ALPHA.id }]);
  });

  test('a duplicate request (409) toasts the already-requested copy, naming the program', async ({ page }) => {
    await stubMentorRequests(page, { requestStatus: 409, requestBody: { error: 'Conflict' } });
    await openEditDrawer(page);

    await pickProgram(page, ALPHA);

    const toast = page.locator('p-toast .p-toast-message-error');
    await expect(toast).toContainText(MENTORSHIP_MENTOR_REQUEST_ERROR_SUMMARY);
    await expect(toast).toContainText(`${ALPHA.name}: ${MENTORSHIP_MENTOR_REQUEST_ERROR_MESSAGES[409]}`);
    await expect(page.locator('[data-testid^="mentorship-mentor-request-row-"]')).toHaveCount(0);
  });

  test('a program that is no longer available (404) toasts the not-available copy', async ({ page }) => {
    await stubMentorRequests(page, { requestStatus: 404, requestBody: { error: 'Not Found' } });
    await openEditDrawer(page);

    await pickProgram(page, BETA);

    await expect(page.locator('p-toast .p-toast-message-error')).toContainText(`${BETA.name}: ${MENTORSHIP_MENTOR_REQUEST_ERROR_MESSAGES[404]}`);
    await expect(page.locator('[data-testid^="mentorship-mentor-request-row-"]')).toHaveCount(0);

    await openPicker(page);
    await expect(page.getByTestId(`mentorship-mentor-program-option-note-${BETA.id}`)).toHaveText(MENTORSHIP_MENTOR_PICKER_UNAVAILABLE_NOTE);
    const beta = page.getByRole('option').filter({ has: page.getByTestId(`mentorship-mentor-program-option-${BETA.id}`) });
    await expect(beta).toHaveAttribute('data-p-disabled', 'true');
  });

  test('a program with a pending request stays listed, disabled, with its status as the note', async ({ page }) => {
    await stubMentorRequests(page, { requests: [{ id: BETA_REQUEST_ID, programId: BETA.id, programName: BETA.name, status: 'pending' }] });
    await openEditDrawer(page);

    await openPicker(page);

    // PrimeNG marks a disabled option with `data-p-disabled`, not `aria-disabled`.
    const beta = page.getByRole('option').filter({ has: page.getByTestId(`mentorship-mentor-program-option-${BETA.id}`) });
    await expect(beta).toHaveAttribute('data-p-disabled', 'true');
    await expect(page.getByTestId(`mentorship-mentor-program-option-note-${BETA.id}`)).toHaveText(MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS.pending);
    await expect(page.getByRole('option', { name: ALPHA.name, exact: true })).toHaveAttribute('data-p-disabled', 'false');
  });

  test('typing in the picker searches the programs upstream', async ({ page }) => {
    const { programSearches } = await stubMentorRequests(page);
    await openEditDrawer(page);

    await openPicker(page);
    await page.getByPlaceholder('Search programs').fill('Alpha');

    await expect.poll(() => programSearches).toContain('Alpha');
    await expect(page.getByRole('option', { name: ALPHA.name, exact: true })).toBeVisible();
  });

  test('while a search waits on its answer, the list says it is searching rather than that nothing matched', async ({ page }) => {
    await stubMentorRequests(page);
    await openEditDrawer(page);
    await openPicker(page);

    // Registered after the shared stub, so it answers the searched reads; held until released.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname.endsWith('/api/mentorship/mentor/open-programs') && url.searchParams.has('search'),
      async (route) => {
        await held;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) }).catch(() => undefined);
      }
    );

    await page.getByPlaceholder('Search programs').fill('Gamma');

    const overlay = page.locator('.p-select-overlay');
    await expect(overlay).toContainText(MENTORSHIP_MENTOR_PROGRAMS_SEARCHING_MESSAGE);
    release();
    await expect(overlay).toContainText(MENTORSHIP_MENTOR_PROGRAMS_EMPTY_MESSAGE);
    await expect(overlay).not.toContainText(MENTORSHIP_MENTOR_PROGRAMS_SEARCHING_MESSAGE);
  });

  test('picking a program clears the search, so the select reopens on every program', async ({ page }) => {
    const { programSearches } = await stubMentorRequests(page);
    await openEditDrawer(page);
    await openPicker(page);

    const searchBox = page.getByPlaceholder('Search programs');
    await searchBox.fill('Alpha');
    await expect.poll(() => programSearches).toContain('Alpha');
    await expect(page.getByRole('option', { name: BETA.name, exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: ALPHA.name, exact: true }).click();
    await expect(page.getByTestId('mentorship-mentor-request-status-req-1')).toHaveText(MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS.pending);

    await openPicker(page);
    await expect(searchBox).toHaveValue('');
    await expect(page.getByRole('option', { name: BETA.name, exact: true })).toBeVisible();
  });

  test('a search that matches after one that matched nothing lists every program it found', async ({ page }) => {
    await stubMentorRequests(page);
    // Registered after the shared stub, so it answers the search that matches nothing.
    await page.route(
      (url) => url.pathname.endsWith('/api/mentorship/mentor/open-programs') && url.searchParams.get('search') === 'Gamma',
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) })
    );
    await openEditDrawer(page);
    await openPicker(page);

    const overlay = page.locator('.p-select-overlay');
    await page.getByPlaceholder('Search programs').fill('Gamma');
    await expect(overlay).toContainText(MENTORSHIP_MENTOR_PROGRAMS_EMPTY_MESSAGE);

    await page.getByPlaceholder('Search programs').fill('Test');
    await expect(page.getByRole('option', { name: BETA.name, exact: true })).toBeVisible();

    // The list must be tall enough to show both programs, not kept at the empty list's height,
    // and must not scroll for two rows.
    const scroller = overlay.locator('.p-virtualscroller');
    await expect.poll(async () => (await scroller.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(2 * MENTORSHIP_MENTOR_PICKER_ITEM_SIZE);
    expect(await scroller.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  });
});

test.describe('Mentor program requests — withdraw', () => {
  const pending: MentorshipMentorProgramRequest = { id: BETA_REQUEST_ID, programId: BETA.id, programName: BETA.name, status: 'pending' };
  const withdrawButton = (page: Page) => page.getByTestId(`mentorship-mentor-withdraw-${BETA_REQUEST_ID}`).getByRole('button');

  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('cancelling the confirm step withdraws nothing', async ({ page }) => {
    const { withdrawnIds } = await stubMentorRequests(page, { requests: [pending] });
    await openEditDrawer(page);

    await withdrawButton(page).click();
    await confirmDialog(page).getByRole('button', { name: MENTORSHIP_MENTOR_WITHDRAW_CANCEL_LABEL }).click();

    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByTestId(`mentorship-mentor-request-status-${BETA_REQUEST_ID}`)).toHaveText(MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS.pending);
    expect(withdrawnIds).toEqual([]);
  });

  test('a confirmed withdraw toasts success, lists the request as Withdrawn and drops its button', async ({ page }) => {
    const { withdrawnIds } = await stubMentorRequests(page, { requests: [pending] });
    await openEditDrawer(page);

    await withdrawButton(page).click();
    await confirmDialog(page).getByRole('button', { name: MENTORSHIP_MENTOR_WITHDRAW_LABEL, exact: true }).click();

    await expect(page.locator('p-toast .p-toast-message-success')).toContainText(MENTORSHIP_MENTOR_WITHDRAW_SUCCESS_SUMMARY);
    await expect(page.getByTestId(`mentorship-mentor-request-status-${BETA_REQUEST_ID}`)).toHaveText(MENTORSHIP_MENTOR_REQUEST_STATUS_LABELS.withdrawn);
    await expect(withdrawButton(page)).toHaveCount(0);
    expect(withdrawnIds).toEqual([BETA_REQUEST_ID]);
  });
});
