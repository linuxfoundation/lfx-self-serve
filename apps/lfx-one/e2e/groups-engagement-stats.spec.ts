// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Groups dashboard — engagement stats flag/lens gating — LFXV2-1711.
 *
 * Coverage:
 *   - `wg-engagement-metrics` flag off (the default until the flag is created/enabled in
 *     LaunchDarkly): Me lens renders the 3 always-on group-count cards only, and the
 *     `/api/committees/engagement-stats` endpoint is never requested.
 *   - Foundation lens never requests or renders the engagement cards, regardless of flag state —
 *     the endpoint is caller-scoped ("mine semantics"), so it has no scoped card to render there.
 *   - `wg-engagement-metrics` flag on: Me lens renders 5 cards, with Active Members / Meetings This
 *     Month populated from the mocked engagement-stats response.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 *   - The flag-on test additionally requires `wg-engagement-metrics` toggled ON for the test user
 *     in LaunchDarkly — it skips gracefully (matching org-selector.spec.ts's precedent) if the
 *     flag isn't configured, rather than failing CI on missing external LD setup.
 */

import type { Committee, MyCommittee, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Locator, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-00000000d001';
const MOCK_COMMITTEE_UID = 'c0000000-0000-0000-0000-00000000d001';
const ENGAGEMENT_STATS_PATH = '/api/committees/engagement-stats';

function buildMyCommittees(): MyCommittee[] {
  const now = new Date().toISOString();
  return [
    {
      uid: MOCK_COMMITTEE_UID,
      name: 'Technical Steering Committee',
      category: 'Technical Steering Committee',
      enable_voting: true,
      public: true,
      sso_group_enabled: false,
      created_at: now,
      updated_at: now,
      total_members: 12,
      total_voting_repos: 5,
      project_uid: 'p0000000-0000-0000-0000-00000000d001',
      project_name: 'Test Project',
      my_role: 'Chair',
    } as MyCommittee,
  ];
}

function buildFoundationCommittees(): Committee[] {
  const now = new Date().toISOString();
  return [
    {
      uid: MOCK_COMMITTEE_UID,
      name: 'Governing Board',
      category: 'Board',
      enable_voting: true,
      public: true,
      sso_group_enabled: false,
      created_at: now,
      updated_at: now,
      total_members: 9,
      total_voting_repos: 9,
      project_uid: MOCK_FOUNDATION_UID,
      project_name: 'Test Foundation',
      is_foundation: true,
    } as Committee,
  ];
}

function buildProjectStub() {
  return {
    uid: MOCK_FOUNDATION_UID,
    slug: MOCK_FOUNDATION_SLUG,
    name: 'Test Foundation',
    description: 'Test foundation for groups engagement-stats specs',
    public: true,
    parent_uid: '',
    stage: 'Active',
    category: 'project',
    funding_model: [],
    charter_url: '',
    legal_entity_type: '',
    legal_entity_name: '',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '',
    logo_url: '',
    repository_url: '',
    website_url: '',
    created_at: '',
    updated_at: new Date().toISOString(),
    mailing_list_count: 0,
    writer: true,
  };
}

async function stubPersona(page: Page, personas: string[]): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas, personaProjects: {}, projects: [], organizations: [], isRootWriter: true }),
    })
  );
}

async function stubPendingInvitations(page: Page): Promise<void> {
  await page.route('**/api/user/pending-invitations*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }));
}

async function stubMyCommittees(page: Page, committees: MyCommittee[]): Promise<void> {
  await page.route('**/api/committees/my-committees*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committees) })
  );
}

async function stubFoundationCommittees(page: Page, committees: Committee[]): Promise<void> {
  await page.route('**/api/committees/my-committee-uids*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  );
  await page.route('**/api/committees*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/api/committees') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committees) });
  });
}

async function stubProjectApi(page: Page): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_SLUG}*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildProjectStub()) })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sfid: null }) }));
}

