// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Foundation/project context deep-linking — LFXV2-2837.
 *
 * Coverage:
 *   - Sidebar nav links carry `?project=<slug>` while on a foundation-lens page, so switching
 *     tabs (Meetings, Groups, Mailing Lists, ...) doesn't drop it.
 *   - A fresh load that restores context from cookie (no `?project=` in the URL) gets the slug
 *     backfilled via `Location.replaceState`, with no extra navigation.
 *   - Entity detail routes with a route param (`/foundation/groups/:id`) are exempt from the
 *     backfill — they resolve context from the entity itself via `syncEntityProjectContext`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { Committee, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY, SELECTED_FOUNDATION_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-00000000d001';
const OTHER_FOUNDATION_SLUG = 'other-foundation';
const OTHER_FOUNDATION_UID = 'f0000000-0000-0000-0000-00000000d002';
const MOCK_COMMITTEE_UID = 'c0000000-0000-0000-0000-00000000d001';

function buildProjectStub(uid: string, slug: string, name: string) {
  return {
    uid,
    slug,
    name,
    description: `${name} for project-context deep-link specs`,
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
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildProjectStub(MOCK_FOUNDATION_UID, MOCK_FOUNDATION_SLUG, 'Test Foundation')),
    })
  );
  await page.route(`**/api/projects/${OTHER_FOUNDATION_SLUG}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildProjectStub(OTHER_FOUNDATION_UID, OTHER_FOUNDATION_SLUG, 'Other Foundation')),
    })
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

async function stubCommitteeDetail(page: Page, uid: string): Promise<void> {
  const committee = {
    uid,
    name: 'Governing Board',
    description: 'Entity-detail stub for project-context deep-link specs.',
    category: 'Board',
    public: true,
    enable_voting: true,
    join_mode: 'open',
    foundation_name: 'Test Foundation',
    project_name: 'Test Foundation',
    project_uid: MOCK_FOUNDATION_UID,
    project_slug: MOCK_FOUNDATION_SLUG,
    is_foundation: true,
    parent_uid: null,
    parent_project_uid: null,
    total_members: 9,
    created_at: '2025-01-15T00:00:00Z',
    updated_at: '2025-06-01T00:00:00Z',
    member_visibility: 'basic_profile',
    writer: false,
    my_role: null,
    auditors: [],
  };
  await page.route(`**/api/committees/${uid}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committee) });
  });
  await page.route(`**/api/committees/${uid}/children`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${uid}/members`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${uid}/invites*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/mailing-lists*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/meetings*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
}

async function setPersonaAndLensCookies(page: Page, personas: string[], lens: 'foundation' | 'project'): Promise<void> {
  const state: PersistedPersonaState = {
    primary: personas[0] as PersonaType,
    all: personas as PersonaType[],
  };
  await page.context().addCookies([
    { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(state)), domain: 'localhost', path: '/', sameSite: 'Lax' },
    { name: LENS_COOKIE_KEY, value: lens, domain: 'localhost', path: '/', sameSite: 'Lax' },
  ]);
}

async function setFoundationCookie(page: Page, uid: string, slug: string, name: string): Promise<void> {
  await page.context().addCookies([
    {
      name: SELECTED_FOUNDATION_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ uid, slug, name })),
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
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

async function goto(page: Page, path: string): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Foundation/project context deep-linking (LFXV2-2837)', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaAndLensCookies(page, ['executive-director'], 'foundation');
    await stubPersona(page, ['executive-director']);
    await stubProjectApi(page);
    await stubCommittees(page, buildCommittees());
  });

  test('sidebar nav links carry ?project= while on a foundation-lens page', async ({ page }) => {
    await goto(page, `/foundation/groups?project=${MOCK_FOUNDATION_SLUG}`);
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    const meetingsLink = page.getByTestId('sidebar-item-meetings');
    const mailingListsLink = page.getByTestId('sidebar-item-mailing-lists');
    const groupsLink = page.getByTestId('sidebar-item-groups');

    await expect(meetingsLink).toHaveAttribute('href', new RegExp(`/foundation/meetings\\?project=${MOCK_FOUNDATION_SLUG}$`));
    await expect(mailingListsLink).toHaveAttribute('href', new RegExp(`/foundation/mailing-lists\\?project=${MOCK_FOUNDATION_SLUG}$`));
    await expect(groupsLink).toHaveAttribute('href', new RegExp(`/foundation/groups\\?project=${MOCK_FOUNDATION_SLUG}$`));
  });

  test('tab switch preserves ?project= across an in-app navigation', async ({ page }) => {
    await goto(page, `/foundation/groups?project=${MOCK_FOUNDATION_SLUG}`);
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId('sidebar-item-groups').click();

    await expect(page).toHaveURL(new RegExp(`/foundation/groups\\?project=${MOCK_FOUNDATION_SLUG}$`), { timeout: ELEMENT_TIMEOUT });
  });

  test('fresh load with cookie-restored context backfills ?project= with no extra navigation', async ({ page }) => {
    await setFoundationCookie(page, MOCK_FOUNDATION_UID, MOCK_FOUNDATION_SLUG, 'Test Foundation');

    await goto(page, '/foundation/groups');
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await expect(page).toHaveURL(new RegExp(`/foundation/groups\\?project=${MOCK_FOUNDATION_SLUG}$`), { timeout: ELEMENT_TIMEOUT });
  });

  test('entity detail route with a route param is not backfilled, even with a different cookie foundation', async ({ page }) => {
    await setFoundationCookie(page, OTHER_FOUNDATION_UID, OTHER_FOUNDATION_SLUG, 'Other Foundation');
    await stubCommitteeDetail(page, MOCK_COMMITTEE_UID);

    await goto(page, `/foundation/groups/${MOCK_COMMITTEE_UID}`);
    await expect(page.getByTestId('committee-view-name')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Give the NavigationEnd-driven backfill a tick to (not) fire before asserting it stayed absent.
    await page.waitForTimeout(500);
    const parsed = new URL(page.url());
    expect(parsed.searchParams.has('project')).toBe(false);
  });
});
