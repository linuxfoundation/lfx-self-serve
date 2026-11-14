// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Foundation Lens → Participating Companies (#5697): the empty states, through the real template.
 *
 * A foundation with no activity in the selected window must say so instead of rendering a zeroed page,
 * a filter that matches no company must keep the page and show the table's no-match message, and a
 * row must keep its full company name reachable when the cell clips it. The unit spec renders the
 * component against a service double; this pins the same branches through the real route and HTTP
 * client, with the BFF reads stubbed.
 *
 * Coverage:
 *   F1  Summary `null` (no activity in the window): `foundation-participating-orgs-empty` and its copy
 *   F2  Summary with counts, list with no rows: the table's `foundation-participating-orgs-no-match` message
 *   F3  A row's company name carries its full text as a `title`
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, FOUNDATION_PARTICIPATING_ORGS_ENABLED_FLAG } from '@lfx-one/shared/constants';
import type {
  FoundationParticipatingOrgsPage,
  FoundationParticipatingOrgsSummary,
  FoundationParticipatingOrgsSummaryResponse,
} from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { seedEdPersona } from './helpers/campaign-planning.helper';
import { FOUNDATION_SLUG, stubFoundationProject, stubNavLensItems } from './helpers/formation-checklist.helper';
import { SYNTHETIC_ORG_NAME } from './fixtures/mock-data/synthetic-org.mock';

const PAGE_LOAD_TIMEOUT = 30_000;

test.beforeEach(() => skipWhenAuthMissing());
test.setTimeout(60_000);

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function summaryWithActivity(): FoundationParticipatingOrgsSummary {
  return {
    foundationSlug: FOUNDATION_SLUG,
    foundationName: 'Test Foundation',
    projectCount: 12,
    projectSlug: null,
    projectName: null,
    range: '12mo',
    asOfDate: '2026-10-15',
    availableTiers: ['Platinum', 'Gold'],
    companiesCount: 3,
    membersCount: 2,
    contributingMembersCount: 1,
    nonMembersCount: 2,
    memberCommitShare: 0.4,
  };
}

/** The dark-launch flag pinned on, the ED persona, the foundation context and the page's BFF reads, all stubbed. */
async function stubPage(page: Page, summary: FoundationParticipatingOrgsSummaryResponse, list: FoundationParticipatingOrgsPage): Promise<void> {
  await page.addInitScript(
    ([storageKey, flagKey]) => {
      const current = JSON.parse(window.localStorage.getItem(storageKey as string) ?? '{}');
      window.localStorage.setItem(storageKey as string, JSON.stringify({ ...current, [flagKey as string]: true }));
    },
    [FEATURE_FLAG_OVERRIDE_STORAGE_KEY, FOUNDATION_PARTICIPATING_ORGS_ENABLED_FLAG] as const
  );
  await seedEdPersona(page);
  await stubNavLensItems(page);
  await stubFoundationProject(page);
  await page.route('**/api/foundation-participating-orgs/projects*', (route) => fulfillJson(route, { projects: [] }));
  await page.route('**/api/foundation-participating-orgs/summary*', (route) => fulfillJson(route, summary));
  await page.route(/\/api\/foundation-participating-orgs\?/, (route) => fulfillJson(route, list));
}

async function gotoParticipatingCompanies(page: Page): Promise<void> {
  await page.goto(`/foundation/participating-orgs?project=${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('foundation-participating-orgs-page')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('Foundation Lens Participating Companies empty states', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('F1: a window with no activity says so instead of a zeroed page', async ({ page }) => {
    await stubPage(page, { summary: null }, { rows: [], totalRecords: 0 });
    await gotoParticipatingCompanies(page);

    const empty = page.getByTestId('foundation-participating-orgs-empty');
    await expect(empty).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(empty).toContainText('No contribution activity yet');
    await expect(page.getByTestId('foundation-participating-orgs-table')).toHaveCount(0);
  });

  test('F2: filters that match no company keep the page and show the no-match message', async ({ page }) => {
    await stubPage(page, { summary: summaryWithActivity() }, { rows: [], totalRecords: 0 });
    await gotoParticipatingCompanies(page);

    const noMatch = page.getByTestId('foundation-participating-orgs-no-match');
    await expect(noMatch).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(noMatch).toContainText('No companies match your filters');
    await expect(page.getByTestId('foundation-participating-orgs-tiles')).toBeVisible();
    await expect(page.getByTestId('foundation-participating-orgs-empty')).toHaveCount(0);
    await expect(page.getByTestId('foundation-participating-orgs-no-match-clear')).toBeVisible();
  });

  test('F3: a row keeps the full company name as a title', async ({ page }) => {
    await stubPage(
      page,
      { summary: summaryWithActivity() },
      {
        rows: [
          {
            participantKey: 'synthetic-company',
            accountId: null,
            name: SYNTHETIC_ORG_NAME,
            logoUrl: null,
            isMember: true,
            membershipTierClass: 'Gold',
            otherMemberships: [],
            projectsInvolved: 2,
            commits: 120,
            commitsChange: 0.2,
            contributors: 8,
            contributorsChange: null,
          },
        ],
        totalRecords: 1,
      }
    );
    await gotoParticipatingCompanies(page);

    await expect(page.getByTestId('foundation-participating-orgs-row-synthetic-company-name')).toHaveAttribute('title', SYNTHETIC_ORG_NAME, {
      timeout: PAGE_LOAD_TIMEOUT,
    });
  });
});
