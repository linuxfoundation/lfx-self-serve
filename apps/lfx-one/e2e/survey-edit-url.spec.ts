// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Survey edit-URL canonicalization — GH-1569.
 *
 * Coverage:
 *   - The surveys table's per-row edit button derives its destination from the SURVEY's owning
 *     tier (`is_foundation`) and project slug, not the viewer's transient active lens — the
 *     pre-fix bug sent flat `/surveys/:uid/edit` links through `lensRedirectGuard`, which
 *     prefixed them with whatever lens the viewer happened to be in:
 *       foundation-owned survey → `/foundation/surveys/:uid/edit?project=<slug>`
 *       project-owned survey    → `/project/surveys/:uid/edit?project=<slug>`
 *       unenriched payload      → flat `/surveys/:uid/edit`, which `lensRedirectGuard`
 *                                 prefixes by the active lens (documented fallback)
 *   - The enriched cases seed the OPPOSITE lens/context from the survey's owning tier, so a pass
 *     proves the URL follows the entity, not the viewer; the fallback case seeds the MATCHING
 *     lens, since the lens-driven prefix is exactly the behavior under test there.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY, SELECTED_FOUNDATION_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-00000000d001';
const OTHER_FOUNDATION_SLUG = 'other-foundation';
const OTHER_FOUNDATION_UID = 'f0000000-0000-0000-0000-00000000d002';
const OTHER_PROJECT_SLUG = 'other-project';
const OTHER_PROJECT_UID = 'p0000000-0000-0000-0000-00000000d003';
const MOCK_SURVEY_UID = 's1000000-0000-0000-0000-00000000d001';
const MOCK_COMMITTEE_UID = 'c0000000-0000-0000-0000-00000000d001';

