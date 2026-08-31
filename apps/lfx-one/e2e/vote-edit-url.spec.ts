// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Vote edit-link canonical URLs — GH-1568.
 *
 * The votes table derives each row's edit link from THAT ROW's own project tier
 * (`is_foundation`) and slug — not the viewer's transient active lens — because dashboard
 * rows can span projects (foundation lens aggregates child-project votes). Coverage:
 *   - foundation-owned row → /foundation/votes/:uid/edit?project=<slug> (+ committee_uid when the row carries one)
 *   - project-owned row    → /project/votes/:uid/edit?project=<slug>
 *   - unenriched row       → flat /votes/:uid/edit (tier unknown → lensRedirectGuard fallback)
 *   - clicking a canonical link lands on the edit page under the vote's own project context.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import { expect, Page, Route, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const FOUNDATION_SLUG = 'test-foundation';
const FOUNDATION_UID = 'f0000000-0000-0000-0000-00000000d001';
const PROJECT_SLUG = 'other-project';
const PROJECT_UID = 'p0000000-0000-0000-0000-00000000d003';
const COMMITTEE_UID = 'c0000000-0000-0000-0000-00000000d001';

const FOUNDATION_VOTE_UID = 'v0000000-0000-0000-0000-00000000d101';
const PROJECT_VOTE_UID = 'v0000000-0000-0000-0000-00000000d102';
const UNENRICHED_VOTE_UID = 'v0000000-0000-0000-0000-00000000d103';
const UNENRICHED_PROJECT_UID = 'p0000000-0000-0000-0000-00000000d109';

const LENS_COOKIE = 'lfx-active-lens';
const SELECTED_FOUNDATION_COOKIE_KEY = 'lfx-selected-foundation';

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

// Gated on env vars rather than on URL sniffing so genuine auth-flow regressions (expired
// storageState, broken Auth0 login helper) still fail loudly when creds ARE configured.
const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

function buildProjectStub(uid: string, slug: string, name: string) {
  return {
    uid,
    slug,
    name,
    description: `${name} for vote-edit-url specs`,
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

/** Vote row as emitted by the query-service index (post-normalization). All rows are DISABLED — the only status the table renders an Edit button for. */
function buildVoteRow(uid: string, name: string, projectUid: string, extra: Record<string, unknown> = {}) {
  return {
    uid,
    name,
    description: `${name} — vote-edit-url spec fixture`,
    status: 'disabled',
    project_uid: projectUid,
    end_time: '2099-06-01T18:00:00Z',
    ...extra,
  };
}

/** Detail payload for the edit page (BFF-enriched: carries the project fields). */
function buildVoteDetail(uid: string, projectUid: string, projectSlug: string, projectName: string, isFoundation: boolean) {
  return {
    ...buildVoteRow(uid, 'Spec ballot', projectUid),
    project_slug: projectSlug,
    project_name: projectName,
    is_foundation: isFoundation,
  };
}

async function seedFoundationLens(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: LENS_COOKIE, value: 'foundation', domain: 'localhost', path: '/', sameSite: 'Lax' },
    {
      name: SELECTED_FOUNDATION_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ uid: FOUNDATION_UID, slug: FOUNDATION_SLUG, name: 'Test Foundation' })),
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ]);
}

async function stubShellFeeds(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  // Without stubbed lens items the app loads the TEST ACCOUNT'S REAL foundations/projects and
  // NavigationService.applyDefaultSelection overrides the stubbed context mid-test.
  await page.route('**/api/nav/lens-items*', (route) => {
    const url = new URL(route.request().url());
    const isFoundation = url.searchParams.get('lens') !== 'project';
    const items = isFoundation
      ? [{ uid: FOUNDATION_UID, slug: FOUNDATION_SLUG, name: 'Test Foundation', logoUrl: null, isFoundation: true }]
      : [{ uid: PROJECT_UID, slug: PROJECT_SLUG, name: 'Other Project', logoUrl: null, isFoundation: false }];
    return fulfillJson(route, { items, next_page_token: null, upstream_failed: false, lens: isFoundation ? 'foundation' : 'project' });
  });
  await page.route(`**/api/projects/${FOUNDATION_SLUG}*`, (route) => fulfillJson(route, buildProjectStub(FOUNDATION_UID, FOUNDATION_SLUG, 'Test Foundation')));
  await page.route(`**/api/projects/${PROJECT_SLUG}*`, (route) => fulfillJson(route, buildProjectStub(PROJECT_UID, PROJECT_SLUG, 'Other Project')));
  await page.route('**/api/projects/*/sfid*', (route) => fulfillJson(route, { sfid: null }));
  await page.route('**/api/committees/my-committee-uids*', (route) => fulfillJson(route, []));
  await page.route('**/api/committees*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/api/committees') {
      return route.fallback();
    }
    return fulfillJson(route, []);
  });
  // Detail stub for the vote-manage writeAccess committee leg — the foundation row's edit link
  // carries ?committee_uid=, and without this the fetch falls through the catch-all to the real BFF.
  await page.route(`**/api/committees/${COMMITTEE_UID}`, (route) =>
    fulfillJson(route, { uid: COMMITTEE_UID, name: 'Governing Board', writer: true })
  );
}

