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
import { skipWhenAuthMissing } from './helpers/auth.helper';

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

test.beforeEach(() => skipWhenAuthMissing());

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
    // Emeritus, LF Staff + Observer, and LF Staff + no voting status all render their own neutral
    // tier — never Low/Inactive/at-risk styling. m-lf-staff-none's classification is fixture-mocked
    // ('LF Staff' hardcoded below), so this only proves the UI renders it correctly, not that the
    // tenure-grace decision is right — that's covered directly in
    // committee-engagement-classifier.utils.spec.ts's classifyCommitteeEngagement cases.
    await expect(page.getByTestId('members-engagement-chip-m-emeritus')).toContainText('Emeritus');
    await expect(page.getByTestId('members-engagement-chip-m-lf-staff')).toContainText('LF Staff');
    await expect(page.getByTestId('members-engagement-chip-m-lf-staff-none')).toContainText('LF Staff');
    // The chip text alone doesn't prove the reported bug's second symptom stays fixed — the tooltip
    // (resolveEngagementContext) is a separate code path that could regress to the generic
    // "attended X of Y invited meetings" role-context branch while classification still renders
    // correctly. Hover and assert the actual exclusion tooltip text.
    await page.getByTestId('members-engagement-chip-m-lf-staff-none').hover();
    await expect(page.locator('.p-tooltip')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.locator('.p-tooltip')).toContainText('LF Staff seat — excluded from engagement metrics; attendance expectations do not apply');
    // An LF Staff member who is a real Voting Rep classifies on real attendance, NOT the neutral
    // LF Staff tier.
    await expect(page.getByTestId('members-engagement-chip-m-lf-staff-rep')).toContainText('High');

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
    await expect(page.getByText('Alex Nonstatus')).toHaveCount(0);
    // Real 80% attendance — not at-risk, filtered out same as any other well-engaged member.
    await expect(page.getByText('Priya Repstaff')).toHaveCount(0);
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
    // `engagementDataAvailable()` gates the chip render for every row (committee-members.component.
    // html), so every classification — including m-lf-staff-none's — renders the same em-dash here
    // regardless of what degradedClassification computed; that delegation isn't observable on this
    // path or the live path above (both fixture-mock the classification directly rather than
    // deriving it). isLfStaffNonVotingSeat's own decision table is covered directly in
    // committee-engagement-classifier.utils.spec.ts's classifyCommitteeEngagement cases.
    await expect(page.getByTestId('members-engagement-chip-m-lf-staff-none')).toHaveText('—');
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
    // 4/6, not 4/9 — the denominator is eligible_count (roster minus Emeritus/non-voting LF Staff),
    // not total_count. active_count is 4 (m-high, m-medium, m-low, m-lf-staff-rep — the real Voting
    // Rep LF Staff member counts like any other real member).
    await expect(summary.getByTestId('committee-engagement-summary-active-members')).toContainText('4/6');
    await expect(summary.getByTestId('committee-engagement-summary-at-risk')).toContainText('2');
    await expect(summary.getByTestId('committee-engagement-summary-freshness')).toHaveText('Updated daily');
  });

  test('renders an em-dash, not "0/0", for a committee whose roster is entirely excluded from active_count (GH-1848)', async ({ page }) => {
    await mockCommitteeShell(page);
    // Only `summary` is overridden — the active-members row this assertion targets reads only
    // `summary.eligible_count`/`active_count`, not `members[]`, so the roster itself can stay the
    // default mixed fixture (the rest of the response, notably `data_available: true`, also stays
    // default, which is what keeps the metrics block rendered at all instead of falling into the
    // coming-soon state). The attendance-rate row is a different story — it re-derives its own gate
    // from `members[]` (`hasInvitedRateEligibleMember`), and the default fixture's roster still has
    // an invited rate-eligible member, so it renders a real percentage here rather than an em-dash;
    // that's fine, this test doesn't assert on it. `eligible_count: 0` here stands in for the real-world
    // shape GH-1848 makes reachable: a committee without voting where every seat is Emeritus or
    // non-voting LF Staff, so the ratio's denominator is genuinely 0.
    await mockEngagementApi(page, (window) => {
      const base = buildEngagementResponse(window);
      return { ...base, summary: { ...base.summary, attendance_rate: 0, active_count: 0, eligible_count: 0, at_risk_count: 0 } };
    });
    await gotoEngagementCommitteeTab(page, 'overview');

    const summary = page.getByTestId('committee-overview-engagement-summary');
    const flagOn = await appearsWithin(summary, ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    await expect(summary.getByTestId('committee-engagement-summary-active-members')).toContainText('—', { timeout: ELEMENT_TIMEOUT });
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
