// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Committee engagement UI — Members table + Overview summary — LFXV2-1705.
 *
 * Coverage (all BFF responses route-mocked — independent of the server's ENGAGEMENT_BACKEND mode):
 *   - `wg-engagement-metrics` flag off (deterministic, via blocked LaunchDarkly): zero engagement
 *     UI on both tabs and the engagement endpoint is never requested.
 *   - Flag on (probe-and-skip, matching groups-engagement-stats.spec.ts): Meetings column renders
 *     personal attended/invited per member; classification chips render all tiers incl. the
 *     neutral Emeritus state; the At Risk chip counts and filters Low + Inactive-with-invites;
 *     switching the 30d/90d/YTD window refetches and re-renders; a degraded response
 *     (`data_available: false`) renders em-dashes, hides the At Risk chip, and shows the calm
 *     coming-soon state on the Overview summary; `computed_at: null` renders "Updated daily";
 *     `data_source: 'mock'` surfaces the Sample data marker on both tabs.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 *   - Flag-on tests additionally require `wg-engagement-metrics` toggled ON for the test user in
 *     LaunchDarkly — they skip gracefully when it isn't, rather than failing CI on external setup.
 */

import { expect, test } from '@playwright/test';

import {
  appearsWithin,
  blockLaunchDarkly,
  buildDegradedEngagementResponse,
  buildEngagementResponse,
  ELEMENT_TIMEOUT,
  ENGAGEMENT_PATH,
  gotoEngagementCommitteeTab,
  mockCommitteeShell,
  mockEngagementApi,
  mockEngagementFailure,
  PAGE_LOAD_TIMEOUT,
} from './helpers/committee-engagement.helper';

test.setTimeout(120_000);

test.describe('Committee engagement — flag gating (LFXV2-1705)', () => {
  test('flag off: no engagement UI on either tab and the endpoint is never requested', async ({ page }) => {
    let engagementRequests = 0;
    page.on('request', (req) => {
      if (req.url().includes(ENGAGEMENT_PATH)) engagementRequests++;
    });

    await blockLaunchDarkly(page);
    await mockCommitteeShell(page);
    await mockEngagementApi(page, (window) => buildEngagementResponse(window));
    await gotoEngagementCommitteeTab(page, 'members');

    // The roster itself must be fully functional with the flag off — no layout dependency.
    await expect(page.getByTestId('members-filter-chips')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByText('Harper Chairwood')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await expect(page.getByTestId('members-engagement-controls')).toHaveCount(0);
    await expect(page.getByTestId('members-chip-atRisk')).toHaveCount(0);
    await expect(page.locator('th', { hasText: 'Engagement' })).toHaveCount(0);
    await expect(page.locator('th', { hasText: 'Meetings' })).toHaveCount(0);

    await gotoEngagementCommitteeTab(page, 'overview');
    await expect(page.getByTestId('committee-overview-stats')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-overview-engagement-summary')).toHaveCount(0);

    // Give any stray async fetch a moment, then assert the flag-gated endpoint never fired.
    await page.waitForTimeout(1_000);
    expect(engagementRequests).toBe(0);
  });
});

test.describe('Committee engagement — members table (flag on)', () => {
  test('renders personal attended/invited and classification chips for every tier', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockEngagementApi(page, (window) => buildEngagementResponse(window));
    await gotoEngagementCommitteeTab(page, 'members');

    const flagOn = await appearsWithin(page.getByTestId('members-engagement-controls'), ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    await expect(page.getByTestId('members-engagement-meetings-m-high')).toHaveText(/12\/12/, { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('members-engagement-meetings-m-inactive-never')).toHaveText(/0\/0/);

    await expect(page.getByTestId('members-engagement-chip-m-high')).toContainText('High');
    await expect(page.getByTestId('members-engagement-chip-m-medium')).toContainText('Medium');
    await expect(page.getByTestId('members-engagement-chip-m-low')).toContainText('Low');
    await expect(page.getByTestId('members-engagement-chip-m-inactive-invited')).toContainText('Inactive');
    // Emeritus and LF Staff both render their own neutral tier — never Low/Inactive/at-risk styling.
    await expect(page.getByTestId('members-engagement-chip-m-emeritus')).toContainText('Emeritus');
    await expect(page.getByTestId('members-engagement-chip-m-lf-staff')).toContainText('LF Staff');

    // computed_at is null in the fixture → the daily-refresh freshness fallback.
    await expect(page.getByTestId('members-engagement-freshness')).toHaveText('Updated daily');
    // data_source is 'live' → no sample-data marker.
    await expect(page.getByTestId('members-engagement-mock-tag')).toHaveCount(0);
  });

  test('At Risk chip counts Low + Inactive-with-invites and filters the table to them', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockEngagementApi(page, (window) => buildEngagementResponse(window));
    await gotoEngagementCommitteeTab(page, 'members');

    const atRiskChip = page.getByTestId('members-chip-atRisk');
    const flagOn = await appearsWithin(atRiskChip, ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    await expect(atRiskChip).toContainText('At Risk (2)');
    await atRiskChip.click();

    await expect(page.getByText('Lee Lowturn')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByText('Ira Skipsall')).toBeVisible();
    // High / never-invited Inactive / Emeritus / LF Staff members are all filtered out.
    await expect(page.getByText('Harper Chairwood')).toHaveCount(0);
    await expect(page.getByText('Nova Neverasked')).toHaveCount(0);
    await expect(page.getByText('Evan Emeritus')).toHaveCount(0);
    await expect(page.getByText('Sam Staffer')).toHaveCount(0);
  });

  test('switching the window refetches and re-renders the cells', async ({ page }) => {
    await mockCommitteeShell(page);
    const engagementMock = await mockEngagementApi(page, (window) => buildEngagementResponse(window));
    await gotoEngagementCommitteeTab(page, 'members');

    const controls = page.getByTestId('members-engagement-controls');
    const flagOn = await appearsWithin(controls, ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    await expect(page.getByTestId('members-engagement-meetings-m-high')).toHaveText(/12\/12/, { timeout: ELEMENT_TIMEOUT });

    await controls.getByTestId('filter-pill-90d').click();

    await expect(page.getByTestId('members-engagement-meetings-m-high')).toHaveText(/20\/24/, { timeout: ELEMENT_TIMEOUT });
    expect(engagementMock.requestedWindows()).toContain('90d');
  });

  test('degraded response (data_available false): em-dashes, no At Risk chip, roster intact', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockEngagementApi(page, (window) => buildDegradedEngagementResponse(window));
    await gotoEngagementCommitteeTab(page, 'members');

    const flagOn = await appearsWithin(page.getByTestId('members-engagement-controls'), ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    await expect(page.getByTestId('members-engagement-meetings-m-high')).toHaveText('—', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('members-engagement-chip-m-high')).toHaveText('—');
    // A degraded response zeroes every row, so the At Risk chip would be a permanent "(0)" — hidden.
    await expect(page.getByTestId('members-chip-atRisk')).toHaveCount(0);
    // The roster stays fully functional.
    await expect(page.getByText('Harper Chairwood')).toBeVisible();
  });

  test('mock data source surfaces the Sample data marker', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockEngagementApi(page, (window) => buildEngagementResponse(window, { data_source: 'mock' }));
    await gotoEngagementCommitteeTab(page, 'members');

    const flagOn = await appearsWithin(page.getByTestId('members-engagement-controls'), ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    await expect(page.getByTestId('members-engagement-mock-tag')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('fetch failure (403): em-dashes and the calm unavailable state, roster intact', async ({ page }) => {
    // The endpoint is committee#auditor-gated, so a 403 is the expected outcome for most roster
    // viewers — the most likely production branch, and it must never read as an error.
    await mockCommitteeShell(page);
    await mockEngagementFailure(page, 403);
    await gotoEngagementCommitteeTab(page, 'members');

    const flagOn = await appearsWithin(page.getByTestId('members-engagement-controls'), ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    await expect(page.getByTestId('members-engagement-meetings-m-high')).toHaveText('—', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('members-engagement-chip-m-high')).toHaveText('—');
    await expect(page.getByTestId('members-chip-atRisk')).toHaveCount(0);
    // The roster stays fully functional.
    await expect(page.getByText('Harper Chairwood')).toBeVisible();

    await gotoEngagementCommitteeTab(page, 'overview');
    const summary = page.getByTestId('committee-overview-engagement-summary');
    await expect(summary.getByTestId('committee-engagement-summary-unavailable-state')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(summary.getByTestId('committee-engagement-summary-unavailable-state')).toContainText('Attendance data unavailable');
  });
});

test.describe('Committee engagement — overview summary (flag on)', () => {
  test('renders attendance rate, active members, at-risk count, and the freshness label', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockEngagementApi(page, (window) => buildEngagementResponse(window));
    await gotoEngagementCommitteeTab(page, 'overview');

    const summary = page.getByTestId('committee-overview-engagement-summary');
    const flagOn = await appearsWithin(summary, ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    await expect(summary.getByTestId('committee-engagement-summary-attendance-rate')).toContainText('78%', { timeout: ELEMENT_TIMEOUT });
    // 3/5, not 3/7 — the denominator is eligible_count (roster minus Emeritus/LF Staff), not total_count.
    await expect(summary.getByTestId('committee-engagement-summary-active-members')).toContainText('3/5');
    await expect(summary.getByTestId('committee-engagement-summary-at-risk')).toContainText('2');
    await expect(summary.getByTestId('committee-engagement-summary-freshness')).toHaveText('Updated daily');
  });

  test('degraded response shows the calm coming-soon state, not an error', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockEngagementApi(page, (window) => buildDegradedEngagementResponse(window));
    await gotoEngagementCommitteeTab(page, 'overview');

    const summary = page.getByTestId('committee-overview-engagement-summary');
    const flagOn = await appearsWithin(summary, ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    await expect(summary.getByTestId('committee-engagement-summary-coming-soon-state')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(summary.getByTestId('committee-engagement-summary-coming-soon-state')).toContainText('Attendance data coming soon');
    // The rest of the overview is unaffected.
    await expect(page.getByTestId('committee-overview-stats')).toBeVisible();
  });

  test('window selection is shared with the members table', async ({ page }) => {
    await mockCommitteeShell(page);
    const engagementMock = await mockEngagementApi(page, (window) => buildEngagementResponse(window));
    await gotoEngagementCommitteeTab(page, 'overview');

    const summary = page.getByTestId('committee-overview-engagement-summary');
    const flagOn = await appearsWithin(summary, ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    await summary.getByTestId('filter-pill-ytd').click();
    await expect.poll(() => engagementMock.requestedWindows().includes('ytd'), { timeout: ELEMENT_TIMEOUT }).toBe(true);

    // Navigate to the Members tab in-page — the shared page-level window state must survive.
    await page
      .getByTestId('committee-view-tabs')
      .getByRole('button', { name: /Members/ })
      .click();
    const controls = page.getByTestId('members-engagement-controls');
    await expect(controls).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(controls.getByTestId('filter-pill-ytd')).toHaveAttribute('aria-pressed', 'true');
  });
});