/**
 * Stubs the votes index feed with one row per link shape, plus the two detail endpoints the
 * click-through tests open. Catch-all routes register FIRST (Playwright matches routes in reverse
 * registration order) so the per-uid detail routes win and incidental count calls stay stubbed.
 */
async function stubVotesFeed(page: Page): Promise<void> {
  await page.route('**/api/votes*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/votes/count') {
      return fulfillJson(route, { count: 3 });
    }
    return fulfillJson(route, {
      data: [
        // Foundation-owned, committee-scoped row — canonical link targets the foundation tier
        // and keeps the committee context the edit form locks onto.
        buildVoteRow(FOUNDATION_VOTE_UID, 'Foundation Charter Ratification', FOUNDATION_UID, {
          project_slug: FOUNDATION_SLUG,
          project_name: 'Test Foundation',
          is_foundation: true,
          committee_uid: COMMITTEE_UID,
          committee_name: 'Governing Board',
        }),
        // Project-owned row — canonical link targets the project tier.
        buildVoteRow(PROJECT_VOTE_UID, 'Other Project Steering Election', PROJECT_UID, {
          project_slug: PROJECT_SLUG,
          project_name: 'Other Project',
          is_foundation: false,
        }),
        // Unenriched row (no project_slug / is_foundation) — tier unknown, flat fallback.
        buildVoteRow(UNENRICHED_VOTE_UID, 'Legacy Unenriched Poll', UNENRICHED_PROJECT_UID),
      ],
    });
  });
  await page.route(`**/api/votes/${FOUNDATION_VOTE_UID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillJson(route, buildVoteDetail(FOUNDATION_VOTE_UID, FOUNDATION_UID, FOUNDATION_SLUG, 'Test Foundation', true));
  });
  await page.route(`**/api/votes/${PROJECT_VOTE_UID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return fulfillJson(route, buildVoteDetail(PROJECT_VOTE_UID, PROJECT_UID, PROJECT_SLUG, 'Other Project', false));
  });
}

/** Boots the foundation-lens votes dashboard with the three-row feed rendered. */
async function gotoVotesDashboard(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await seedFoundationLens(page);
  await stubShellFeeds(page);
  await stubVotesFeed(page);

  await page.goto(`/foundation/votes?project=${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId(`votes-edit-${FOUNDATION_VOTE_UID}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('Vote edit-link canonical URLs (GH-1568)', () => {
  test('each row derives its edit link from its own project tier and slug', async ({ page }) => {
    await gotoVotesDashboard(page);

    const foundationEdit = page.getByTestId(`votes-edit-${FOUNDATION_VOTE_UID}`);
    await expect(foundationEdit).toHaveAttribute('href', new RegExp(`^/foundation/votes/${FOUNDATION_VOTE_UID}/edit\\?`));
    await expect(foundationEdit).toHaveAttribute('href', /[?&]project=test-foundation/);
    await expect(foundationEdit).toHaveAttribute('href', new RegExp(`[?&]committee_uid=${COMMITTEE_UID}`));

    const projectEdit = page.getByTestId(`votes-edit-${PROJECT_VOTE_UID}`);
    await expect(projectEdit).toHaveAttribute('href', new RegExp(`^/project/votes/${PROJECT_VOTE_UID}/edit\\?project=${PROJECT_SLUG}$`));

    // Tier unknown (unenriched row) → flat path, the lensRedirectGuard fallback contract.
    await expect(page.getByTestId(`votes-edit-${UNENRICHED_VOTE_UID}`)).toHaveAttribute('href', `/votes/${UNENRICHED_VOTE_UID}/edit`);
  });

  test('clicking a foundation-owned row’s edit link lands on the foundation-tier edit page', async ({ page }) => {
    await gotoVotesDashboard(page);

    await page.getByTestId(`votes-edit-${FOUNDATION_VOTE_UID}`).click();

    await expect(page).toHaveURL(new RegExp(`/foundation/votes/${FOUNDATION_VOTE_UID}/edit\\?`), { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('vote-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    // The ?project= the link carried survives the navigation, and the context is the vote's foundation.
    await expect(page).toHaveURL(/[?&]project=test-foundation/);
    await expect(page.getByTestId('project-selector')).toContainText('Test Foundation', { timeout: ELEMENT_TIMEOUT });
  });

  test('clicking a project-owned row’s edit link lands on the project-tier edit page', async ({ page }) => {
    await gotoVotesDashboard(page);

    await page.getByTestId(`votes-edit-${PROJECT_VOTE_UID}`).click();

    await expect(page).toHaveURL(new RegExp(`^/project/votes/${PROJECT_VOTE_UID}/edit\\?project=${PROJECT_SLUG}$`), { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('vote-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('project-selector')).toContainText('Other Project', { timeout: ELEMENT_TIMEOUT });
  });
});
