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
 *   - A context-less meeting EDIT link (`/project/meetings/:id/edit` with no
 *     `?project=`) resolves context from the loaded meeting — via the BFF-enriched project
 *     fields, or via the component's resolve-by-uid fallback when enrichment failed — instead
 *     of the stale cookie-restored context.
 *   - The same for a context-less mailing-list EDIT link (`/project/mailing-lists/:uid/edit`,
 *     GH-1567): context syncs from the loaded list (enriched payload or uid fallback), and
 *     writerGuard authorizes against the list's own project via its entity probe.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { Committee, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY, SELECTED_FOUNDATION_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-00000000d001';
const OTHER_FOUNDATION_SLUG = 'other-foundation';
const OTHER_FOUNDATION_UID = 'f0000000-0000-0000-0000-00000000d002';
const MOCK_COMMITTEE_UID = 'c0000000-0000-0000-0000-00000000d001';
const OTHER_PROJECT_SLUG = 'other-project';
const OTHER_PROJECT_UID = 'p0000000-0000-0000-0000-00000000d003';
const MOCK_MEETING_UID = 'm0000000-0000-0000-0000-00000000d001';
const MOCK_MAILING_LIST_UID = 'l1000000-0000-0000-0000-00000000d001';

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

/**
 * Stubs the navigation lens-items feed. Without this the app loads the TEST ACCOUNT'S REAL
 * foundations/projects from the dev backend, and NavigationService.applyDefaultSelection
 * overrides the stubbed context with a real one mid-test (observed: sidebar links flipped to
 * `?project=aswf`). Items intentionally include every cookie-seeded context used by these specs
 * so the "preserve an existing selection" guard keeps it instead of picking a default.
 */
async function stubLensItems(page: Page): Promise<void> {
  await page.route('**/api/nav/lens-items*', (route) => {
    const url = new URL(route.request().url());
    const isFoundation = url.searchParams.get('lens') !== 'project';
    const items = isFoundation
      ? [
          { uid: MOCK_FOUNDATION_UID, slug: MOCK_FOUNDATION_SLUG, name: 'Test Foundation', logoUrl: null, isFoundation: true },
          { uid: OTHER_FOUNDATION_UID, slug: OTHER_FOUNDATION_SLUG, name: 'Other Foundation', logoUrl: null, isFoundation: true },
        ]
      : [{ uid: OTHER_PROJECT_UID, slug: OTHER_PROJECT_SLUG, name: 'Other Project', logoUrl: null, isFoundation: false }];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, next_page_token: null, upstream_failed: false, lens: isFoundation ? 'foundation' : 'project' }),
    });
  });
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

async function setProjectCookie(page: Page, uid: string, slug: string, name: string): Promise<void> {
  await page.context().addCookies([
    {
      name: SELECTED_PROJECT_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ uid, slug, name })),
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Meeting detail payload for the edit page. `enriched: false` simulates the BFF project
 * enrichment having failed (project_slug/project_name/is_foundation absent from the detail
 * payload) so the component's resolve-by-uid fallback is exercised instead.
 */
function buildMeetingStub(enriched: boolean) {
  return {
    id: MOCK_MEETING_UID,
    title: 'Test Foundation Board Sync',
    description: 'Meeting stub for project-context deep-link specs',
    project_uid: MOCK_FOUNDATION_UID,
    ...(enriched ? { project_slug: MOCK_FOUNDATION_SLUG, project_name: 'Test Foundation', is_foundation: true } : {}),
    meeting_type: 'Board',
    visibility: 'public',
    restricted: false,
    start_time: '2026-06-01T18:00:00Z',
    duration: 60,
    timezone: 'UTC',
    early_join_time_minutes: 10,
    committees: [],
    occurrences: [],
    recording_enabled: false,
    transcript_enabled: false,
    youtube_upload_enabled: false,
    auto_email_reminder_enabled: false,
    show_meeting_attendees: false,
    registrant_count: 0,
    writer: true,
    organizer: true,
  };
}

async function stubMeetingEditDetail(page: Page, meeting: ReturnType<typeof buildMeetingStub>): Promise<void> {
  // Catch-all registered FIRST (Playwright matches routes in reverse registration order) so
  // incidental list/count calls from the edit page don't escape to the real BFF.
  await page.route('**/api/meetings*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route(`**/api/meetings/${MOCK_MEETING_UID}/attachments`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/meetings/${MOCK_MEETING_UID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meeting) });
  });
}

