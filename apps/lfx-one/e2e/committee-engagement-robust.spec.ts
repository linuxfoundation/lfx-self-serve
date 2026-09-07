// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Committee engagement UI — robust structural tests — LFXV2-1705.
 *
 * Asserts the data-testid contract of the flag-gated engagement surfaces (Members-table columns,
 * window controls, Overview summary card) independent of copy/content, so content tweaks don't
 * break the structural coverage. Flag-off structure is deterministic (blocked LaunchDarkly);
 * flag-on structure probes and skips when the LaunchDarkly precondition isn't met (matching
 * groups-engagement-stats.spec.ts).
 *
 * Prerequisites: dev server at the Playwright baseURL; TEST_USERNAME / TEST_PASSWORD in
 * apps/lfx-one/.env; flag-on tests need `wg-engagement-metrics` ON for the test user.
 */

import { expect, test } from '@playwright/test';
import { skipWhenAuthMissing } from './helpers/auth.helper';

import {
  appearsWithin,
  blockLaunchDarkly,
  buildEngagementResponse,
  ELEMENT_TIMEOUT,
  gotoEngagementCommitteeTab,
  mockCommitteeShell,
  mockEngagementApi,
  PAGE_LOAD_TIMEOUT,
} from './helpers/committee-engagement.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(120_000);

test.describe('Committee engagement — structural contract (flag on)', () => {
  test('members tab exposes the engagement testid contract', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockEngagementApi(page, (window) => buildEngagementResponse(window));
    await gotoEngagementCommitteeTab(page, 'members');

    const controls = page.getByTestId('members-engagement-controls');
    const flagOn = await appearsWithin(controls, ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    // Window selector pills — one per supported window, inside the controls container.
    await expect(controls.getByTestId('filter-pill-30d')).toBeVisible();
    await expect(controls.getByTestId('filter-pill-90d')).toBeVisible();
    await expect(controls.getByTestId('filter-pill-ytd')).toBeVisible();
    await expect(controls.getByTestId('members-engagement-freshness')).toBeVisible();

    // Per-member cells exist for every roster row (chips only guaranteed on rows with data).
    await expect(page.getByTestId('members-engagement-meetings-m-high')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('members-engagement-chip-m-high')).toBeVisible();
    await expect(page.getByTestId('members-engagement-meetings-m-emeritus')).toBeVisible();
    await expect(page.getByTestId('members-engagement-chip-m-emeritus')).toBeVisible();
    await expect(page.getByTestId('members-engagement-meetings-m-lf-staff')).toBeVisible();
    await expect(page.getByTestId('members-engagement-chip-m-lf-staff')).toBeVisible();

    // The At Risk chip joins the existing chip row's testid scheme.
    await expect(page.getByTestId('members-filter-chips').getByTestId('members-chip-atRisk')).toBeVisible();
  });

  test('overview tab exposes the summary card testid contract', async ({ page }) => {
    await mockCommitteeShell(page);
    await mockEngagementApi(page, (window) => buildEngagementResponse(window));
    await gotoEngagementCommitteeTab(page, 'overview');

    const summary = page.getByTestId('committee-overview-engagement-summary');
    const flagOn = await appearsWithin(summary, ELEMENT_TIMEOUT);
    test.skip(!flagOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

    await expect(summary.getByTestId('committee-engagement-summary')).toBeVisible();
    await expect(summary.getByTestId('committee-engagement-summary-attendance-rate')).toBeVisible();
    await expect(summary.getByTestId('committee-engagement-summary-active-members')).toBeVisible();
    await expect(summary.getByTestId('committee-engagement-summary-at-risk')).toBeVisible();
    await expect(summary.getByTestId('committee-engagement-summary-freshness')).toBeVisible();
    await expect(summary.getByTestId('filter-pill-30d')).toBeVisible();
  });
});

test.describe('Committee engagement — structural contract (flag off, deterministic)', () => {
  test('no engagement testids render anywhere with the flag off', async ({ page }) => {
    await blockLaunchDarkly(page);
    await mockCommitteeShell(page);
    await mockEngagementApi(page, (window) => buildEngagementResponse(window));
    await gotoEngagementCommitteeTab(page, 'members');

    await expect(page.getByTestId('members-filter-chips')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('members-engagement-controls')).toHaveCount(0);
    await expect(page.getByTestId('members-chip-atRisk')).toHaveCount(0);
    await expect(page.getByTestId('members-engagement-meetings-m-high')).toHaveCount(0);
    await expect(page.getByTestId('members-engagement-chip-m-high')).toHaveCount(0);

    await gotoEngagementCommitteeTab(page, 'overview');
    await expect(page.getByTestId('committee-overview-stats')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-overview-engagement-summary')).toHaveCount(0);
    await expect(page.getByTestId('committee-engagement-summary')).toHaveCount(0);
  });
});