async function stubEngagementStats(page: Page): Promise<void> {
  await page.route(`**${ENGAGEMENT_STATS_PATH}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        active_members: 7,
        meetings_this_month: 2,
        computed_at: new Date().toISOString(),
        source: 'live',
        coverage: { covered: 1, total: 1 },
      }),
    })
  );
}

async function setCookies(page: Page, personas: string[], lens: 'me' | 'foundation'): Promise<void> {
  const state: PersistedPersonaState = { primary: personas[0] as PersonaType, all: personas as PersonaType[] };
  await page.context().addCookies([
    { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(state)), domain: 'localhost', path: '/', sameSite: 'Lax' },
    { name: LENS_COOKIE_KEY, value: lens, domain: 'localhost', path: '/', sameSite: 'Lax' },
  ]);
}

// Gated on env vars rather than on URL sniffing so genuine auth-flow regressions (expired
// storageState, broken Auth0 login helper) still fail loudly when creds ARE configured.
const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

/**
 * Whether `locator` becomes visible within `timeout` — used to detect the LaunchDarkly flag's
 * resolved state. `Locator.isVisible()`'s `timeout` option is deprecated and ignored (Playwright
 * always returns immediately from `isVisible()`, regardless of any timeout passed), so checking
 * "did the flag turn out on?" requires actually waiting via `waitFor()` — an immediate check can
 * read `false` before the async flag client resolves, even when the card appears moments later.
 */
async function cardAppears(locator: Locator, timeout: number): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function gotoMyGroups(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto('/groups', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('committees-me-stats')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

async function gotoFoundationGroups(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/foundation/groups?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('committees-foundation-stats')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('Groups dashboard — engagement stats (LFXV2-1711)', () => {
  test.describe('Me lens', () => {
    let engagementRequestCount = 0;

    test.beforeEach(async ({ page }) => {
      engagementRequestCount = 0;
      page.on('request', (req) => {
        if (req.url().includes(ENGAGEMENT_STATS_PATH)) engagementRequestCount++;
      });

      await setCookies(page, ['contributor'], 'me');
      await stubPersona(page, ['contributor']);
      await stubPendingInvitations(page);
      await stubMyCommittees(page, buildMyCommittees());
      await stubEngagementStats(page);
      await gotoMyGroups(page);
    });

    test('flag off (default): renders the 3 always-on group-count cards and never requests engagement-stats', async ({ page }) => {
      const grid = page.getByTestId('committees-me-stats');
      await expect(grid.getByTestId('stat-card-Total Groups')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(grid.getByTestId('stat-card-Public Groups')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(grid.getByTestId('stat-card-Voting Enabled Groups')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

      const activeMembersCard = grid.getByTestId('stat-card-Active Members');
      const flagAppearsOn = await cardAppears(activeMembersCard, ELEMENT_TIMEOUT);
      test.skip(flagAppearsOn, 'wg-engagement-metrics flag appears ON for this test user — covered by the flag-on test below instead');

      await expect(activeMembersCard).toHaveCount(0);
      await expect(grid.getByTestId('stat-card-Meetings This Month')).toHaveCount(0);

      // Wait a moment for any async requests to fire, then assert the flag-gated fetch never ran.
      await page.waitForTimeout(1_000);
      expect(engagementRequestCount).toBe(0);
    });

    test('flag on: renders 5 cards, with Active Members / Meetings This Month populated from the response', async ({ page }) => {
      const grid = page.getByTestId('committees-me-stats');
      const activeMembersCard = grid.getByTestId('stat-card-Active Members');

      const flagAppearsOn = await cardAppears(activeMembersCard, ELEMENT_TIMEOUT);
      test.skip(!flagAppearsOn, 'wg-engagement-metrics flag appears OFF for this test user — see file header for the LD precondition');

      await expect(activeMembersCard).toContainText('7', { timeout: ELEMENT_TIMEOUT });
      await expect(grid.getByTestId('stat-card-Meetings This Month')).toContainText('2', { timeout: ELEMENT_TIMEOUT });
      expect(engagementRequestCount).toBeGreaterThanOrEqual(1);
    });
  });

  test.describe('Foundation lens', () => {
    test.beforeEach(async ({ page }) => {
      await setCookies(page, ['executive-director'], 'foundation');
      await stubPersona(page, ['executive-director']);
      await stubProjectApi(page);
      await stubFoundationCommittees(page, buildFoundationCommittees());
      await stubEngagementStats(page);
    });

    test('never requests or renders the engagement cards, regardless of flag state', async ({ page }) => {
      let engagementRequestCount = 0;
      page.on('request', (req) => {
        if (req.url().includes(ENGAGEMENT_STATS_PATH)) engagementRequestCount++;
      });

      await gotoFoundationGroups(page);

      const grid = page.getByTestId('committees-foundation-stats');
      await expect(grid.getByTestId('stat-card-Total Groups')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(grid.getByTestId('stat-card-Active Members')).toHaveCount(0);
      await expect(grid.getByTestId('stat-card-Meetings This Month')).toHaveCount(0);

      await page.waitForTimeout(1_000);
      expect(engagementRequestCount).toBe(0);
    });
  });
});