/**
 * Edit-page detail payload; `enriched: false` mirrors the v1-sync gap (empty slug/name, no
 * is_foundation) so the component's resolve-by-uid fallback runs (GH-1567).
 */
function buildMailingListStub(enriched: boolean) {
  return {
    uid: MOCK_MAILING_LIST_UID,
    title: 'Test Foundation Announcements',
    group_name: 'announce',
    description: 'Mailing list stub for project-context deep-link specs',
    project_uid: MOCK_FOUNDATION_UID,
    project_slug: enriched ? MOCK_FOUNDATION_SLUG : '',
    project_name: enriched ? 'Test Foundation' : '',
    ...(enriched ? { is_foundation: true } : {}),
    source: 'api',
    type: 'discussion_open',
    audience_access: 'public',
    service_uid: 'svc-1',
    public: true,
    committees: [],
    subscriber_count: 12,
    writer: true,
    created_at: '2025-01-15T00:00:00Z',
    updated_at: '2025-06-01T00:00:00Z',
  };
}

async function stubMailingListEditDetail(page: Page, list: ReturnType<typeof buildMailingListStub>): Promise<void> {
  // Catch-all registered FIRST (Playwright matches in reverse registration order); `*` doesn't
  // cross `/`, so the services and detail routes need their own patterns.
  await page.route('**/api/mailing-lists*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await page.route('**/api/mailing-lists/services*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/mailing-lists/${MOCK_MAILING_LIST_UID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
  });
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
 * Client-side (SPA) navigation for routes whose data is fully stubbed via page.route.
 *
 * A full `page.goto()` of an entity URL SSRs the route on the Express server — server-side
 * data fetches bypass `page.route` stubs and hit the real BFF, where the stubbed entity does
 * not exist, so the component's error path (e.g. meeting-manage's navigateBack) redirects away
 * before the client ever boots. Booting on `/` first and then navigating via
 * pushState + popstate keeps the router client-side, where every fetch is intercepted.
 *
 * Also note Playwright glob semantics: `*` does not cross `/`, so `**\/api/meetings*` matches
 * `/api/meetings?tags=...` but NOT `/api/meetings/<uid>` — detail routes need an exact pattern
 * (`**\/api/meetings/<uid>`) or a predicate.
 */
