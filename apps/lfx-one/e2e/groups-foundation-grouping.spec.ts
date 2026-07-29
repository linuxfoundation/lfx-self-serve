// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * All Groups — foundation tree-grouping — LFXV2-1715.
 *
 * Coverage:
 *   - Foundation-scoped groups are grouped by resolved project/foundation label.
 *   - Groups render expanded by default; clicking a header collapses/re-expands it.
 *   - Search still narrows results while grouping is active, and a group that loses
 *     all its members after filtering is entirely absent from the DOM.
 *   - Single-project scope (no foundation context) stays ungrouped.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { Committee, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-00000000b001';
const MOCK_COMMITTEE_UID_BOARD = 'c0000000-0000-0000-0000-00000000b001';
const MOCK_COMMITTEE_UID_SUB_A = 'c0000000-0000-0000-0000-00000000b002';
const MOCK_COMMITTEE_UID_SUB_B = 'c0000000-0000-0000-0000-00000000b003';

function buildProjectStub() {
  return {
    uid: MOCK_FOUNDATION_UID,
    slug: MOCK_FOUNDATION_SLUG,
    name: 'Test Foundation',
    description: 'Test foundation for groups foundation-grouping specs',
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

function buildCommittees(): Committee[] {
  const now = new Date().toISOString();
  return [
    {
      uid: MOCK_COMMITTEE_UID_BOARD,
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
    {
      uid: MOCK_COMMITTEE_UID_SUB_A,
      name: 'Alpha Working Group',
      category: 'Working Group',
      enable_voting: false,
      public: true,
      sso_group_enabled: false,
      created_at: now,
      updated_at: now,
      total_members: 6,
      total_voting_repos: 0,
      project_uid: 'p0000000-0000-0000-0000-00000000c001',
      project_name: 'Alpha Project',
      parent_project_uid: MOCK_FOUNDATION_UID,
      is_foundation: false,
    } as Committee,
    {
      uid: MOCK_COMMITTEE_UID_SUB_B,
      name: 'Beta Technical Committee',
      category: 'Technical Steering Committee',
      enable_voting: true,
      public: true,
      sso_group_enabled: false,
      created_at: now,
      updated_at: now,
      total_members: 3,
      total_voting_repos: 3,
      project_uid: 'p0000000-0000-0000-0000-00000000c002',
      project_name: 'Beta Project',
      parent_project_uid: MOCK_FOUNDATION_UID,
      is_foundation: false,
    } as Committee,
  ];
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

async function stubProjectApi(page: Page): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_SLUG}*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildProjectStub()) })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sfid: null }) }));
}

async function stubCommittees(page: Page, committees: Committee[]): Promise<void> {
  await page.route('**/api/committees/my-committee-uids*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  );
  await page.route('**/api/committees*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/api/committees') {
      return route.fallback();
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committees) });
  });
}

async function setCookies(page: Page, personas: string[], lens: 'foundation' | 'project'): Promise<void> {
  const state: PersistedPersonaState = {
    primary: personas[0] as PersonaType,
    all: personas as PersonaType[],
  };
  await page.context().addCookies([
    { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(state)), domain: 'localhost', path: '/', sameSite: 'Lax' },
    { name: LENS_COOKIE_KEY, value: lens, domain: 'localhost', path: '/', sameSite: 'Lax' },
  ]);
}

// Gated on env vars rather than on URL sniffing so genuine auth-flow regressions
// (expired storageState, broken Auth0 login helper) still fail loudly when creds
// ARE configured. URL-based detection silently turned those into green skips.
const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

async function gotoFoundationGroups(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/foundation/groups?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  // Ready-state wait: the seeded board committee always renders once loaded, expanded or not.
  await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID_BOARD}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

async function gotoProjectGroups(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/project/groups?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  // Ready-state wait: the ungrouped flat table is the only render target for this scope.
  await expect(page.getByTestId('committees-project-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('All Groups — foundation tree-grouping', () => {
  test.beforeEach(async ({ page }) => {
    await setCookies(page, ['executive-director'], 'foundation');
    await stubPersona(page, ['executive-director']);
    await stubProjectApi(page);
    await stubCommittees(page, buildCommittees());
    await gotoFoundationGroups(page);
  });

  test('groups render expanded by default, one per resolved foundation/project label', async ({ page }) => {
    const boardGroup = page.getByTestId('groups-foundation-group-test-foundation');
    const alphaGroup = page.getByTestId('groups-foundation-group-alpha-project');
    const betaGroup = page.getByTestId('groups-foundation-group-beta-project');

    await expect(boardGroup, 'foundation-level group should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(alphaGroup, 'sub-project group should render').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(betaGroup, 'sub-project group should render').toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID_BOARD}`), 'expanded-by-default: board committee row visible').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID_SUB_A}`), 'expanded-by-default: alpha committee row visible').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });

  test('collapsing a group hides its rows; expanding again restores them', async ({ page }) => {
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID_SUB_A}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    const caret = page.getByTestId('groups-foundation-group-alpha-project-caret');
    await caret.click();
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID_SUB_A}`), 'rows should hide after collapsing').toHaveCount(0);

    await caret.click();
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID_SUB_A}`), 'rows should return after re-expanding').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });

  test('search narrows results, and a fully-filtered-out group is entirely absent', async ({ page }) => {
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID_BOARD}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId('committee-search-input').getByRole('textbox').fill('Alpha');

    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID_SUB_A}`), 'matching committee should remain').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('groups-foundation-group-test-foundation'), 'a group with no matches should be entirely absent').toHaveCount(0);
    await expect(page.getByTestId('groups-foundation-group-beta-project'), 'a group with no matches should be entirely absent').toHaveCount(0);
  });
});

test.describe('All Groups — single-project scope stays ungrouped', () => {
  test.beforeEach(async ({ page }) => {
    await setCookies(page, ['executive-director'], 'project');
    await stubPersona(page, ['executive-director']);
    await stubProjectApi(page);
    await stubCommittees(page, buildCommittees());
  });

  test('project-scoped route renders the flat table, with no foundation-group headers', async ({ page }) => {
    await gotoProjectGroups(page);

    await expect(page.getByTestId('committees-project-table'), 'flat, ungrouped table should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID_BOARD}`)).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('groups-foundation-group-test-foundation'), 'no group headers when scope is a single project').toHaveCount(0);
    await expect(page.getByTestId('groups-foundation-group-alpha-project')).toHaveCount(0);
  });
});
