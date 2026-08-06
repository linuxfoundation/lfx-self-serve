// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Group view access-retry E2E (LFXV2-2890). Deterministic via route mocks that sequence the
 * committee GET through a controlled number of 403s before resolving — exercises the client-side
 * tolerance for FGA propagation lag on the initial committee read.
 */

import { expect, Page, test } from '@playwright/test';

import {
  buildBaseCommittee,
  DATA_LOAD_TIMEOUT,
  gotoCommitteeTab as gotoCommitteeTabHelper,
  mockCommitteeApis as mockCommitteeApisHelper,
} from './helpers/committee-about.helper';

const COMMITTEE_UID = 'e2e-access-retry-committee';

function baseCommittee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return buildBaseCommittee(COMMITTEE_UID, overrides);
}

/**
 * Routes GET /api/committees/:uid to return 403 for the first `denials` calls, then the given
 * committee body on every call after. Registered after `mockCommitteeApisHelper`, so it takes
 * priority over that helper's blanket 200 for this one endpoint.
 */
async function mockSequencedCommitteeRead(page: Page, denials: number, committee: Record<string, unknown>): Promise<() => number> {
  let calls = 0;
  await page.route(`**/api/committees/${COMMITTEE_UID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    calls++;
    if (calls <= denials) {
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Forbidden' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committee) });
  });
  return () => calls;
}

function gotoCommitteeView(page: Page): Promise<void> {
  return gotoCommitteeTabHelper(page, COMMITTEE_UID, '');
}

test.setTimeout(120_000);

test.describe('Group view access retry on FGA propagation lag (LFXV2-2890)', () => {
  test('recovers within the retry window: 403 then 403 then 200 loads the group without a terminal error', async ({ page }) => {
    const committee = baseCommittee({ my_role: 'Member', writer: false });
    await mockCommitteeApisHelper(page, COMMITTEE_UID, { committee });
    // ACCESS_RETRY_ATTEMPTS is 3 (1 initial read + 3 retries = 4 reads max); deny the first 2 so
    // the 3rd read (2nd retry) succeeds, comfortably inside the budget.
    const getCalls = await mockSequencedCommitteeRead(page, 2, committee);
    await gotoCommitteeView(page);

    // The retry window shows a provisional "finalizing" state rather than flashing access-denied.
    await expect(page.getByTestId('committee-view-access-finalizing')).toBeVisible();

    await expect(page.getByTestId('committee-about')).toHaveCount(0); // sanity: not yet resolved
    await expect(page.getByTestId('committee-view-tabs')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-view-access-finalizing')).toHaveCount(0);
    await expect(page.getByTestId('committee-view-access-denied-retry')).toHaveCount(0);
    expect(getCalls()).toBeGreaterThanOrEqual(3);
  });

  test('exhausts the retry window: all reads 403 shows the access-denied state, and Try Again re-engages a fresh window', async ({ page }) => {
    const committee = baseCommittee({ my_role: 'Member', writer: false });
    await mockCommitteeApisHelper(page, COMMITTEE_UID, { committee });
    // Deny every read in the first pass (well beyond the 4-read budget) so the window exhausts.
    const getCalls = await mockSequencedCommitteeRead(page, 100, committee);
    await gotoCommitteeView(page);

    await expect(page.getByTestId('committee-view-access-finalizing')).toBeVisible();
    await expect(page.getByTestId('committee-view-access-denied-retry')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-view-access-finalizing')).toHaveCount(0);
    const callsAtExhaustion = getCalls();
    expect(callsAtExhaustion).toBeGreaterThanOrEqual(4);

    // Try Again re-engages a full retry window (switchMap cancels nothing in-flight; a fresh
    // sequence starts and this time resolves), rather than a single one-shot read.
    await page.unroute(`**/api/committees/${COMMITTEE_UID}`);
    await mockSequencedCommitteeRead(page, 1, committee);
    await page.getByTestId('committee-view-access-denied-retry').click();

    await expect(page.getByTestId('committee-view-tabs')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-view-access-denied-retry')).toHaveCount(0);
  });
});