async function gotoSpa(page: Page, path: string, seedContext?: { uid: string; slug: string; name: string; foundation: boolean }): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  // Wait for the app shell so the router is ready to process the synthetic popstate.
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  if (seedContext) {
    // The '/' boot SSRs with the real backend persona data and can Set-Cookie a real selection
    // (e.g. the test account's ASWF), racing the stubbed context these specs assert on. Re-assert
    // the intended cookie post-boot so the client-side navigation starts from a clean slate.
    if (seedContext.foundation) {
      await setFoundationCookie(page, seedContext.uid, seedContext.slug, seedContext.name);
    } else {
      await setProjectCookie(page, seedContext.uid, seedContext.slug, seedContext.name);
    }
  }
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test.describe('Foundation/project context deep-linking (LFXV2-2837)', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaAndLensCookies(page, ['executive-director'], 'foundation');
    await stubPersona(page, ['executive-director']);
    await stubProjectApi(page);
    await stubCommittees(page, buildCommittees());
  });

  test('sidebar nav links carry ?project= while on a foundation-lens page', async ({ page }) => {
    await stubLensItems(page);
    await gotoSpa(page, `/foundation/groups?project=${MOCK_FOUNDATION_SLUG}`, {
      uid: MOCK_FOUNDATION_UID,
      slug: MOCK_FOUNDATION_SLUG,
      name: 'Test Foundation',
      foundation: true,
    });
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    const meetingsLink = page.getByTestId('sidebar-item-meetings');
    const mailingListsLink = page.getByTestId('sidebar-item-mailing-lists');
    const groupsLink = page.getByTestId('sidebar-item-groups');

    await expect(meetingsLink).toHaveAttribute('href', new RegExp(`/foundation/meetings\\?project=${MOCK_FOUNDATION_SLUG}$`));
    await expect(mailingListsLink).toHaveAttribute('href', new RegExp(`/foundation/mailing-lists\\?project=${MOCK_FOUNDATION_SLUG}$`));
    await expect(groupsLink).toHaveAttribute('href', new RegExp(`/foundation/groups\\?project=${MOCK_FOUNDATION_SLUG}$`));
  });

  test('tab switch preserves ?project= across an in-app navigation', async ({ page }) => {
    await stubLensItems(page);
    await page.route('**/api/meetings*', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });

    await gotoSpa(page, `/foundation/groups?project=${MOCK_FOUNDATION_SLUG}`, {
      uid: MOCK_FOUNDATION_UID,
      slug: MOCK_FOUNDATION_SLUG,
      name: 'Test Foundation',
      foundation: true,
    });
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId('sidebar-item-meetings').click();

    await expect(page).toHaveURL(new RegExp(`/foundation/meetings\\?project=${MOCK_FOUNDATION_SLUG}$`), { timeout: ELEMENT_TIMEOUT });
  });

  test('fresh load with cookie-restored context backfills ?project= with no extra navigation', async ({ page }) => {
    await setFoundationCookie(page, MOCK_FOUNDATION_UID, MOCK_FOUNDATION_SLUG, 'Test Foundation');

    await gotoSpa(page, '/foundation/groups', { uid: MOCK_FOUNDATION_UID, slug: MOCK_FOUNDATION_SLUG, name: 'Test Foundation', foundation: true });
    await expect(page.getByTestId(`committee-row-${MOCK_COMMITTEE_UID}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await expect(page).toHaveURL(new RegExp(`/foundation/groups\\?project=${MOCK_FOUNDATION_SLUG}$`), { timeout: ELEMENT_TIMEOUT });
  });

  test('entity detail route with a route param is not backfilled, even with a different cookie foundation', async ({ page }) => {
    await setFoundationCookie(page, OTHER_FOUNDATION_UID, OTHER_FOUNDATION_SLUG, 'Other Foundation');
    await stubCommitteeDetail(page, MOCK_COMMITTEE_UID);

    await gotoSpa(page, `/foundation/groups/${MOCK_COMMITTEE_UID}`, {
      uid: OTHER_FOUNDATION_UID,
      slug: OTHER_FOUNDATION_SLUG,
      name: 'Other Foundation',
      foundation: true,
    });
    await expect(page.getByTestId('committee-view-name')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Give the NavigationEnd-driven backfill a tick to (not) fire before asserting it stayed absent.
    await page.waitForTimeout(500);
    const parsed = new URL(page.url());
    expect(parsed.searchParams.has('project')).toBe(false);
  });
});

test.describe('Meeting edit deep-link resolves the meeting’s project context (gh-1432)', () => {
  test.beforeEach(async ({ page }) => {
    // Mirror the issue: the user was last working in an unrelated PROJECT (cookie-restored),
    // then opens a context-less edit link for a meeting owned by Test Foundation.
    await setPersonaAndLensCookies(page, ['executive-director'], 'project');
    await setProjectCookie(page, OTHER_PROJECT_UID, OTHER_PROJECT_SLUG, 'Other Project');
    await stubPersona(page, ['executive-director']);
    await stubProjectApi(page);
    await stubCommittees(page, buildCommittees());
    await stubLensItems(page);
    await page.route(`**/api/projects/${OTHER_PROJECT_SLUG}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildProjectStub(OTHER_PROJECT_UID, OTHER_PROJECT_SLUG, 'Other Project')),
      })
    );
  });

  test('edit link without ?project= switches context to the meeting’s foundation (BFF-enriched payload)', async ({ page }) => {
    await stubMeetingEditDetail(page, buildMeetingStub(true));

    await gotoSpa(page, `/project/meetings/${MOCK_MEETING_UID}/edit`, {
      uid: OTHER_PROJECT_UID,
      slug: OTHER_PROJECT_SLUG,
      name: 'Other Project',
      foundation: false,
    });
    await expect(page.getByTestId('meeting-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // The sync derives context from the loaded meeting (Test Foundation), replacing the
    // cookie-restored Other Project — the selector and sidebar links follow the correction.
    await expect(page.getByTestId('project-selector')).toContainText('Test Foundation', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('sidebar-item-meetings')).toHaveAttribute('href', /[?&]project=test-foundation/, { timeout: ELEMENT_TIMEOUT });

    // The context correction must NOT inject ?project= into the entity URL (syncUrl guard) —
    // give any NavigationEnd-driven backfill a tick to (not) fire before asserting absence.
    await page.waitForTimeout(500);
    expect(new URL(page.url()).searchParams.has('project')).toBe(false);
  });

  test('writerGuard authorizes the edit page against the meeting’s project, not the stale context (Bug 2)', async ({ page }) => {
    // Non-ED persona: no synchronous fast path — the guard must probe the meeting for its
    // project slug. The stale cookie context (Other Project) is intentionally NOT writable:
    // if the guard authorizes against it, the page redirects to /project/overview?_notice=...
    await setPersonaAndLensCookies(page, ['maintainer'], 'project');
    await stubPersona(page, ['maintainer']);
    await page.route(`**/api/projects/${OTHER_PROJECT_SLUG}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...buildProjectStub(OTHER_PROJECT_UID, OTHER_PROJECT_SLUG, 'Other Project'), writer: false }),
      })
    );
    await stubMeetingEditDetail(page, buildMeetingStub(true));

    await gotoSpa(page, `/project/meetings/${MOCK_MEETING_UID}/edit`, {
      uid: OTHER_PROJECT_UID,
      slug: OTHER_PROJECT_SLUG,
      name: 'Other Project',
      foundation: false,
    });
    await expect(page.getByTestId('meeting-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Still on the edit page (no access-denied redirect), and the context follows the meeting.
    expect(page.url()).toContain(`/project/meetings/${MOCK_MEETING_UID}/edit`);
    await expect(page.getByTestId('project-selector')).toContainText('Test Foundation', { timeout: ELEMENT_TIMEOUT });
  });

  test('edit link without ?project= falls back to resolving the project by uid when enrichment is absent', async ({ page }) => {
    // Enrichment-failed payload: project_uid only. The component fallback fetches the project
    // by uid — this route satisfies computeIsFoundation (Funded + Membership + Active), so the
    // resolved context lands in the foundation slot just like the enriched path.
    await stubMeetingEditDetail(page, buildMeetingStub(false));
    await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...buildProjectStub(MOCK_FOUNDATION_UID, MOCK_FOUNDATION_SLUG, 'Test Foundation'),
          funding: 'Funded',
          funding_model: ['Membership'],
          legal_entity_type: 'Series LLC',
        }),
      })
    );

    await gotoSpa(page, `/project/meetings/${MOCK_MEETING_UID}/edit`, {
      uid: OTHER_PROJECT_UID,
      slug: OTHER_PROJECT_SLUG,
      name: 'Other Project',
      foundation: false,
    });
    await expect(page.getByTestId('meeting-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('project-selector')).toContainText('Test Foundation', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('sidebar-item-meetings')).toHaveAttribute('href', /[?&]project=test-foundation/, { timeout: ELEMENT_TIMEOUT });

    await page.waitForTimeout(500);
    expect(new URL(page.url()).searchParams.has('project')).toBe(false);
  });
});

test.describe('Mailing list edit deep-link resolves the list’s project context (GH-1567)', () => {
  test.beforeEach(async ({ page }) => {
    // Mirror the issue: the user was last working in an unrelated PROJECT (cookie-restored),
    // then opens a context-less edit link for a mailing list owned by Test Foundation.
    await setPersonaAndLensCookies(page, ['executive-director'], 'project');
    await setProjectCookie(page, OTHER_PROJECT_UID, OTHER_PROJECT_SLUG, 'Other Project');
    await stubPersona(page, ['executive-director']);
    await stubProjectApi(page);
    await stubCommittees(page, buildCommittees());
    await stubLensItems(page);
    await page.route(`**/api/projects/${OTHER_PROJECT_SLUG}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildProjectStub(OTHER_PROJECT_UID, OTHER_PROJECT_SLUG, 'Other Project')),
      })
    );
  });

  test('edit link without ?project= switches context to the list’s foundation (BFF-enriched payload)', async ({ page }) => {
    await stubMailingListEditDetail(page, buildMailingListStub(true));

    await gotoSpa(page, `/project/mailing-lists/${MOCK_MAILING_LIST_UID}/edit`, {
      uid: OTHER_PROJECT_UID,
      slug: OTHER_PROJECT_SLUG,
      name: 'Other Project',
      foundation: false,
    });
    await expect(page.getByTestId('mailing-list-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // The sync derives context from the loaded list (Test Foundation), replacing the
    // cookie-restored Other Project — the selector and sidebar links follow the correction.
    await expect(page.getByTestId('project-selector')).toContainText('Test Foundation', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('sidebar-item-mailing-lists')).toHaveAttribute('href', /[?&]project=test-foundation/, {
      timeout: ELEMENT_TIMEOUT,
    });

    // The route itself canonicalizes to the list's foundation tier once the payload lands (GH-1567).
    await expect(page).toHaveURL(new RegExp(`/foundation/mailing-lists/${MOCK_MAILING_LIST_UID}/edit`), { timeout: ELEMENT_TIMEOUT });

    // The context correction must NOT inject ?project= into the entity URL (syncUrl guard) —
    // give any NavigationEnd-driven backfill a tick to (not) fire before asserting absence.
    await page.waitForTimeout(500);
    expect(new URL(page.url()).searchParams.has('project')).toBe(false);
  });

  test('writerGuard authorizes the edit page against the list’s project, not the stale context (GH-1567)', async ({ page }) => {
    // Non-ED persona: the guard must probe the list for its project slug; the stale cookie
    // context (Other Project) is intentionally NOT writable — it would redirect to /project/overview.
    await setPersonaAndLensCookies(page, ['maintainer'], 'project');
    await stubPersona(page, ['maintainer']);
    await page.route(`**/api/projects/${OTHER_PROJECT_SLUG}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...buildProjectStub(OTHER_PROJECT_UID, OTHER_PROJECT_SLUG, 'Other Project'), writer: false }),
      })
    );
    await stubMailingListEditDetail(page, buildMailingListStub(true));

    await gotoSpa(page, `/project/mailing-lists/${MOCK_MAILING_LIST_UID}/edit`, {
      uid: OTHER_PROJECT_UID,
      slug: OTHER_PROJECT_SLUG,
      name: 'Other Project',
      foundation: false,
    });
    await expect(page.getByTestId('mailing-list-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Still on the edit page (no access-denied redirect): the URL canonicalizes to the owning
    // foundation tier once the list loads, and the context follows the list.
    await expect(page).toHaveURL(new RegExp(`/foundation/mailing-lists/${MOCK_MAILING_LIST_UID}/edit`), { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('project-selector')).toContainText('Test Foundation', { timeout: ELEMENT_TIMEOUT });
  });

  test('edit link without ?project= falls back to resolving the project by uid when enrichment is absent', async ({ page }) => {
    // Enrichment-failed payload (project_uid only, v1-sync empty-string slug): the fallback
    // fetches the project by uid — this stub satisfies computeIsFoundation, landing the foundation slot.
    await stubMailingListEditDetail(page, buildMailingListStub(false));
    await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...buildProjectStub(MOCK_FOUNDATION_UID, MOCK_FOUNDATION_SLUG, 'Test Foundation'),
          funding: 'Funded',
          funding_model: ['Membership'],
          legal_entity_type: 'Series LLC',
        }),
      })
    );

    await gotoSpa(page, `/project/mailing-lists/${MOCK_MAILING_LIST_UID}/edit`, {
      uid: OTHER_PROJECT_UID,
      slug: OTHER_PROJECT_SLUG,
      name: 'Other Project',
      foundation: false,
    });
    await expect(page.getByTestId('mailing-list-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await expect(page.getByTestId('project-selector')).toContainText('Test Foundation', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('sidebar-item-mailing-lists')).toHaveAttribute('href', /[?&]project=test-foundation/, {
      timeout: ELEMENT_TIMEOUT,
    });

    // The uid fallback canonicalizes the route to the list's foundation tier too (GH-1567).
    await expect(page).toHaveURL(new RegExp(`/foundation/mailing-lists/${MOCK_MAILING_LIST_UID}/edit`), { timeout: ELEMENT_TIMEOUT });

    await page.waitForTimeout(500);
    expect(new URL(page.url()).searchParams.has('project')).toBe(false);
  });

  test('view deep link under the wrong tier canonicalizes to the list’s foundation (GH-1567)', async ({ page }) => {
    await stubMailingListEditDetail(page, buildMailingListStub(true));
    // The view page's members child fetches /members — keep it from escaping to the real BFF.
    await page.route(`**/api/mailing-lists/${MOCK_MAILING_LIST_UID}/members*`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    await gotoSpa(page, `/project/mailing-lists/${MOCK_MAILING_LIST_UID}`, {
      uid: OTHER_PROJECT_UID,
      slug: OTHER_PROJECT_SLUG,
      name: 'Other Project',
      foundation: false,
    });
    await expect(page.getByTestId('mailing-list-view-title')).toHaveText('Test Foundation Announcements', { timeout: PAGE_LOAD_TIMEOUT });

    // Context syncs from the loaded list and the route rewrites to its owning tier (GH-1567).
    await expect(page).toHaveURL(new RegExp(`/foundation/mailing-lists/${MOCK_MAILING_LIST_UID}$`), { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('project-selector')).toContainText('Test Foundation', { timeout: ELEMENT_TIMEOUT });
  });
});
