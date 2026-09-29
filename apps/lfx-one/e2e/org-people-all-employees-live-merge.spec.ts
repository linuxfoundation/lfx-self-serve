// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * People → All Employees: the stored (Snowflake) roster paints first, and the live merge replaces it
 * when it lands (#3049). Deterministic via route mocks: `/lens/people/all` answers at once, while
 * `/lens/people/all?live=true` is held open until the test releases it.
 */

import type { OrgAllEmployeeRow, OrgAllEmployeesResponse, OrgPersonSource } from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from './fixtures/mock-data/synthetic-org.mock';

const PEOPLE_ALL_URL = '/org/people?tab=all';
const DATA_LOAD_TIMEOUT = 30_000;

const MOCK_ACCOUNT_ID = SYNTHETIC_ORG_ACCOUNT_ID;
const MOCK_UID = MOCK_ACCOUNT_ID;
const MOCK_ACCOUNT_NAME = SYNTHETIC_ORG_NAME;

const PEOPLE_ALL_ROUTE = /\/api\/orgs\/[^/]+\/lens\/people\/all(?:\?.*)?$/;

function row(personKey: string, name: string, email: string, sources: OrgPersonSource[], seatsCount: number): OrgAllEmployeeRow {
  return {
    personKey,
    lfid: null,
    lfUsername: null,
    cdpMemberId: null,
    name,
    firstName: null,
    lastName: null,
    title: null,
    email,
    accessBadge: null,
    avatarUrl: null,
    sources,
    seatsCount,
    boardSeatsCount: 0,
    committeeSeatsCount: seatsCount,
    commitsCount: 3,
    eventsCount: 0,
    coursesCount: 0,
    engagedFoundationIds: [],
  };
}

function roster(rows: OrgAllEmployeeRow[], inGovernance: number): OrgAllEmployeesResponse {
  return {
    accountId: MOCK_ACCOUNT_ID,
    rows,
    stats: { activeInOss: rows.length, inGovernance, codeContributors: rows.length, eventAttendees: 0, trainees: 0 },
    foundations: [],
  };
}

// Snowflake knows Morgan only; the live merge adds Riley, who holds a committee seat Snowflake hasn't synced yet.
const SNOWFLAKE_ROSTER = roster([row('sf-morgan', 'Morgan Diaz', 'morgan.diaz@acme-motors.example', ['snowflake'], 0)], 0);
const LIVE_ROSTER = roster(
  [
    row('sf-morgan', 'Morgan Diaz', 'morgan.diaz@acme-motors.example', ['snowflake'], 0),
    row('live-riley', 'Riley Park', 'riley.park@acme-motors.example', ['committee'], 1),
  ],
  1
);

function skipWhenAuthMissing(page: Page): void {
  let hostname: string;
  try {
    ({ hostname } = new URL(page.url()));
  } catch {
    // Malformed URL — let the test run and surface a useful failure.
    return;
  }
  // Outside the try: `test.skip` throws to stop the test, and a catch would swallow it.
  if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

async function stubAccountContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [{ accountId: MOCK_ACCOUNT_ID, accountName: MOCK_ACCOUNT_NAME, membershipTier: '', uid: MOCK_UID }],
        isRootWriter: false,
      }),
    })
  );
  // The sidebar org selector loads its own org-items page on startup; a live list without this org clears
  // the seeded selection (and the writer grant with it), so stub it as org-profile.spec.ts does.
  await page.route('**/api/nav/org-items*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{ uid: MOCK_UID, accountId: MOCK_ACCOUNT_ID, name: MOCK_ACCOUNT_NAME, logoUrl: null }],
        next_page_token: null,
        upstream_failed: false,
      }),
    })
  );

  await page.route('**/api/orgs/me/role-grants', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        writers: [MOCK_UID],
        auditors: [],
        cascadingWriters: [],
        cascadingAuditors: [],
        username: 'e2e-org-people-all-employees',
        loaded_at: new Date().toISOString(),
      }),
    })
  );
}

/** Answers the stored roster at once and holds the live merge until the returned `releaseLive` is called. */
async function stubPeopleAllWithHeldLive(page: Page): Promise<{ releaseLive: () => void }> {
  let releaseLive!: () => void;
  const liveReleased = new Promise<void>((resolve) => {
    releaseLive = resolve;
  });
  await page.route(PEOPLE_ALL_ROUTE, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const isLive = new URL(route.request().url()).searchParams.get('live') === 'true';
    if (isLive) {
      await liveReleased;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIVE_ROSTER) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SNOWFLAKE_ROSTER) });
  });
  return { releaseLive };
}

async function gotoAllEmployeesTab(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(PEOPLE_ALL_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  await expect(page.getByTestId('org-people-panel-all')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

test.setTimeout(120_000);

test.describe('Org People → All Employees — stored roster first, live merge second', () => {
  test('shows the stored roster while the live merge is pending, then replaces it with the live roster', async ({ page }) => {
    await stubAccountContext(page);
    const { releaseLive } = await stubPeopleAllWithHeldLive(page);
    const liveRequested = page.waitForRequest((request) => PEOPLE_ALL_ROUTE.test(request.url()) && new URL(request.url()).searchParams.get('live') === 'true');

    await gotoAllEmployeesTab(page);

    // Stored roster is on screen while the live request is still held open.
    await liveRequested;
    await expect(page.getByTestId('org-people-all-employees-row-sf-morgan')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-people-all-employees-row-live-riley')).toHaveCount(0);
    await expect(page.getByTestId('org-people-all-employees-stat-governance')).toContainText('0');
    await expect(page.getByTestId('org-people-all-employees-error')).toHaveCount(0);

    releaseLive();

    // The live merge replaces the stored roster wholesale: the live-only person appears, nobody is duplicated.
    await expect(page.getByTestId('org-people-all-employees-row-live-riley')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-people-all-employees-row-sf-morgan')).toHaveCount(1);
    await expect(page.getByTestId('org-people-all-employees-stat-governance')).toContainText('1');
  });
});
