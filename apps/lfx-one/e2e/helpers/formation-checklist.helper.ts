// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Shared fixtures/mocks for the Formation Checklist section and Formations queue specs (GH-1958, LFXV2-3386). */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, FORMATION_ENABLED_FLAG, PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import type { LensItem, PersistedPersonaState, PersonaType, Project } from '@lfx-one/shared/interfaces';
import { Page, test } from '@playwright/test';

import { MOCK_FORMATION_ANNOUNCEMENT_DATE } from '../fixtures/mock-data';
import { FormationApiMockHelper } from './formation-api-mock.helper';

export const DATA_LOAD_TIMEOUT = 30_000;
export const FORMATION_PROJECT_SLUG = 'cascade-data-alliance';
export const FOUNDATION_SLUG = 'test-foundation';

const MOCK_FOUNDATION_ITEM: LensItem = {
  uid: 'f0000000-0000-0000-0000-000000000099',
  slug: FOUNDATION_SLUG,
  name: 'Test Foundation',
  logoUrl: null,
  isFoundation: true,
};

/** Mirrors marketing-access.spec.ts's `stubPersona` — `isAuditor` is the field `formationsQueueAuditorGuard` reads. */
export async function stubPersona(page: Page, isAuditor: boolean): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [],
        isRootWriter: false,
        isLFStaff: false,
        isAuditor,
      }),
    })
  );
}

/** See persona-navigation.spec.ts's identically-named helper for the full rationale (SSR guard cookie seeding). */
export async function setPersonaCookie(page: Page): Promise<void> {
  const state: PersistedPersonaState = { primary: 'contributor' as PersonaType, all: ['contributor'] as PersonaType[] };
  await page
    .context()
    .addCookies([{ name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(state)), domain: 'localhost', path: '/', sameSite: 'Lax' }]);
}

/** One mocked foundation in the foundation lens — enough for the sidebar to resolve on `/foundation/*` pages. */
export async function stubNavLensItems(page: Page): Promise<void> {
  await page.route('**/api/nav/lens-items*', (route) => {
    const requestedLens = new URL(route.request().url()).searchParams.get('lens') ?? 'foundation';
    const items = requestedLens === 'foundation' ? [MOCK_FOUNDATION_ITEM] : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, next_page_token: null, upstream_failed: false, lens: requestedLens }),
    });
  });
}

/**
 * `projectQueryParamGuard` resolves the `?project=<foundation>` slug via `GET /api/projects/:slug`
 * on every hard load of a `foundation/*` route carrying the param — without this stub the fake
 * foundation slug 404s against the real backend and the guard bounces to not-found before the page
 * ever renders (LFXV2-3386).
 */
export async function stubFoundationProject(page: Page): Promise<void> {
  await page.route(`**/api/projects/${FOUNDATION_SLUG}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildBaseProject(FOUNDATION_SLUG, { name: 'Test Foundation', stage: 'Active' })),
    });
  });
}

export async function gotoFormationsQueue(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto('/foundation/formations', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

/** Navigates straight to the queue's per-formation drill-down (LFXV2-3386) with `?project=` naming the foundation. */
export async function gotoFormationDetail(page: Page, slug: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/foundation/formations/${slug}?project=${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

export function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — let the test run and surface a useful failure.
  }
}

/** Pins `formation-enabled` on/off for this page, before the app's own flag-provider bootstrap runs — see `FEATURE_FLAG_OVERRIDE_STORAGE_KEY`. */
export async function stubFormationFlag(page: Page, enabled = true): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [FORMATION_ENABLED_FLAG]: enabled }),
  ] as const);
}

export function buildBaseProject(slug: string, overrides: Partial<Project> = {}): Project {
  return {
    uid: `e2e-${slug}-uid`,
    slug,
    name: 'Cascade Data Alliance',
    description: 'A working-group used to exercise the Formation checklist in e2e tests.',
    public: true,
    parent_uid: '',
    stage: 'Formation - Engaged',
    category: 'foundation',
    funding_model: ['member-funded'],
    charter_url: '',
    legal_entity_type: '',
    legal_entity_name: '',
    legal_parent_uid: '',
    autojoin_enabled: false,
    formation_date: '',
    logo_url: '',
    repository_url: '',
    website_url: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    mailing_list_count: 0,
    writer: false,
    ...overrides,
  };
}

export type FormationChecklistApiState = 'ready' | 'no-template' | 'no-items' | 'error';

/**
 * The date both mocked reads serve. Since #2719 the sidebar formation card takes it from the
 * checklist response (`MOCK_FORMATION_ANNOUNCEMENT_DATE`), not from the project-settings read
 * below — the two are kept equal so the "Oct 25, 2026" assertion can't pass off the old source.
 */
export const FORMATION_ANNOUNCEMENT_DATE = MOCK_FORMATION_ANNOUNCEMENT_DATE;

export async function mockFormationChecklistApis(page: Page, opts: { project: Project; checklistState?: FormationChecklistApiState }): Promise<void> {
  await page.route(`**/api/projects/${opts.project.slug}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.project) });
  });

  const state = opts.checklistState ?? 'ready';
  if (state === 'error') {
    await page.route('**/api/projects/*/formation', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
  } else if (state === 'no-template' || state === 'no-items') {
    await page.route('**/api/projects/*/formation', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          formation: {
            uid: `formation:${opts.project.slug}`,
            parent_project_uid: opts.project.uid,
            parent_project_slug: opts.project.slug,
            parent_project_name: opts.project.name,
            is_foundation: true,
            parent_uid: null,
            template_uid: 'seed',
            template_version: 1,
            sub_stage: 'engaged',
            sub_stage_raw: 'Formation - Engaged',
            lifecycle: 'live',
            lifecycle_raw: 'live',
            announcement_date: null,
            is_activating: false,
            gating_items_open: 0,
            gating_items_total: 0,
            blocking_item_title: null,
            subtitle: null,
            created_at: '',
            updated_at: '',
          },
          template: state === 'no-template' ? null : { uid: 'seed', version: 1, name: 'Project formation', sections: [] },
          items: [],
          can_write: true,
          can_set_status: true,
        }),
      })
    );
  } else {
    await FormationApiMockHelper.setupProjectFormationMock(page, opts.project.slug);
  }

  await FormationApiMockHelper.setupFormationItemMock(page);
  await FormationApiMockHelper.setupFormationItemActionMock(page);

  // Sidebar/other project-page widgets this page also renders — stub to empty so they don't block load.
  await page.route('**/api/user/pending-actions*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  // Project settings back the sidebar formation card's announcement date (GH-2702) via
  // `ProjectContextService.activeProjectAnnouncementDate` — unmocked, the fake uid 404s against the
  // real backend and the card falls into its error state instead of rendering the date.
  await page.route('**/api/projects/*/permissions', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        uid: opts.project.uid,
        announcement_date: FORMATION_ANNOUNCEMENT_DATE,
        writers: [],
        auditors: [],
        executive_director: null,
        program_manager: null,
        opportunity_owner: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }),
    });
  });
}

export async function gotoProjectOverview(page: Page, slug: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/project/overview?project=${slug}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

/** Navigates to the formation checklist's own route (GH-1958), guarded by `formationProjectEnabledGuard`. */
export async function gotoProjectFormation(page: Page, slug: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/project/formation?project=${slug}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}