function buildProjectStub(uid: string, slug: string, name: string) {
  return {
    uid,
    slug,
    name,
    description: `${name} for survey edit-url specs`,
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

/**
 * Surveys-table row / edit-page detail payload, shaped as the BFF emits it post-GH-1569: project
 * identity lives in committees[0] (as upstream sends it), `project_uid` top-level is the BFF's
 * flattened stamp, and `project_slug`/`project_name`/`is_foundation` appear only when the BFF
 * enrichment succeeded. Omitting `projectSlug`/`isFoundation` mirrors an enrichment failure,
 * where the row must fall back to the flat path.
 */
function buildSurveyStub(owner: { projectUid: string; projectSlug?: string; projectName?: string; isFoundation?: boolean }) {
  return {
    uid: MOCK_SURVEY_UID,
    survey_title: 'Canonical Url Satisfaction Survey',
    survey_status: 'draft',
    project_uid: owner.projectUid,
    ...(owner.projectSlug !== undefined ? { project_slug: owner.projectSlug } : {}),
    ...(owner.projectName !== undefined ? { project_name: owner.projectName } : {}),
    ...(owner.isFoundation !== undefined ? { is_foundation: owner.isFoundation } : {}),
    committees: [
      {
        committee_uid: MOCK_COMMITTEE_UID,
        committee_name: 'Test Committee',
        project_uid: owner.projectUid,
        project_name: owner.projectName ?? '',
        total_recipients: 0,
        total_responses: 0,
      },
    ],
    committee_category: '',
    is_nps_survey: false,
    is_project_survey: false,
    total_responses: 0,
    total_recipients: 0,
    survey_cutoff_date: '2027-01-01T00:00:00Z',
    created_at: '2025-01-15T00:00:00Z',
    last_modified_at: '2025-06-01T00:00:00Z',
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
  await page.route(`**/api/projects/${OTHER_PROJECT_SLUG}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildProjectStub(OTHER_PROJECT_UID, OTHER_PROJECT_SLUG, 'Other Project')),
    })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sfid: null }) }));
}

async function stubCommittees(page: Page): Promise<void> {
  await page.route('**/api/committees/my-committee-uids*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  );
  await page.route('**/api/committees*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/api/committees') {
      return route.fallback();
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

/**
 * Stubs the navigation lens-items feed so NavigationService.applyDefaultSelection can't
 * override the stubbed context with the test account's real projects mid-test. Items cover
 * every cookie-seeded context these specs use so the "preserve existing selection" guard
 * keeps it instead of picking a default.
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

/**
 * Stubs the surveys list (one row, params ignored) and the edit-page detail fetch. The
 * catch-all is registered FIRST (Playwright matches in reverse registration order); `*` does
 * not cross `/`, so the detail route needs its own pattern.
 */
async function stubSurveys(page: Page, survey: ReturnType<typeof buildSurveyStub>): Promise<void> {
  await page.route('**/api/surveys*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET' || pathname !== '/api/surveys') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([survey]) });
  });
  await page.route(`**/api/surveys/${MOCK_SURVEY_UID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(survey) });
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

// Gated on env vars rather than on URL sniffing so genuine auth-flow regressions (expired
// storageState, broken Auth0 login helper) still fail loudly when creds ARE configured.
const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

/**
 * Client-side (SPA) navigation for routes whose data is fully stubbed via page.route — a full
 * `page.goto()` of an entity URL SSRs the route on the Express server, where server-side
 * fetches bypass `page.route` stubs and hit the real BFF. Booting on `/` first and navigating
 * via pushState + popstate keeps the router client-side, where every fetch is intercepted.
 */
async function gotoSpa(page: Page, path: string, seedContext: { uid: string; slug: string; name: string; foundation: boolean }): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  // Wait for the app shell so the router is ready to process the synthetic popstate.
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  // The '/' boot SSRs with the real backend persona data and can Set-Cookie a real selection
  // (e.g. the test account's ASWF), racing the stubbed context these specs assert on. Re-assert
  // the intended cookie post-boot so the client-side navigation starts from a clean slate.
  if (seedContext.foundation) {
    await setFoundationCookie(page, seedContext.uid, seedContext.slug, seedContext.name);
  } else {
    await setProjectCookie(page, seedContext.uid, seedContext.slug, seedContext.name);
  }
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test.describe('Survey edit URL derives from the survey’s owning tier (GH-1569)', () => {
  test.beforeEach(async ({ page }) => {
    await stubPersona(page, ['executive-director']);
    await stubProjectApi(page);
    await stubCommittees(page);
    await stubLensItems(page);
  });

  test('foundation-owned survey: edit click-through lands on /foundation/... with ?project= (viewer in project lens)', async ({ page }) => {
    // Seed the OPPOSITE lens from the survey's tier: the pre-fix bug prefixed the flat edit
    // link with this transient project lens, landing on the wrong tier.
    await setPersonaAndLensCookies(page, ['executive-director'], 'project');
    await stubSurveys(
      page,
      buildSurveyStub({ projectUid: MOCK_FOUNDATION_UID, projectSlug: MOCK_FOUNDATION_SLUG, projectName: 'Test Foundation', isFoundation: true })
    );

    await gotoSpa(page, '/surveys', {
      uid: OTHER_PROJECT_UID,
      slug: OTHER_PROJECT_SLUG,
      name: 'Other Project',
      foundation: false,
    });
    await expect(page.getByTestId(`surveys-edit-${MOCK_SURVEY_UID}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId(`surveys-edit-${MOCK_SURVEY_UID}`).click();

    await expect(page).toHaveURL(
      new RegExp(`/foundation/surveys/${MOCK_SURVEY_UID}/edit\\?project=${MOCK_FOUNDATION_SLUG}&committee_uid=${MOCK_COMMITTEE_UID}$`),
      {
        timeout: PAGE_LOAD_TIMEOUT,
      }
    );
    await expect(page.getByTestId('survey-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test('project-owned survey: edit click-through lands on /project/... with ?project= (viewer in foundation lens)', async ({ page }) => {
    await setPersonaAndLensCookies(page, ['executive-director'], 'foundation');
    await stubSurveys(
      page,
      buildSurveyStub({ projectUid: OTHER_PROJECT_UID, projectSlug: OTHER_PROJECT_SLUG, projectName: 'Other Project', isFoundation: false })
    );

    await gotoSpa(page, '/surveys', {
      uid: MOCK_FOUNDATION_UID,
      slug: MOCK_FOUNDATION_SLUG,
      name: 'Test Foundation',
      foundation: true,
    });
    await expect(page.getByTestId(`surveys-edit-${MOCK_SURVEY_UID}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId(`surveys-edit-${MOCK_SURVEY_UID}`).click();

    await expect(page).toHaveURL(new RegExp(`/project/surveys/${MOCK_SURVEY_UID}/edit\\?project=${OTHER_PROJECT_SLUG}&committee_uid=${MOCK_COMMITTEE_UID}$`), {
      timeout: PAGE_LOAD_TIMEOUT,
    });
    await expect(page.getByTestId('survey-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });

  test('unenriched survey: edit click-through falls back to the flat path, redirected by the active lens', async ({ page }) => {
    await setPersonaAndLensCookies(page, ['executive-director'], 'project');
    await stubSurveys(page, buildSurveyStub({ projectUid: OTHER_PROJECT_UID }));
    // The manage page's uid-fallback resolves the project by uid when the payload carries no
    // usable slug — stub the uid-keyed project route so context sync completes post-navigation.
    await page.route(`**/api/projects/${OTHER_PROJECT_UID}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(buildProjectStub(OTHER_PROJECT_UID, OTHER_PROJECT_SLUG, 'Other Project')),
      })
    );

    await gotoSpa(page, '/surveys', {
      uid: OTHER_PROJECT_UID,
      slug: OTHER_PROJECT_SLUG,
      name: 'Other Project',
      foundation: false,
    });
    await expect(page.getByTestId(`surveys-edit-${MOCK_SURVEY_UID}`)).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId(`surveys-edit-${MOCK_SURVEY_UID}`).click();

    // The button navigates flat (with only the row's committee scope); lensRedirectGuard prefixes
    // by the ACTIVE lens (project here). The flat hop itself is an atomic guard redirect — only
    // the settled URL is observable.
    await expect(page).toHaveURL(new RegExp(`/project/surveys/${MOCK_SURVEY_UID}/edit\\?committee_uid=${MOCK_COMMITTEE_UID}$`), { timeout: PAGE_LOAD_TIMEOUT });
    expect(new URL(page.url()).searchParams.has('project')).toBe(false);
    await expect(page.getByTestId('survey-manage-title')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });
});
