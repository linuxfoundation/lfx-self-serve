// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee Overview — withdraw a pending application (linuxfoundation/lfx-mentorship#190).
 *
 * Stubs the applications read and the withdraw write via `page.route`, so the flow runs against
 * synthetic applications rather than whatever the signed-in user holds upstream. The applications
 * stub is stateful: once the withdraw has been answered it serves the next state, so a re-read
 * after the write is visible on the page.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import {
  MENTORSHIP_MENTEE_WITHDRAW_CANCEL_LABEL,
  MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_HEADER,
  MENTORSHIP_MENTEE_WITHDRAW_LABEL,
  MENTORSHIP_MENTEE_WITHDRAW_STALE_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_WITHDRAW_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTEE_OVERVIEW_URL, MENTEE_PROFILE_LOAD_TIMEOUT, openMenteeTab } from './helpers/mentee-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMenteeTab` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PENDING_APPLICATION_ID = '0b6e1f2a-3c4d-4e5f-8a6b-7c8d9e0f1a2b';
const WITHDRAW_TESTID = `mentee-overview-withdraw-${PENDING_APPLICATION_ID}`;

/** The one synthetic application, with no tasks, in the given upstream status. */
function application(upstreamStatus: string) {
  return {
    id: PENDING_APPLICATION_ID,
    programId: 'prog-1',
    programName: 'Test Program One',
    term: { id: 'term-1', name: 'Fall 2026' },
    upstreamStatus,
    createdOn: '2026-06-01T10:00:00Z',
    updatedOn: '2026-06-02T10:00:00Z',
    tasks: [],
  };
}

interface WithdrawStub {
  withdrawCalls: number;
  applicationReads: number;
}

/**
 * Serves `before` until the withdraw is answered with `withdrawStatus`, then `after`. Returns
 * counters so a test can prove the write went out once and the page re-read the list.
 */
async function stubWithdrawFlow(page: Page, withdrawStatus: number, after: string): Promise<WithdrawStub> {
  const stub: WithdrawStub = { withdrawCalls: 0, applicationReads: 0 };
  let current = 'pending';

  await page.route('**/api/mentorship/mentee/applications*', (route) => {
    stub.applicationReads += 1;
    const data = [application(current)];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, total: data.length }) });
  });

  await page.route('**/api/mentorship/mentee/applications/*/withdraw', (route) => {
    stub.withdrawCalls += 1;
    current = after;
    if (withdrawStatus === 204) {
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: withdrawStatus, contentType: 'application/json', body: JSON.stringify({ error: 'upstream text', code: 'CONFLICT' }) });
  });

  return stub;
}

/**
 * The withdraw confirm dialog. PrimeNG appends it to `<body>`, outside the element that carries
 * `mentee-overview-withdraw-confirm-dialog`, so it is found by role and header instead.
 */
function confirmDialog(page: Page) {
  return page.getByRole('alertdialog').filter({ hasText: MENTORSHIP_MENTEE_WITHDRAW_CONFIRM_HEADER });
}

async function openPendingCard(page: Page): Promise<void> {
  await openMenteeTab(page, MENTEE_OVERVIEW_URL);
  await expect(page.getByTestId(WITHDRAW_TESTID)).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
}

test.describe('Mentee Overview — withdraw', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('cancelling the confirm step withdraws nothing', async ({ page }) => {
    const stub = await stubWithdrawFlow(page, 204, 'withdrawn');
    await openPendingCard(page);

    await page.getByTestId(WITHDRAW_TESTID).click();
    await confirmDialog(page).getByRole('button', { name: MENTORSHIP_MENTEE_WITHDRAW_CANCEL_LABEL }).click();

    await expect(confirmDialog(page)).toHaveCount(0);
    await expect(page.getByTestId('mentee-application-card')).toHaveCount(1);
    expect(stub.withdrawCalls).toBe(0);
  });

  test('a confirmed withdraw toasts success and moves the application to Past Applications', async ({ page }) => {
    const stub = await stubWithdrawFlow(page, 204, 'withdrawn');
    await openPendingCard(page);
    const readsBefore = stub.applicationReads;

    await page.getByTestId(WITHDRAW_TESTID).click();
    await confirmDialog(page).getByRole('button', { name: MENTORSHIP_MENTEE_WITHDRAW_LABEL, exact: true }).click();

    await expect(page.locator('p-toast .p-toast-message-success')).toContainText(MENTORSHIP_MENTEE_WITHDRAW_SUCCESS_SUMMARY);
    await expect(page.getByTestId('mentee-application-card')).toHaveCount(0);
    await expect(page.getByTestId('mentee-overview-past-applications')).toBeVisible();
    expect(stub.withdrawCalls).toBe(1);
    expect(stub.applicationReads).toBeGreaterThan(readsBefore);
  });

  test('a 409 shows the stale copy and re-reads the applications', async ({ page }) => {
    // Upstream accepted the application before the mentee withdrew it.
    const stub = await stubWithdrawFlow(page, 409, 'accepted');
    await openPendingCard(page);
    const readsBefore = stub.applicationReads;

    await page.getByTestId(WITHDRAW_TESTID).click();
    await confirmDialog(page).getByRole('button', { name: MENTORSHIP_MENTEE_WITHDRAW_LABEL, exact: true }).click();

    await expect(page.locator('p-toast .p-toast-message-error')).toContainText(MENTORSHIP_MENTEE_WITHDRAW_STALE_ERROR_MESSAGES[409]);
    // The re-read shows the accepted card, which offers no Withdraw.
    await expect(page.getByTestId('mentee-application-card')).toHaveCount(1);
    await expect(page.getByTestId(WITHDRAW_TESTID)).toHaveCount(0);
    expect(stub.applicationReads).toBeGreaterThan(readsBefore);
  });
});
