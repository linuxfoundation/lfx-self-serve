// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Shared fixtures/mocks for the Formation Checklist section and Formations queue specs (GH-1958, LFXV2-3386). */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, FORMATION_ENABLED_FLAG, LENS_COOKIE_KEY, PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import type {
  FormationPeopleResponse,
  LensItem,
  MyFormationSummary,
  MyFormationWorkResponse,
  PendingActionItem,
  PersistedPersonaState,
  PersonaType,
  Project,
} from '@lfx-one/shared/interfaces';
import { Page, test } from '@playwright/test';

import { getMockFormationItems, MOCK_FORMATION_ANNOUNCEMENT_DATE } from '../fixtures/mock-data';
import { FormationApiMockHelper } from './formation-api-mock.helper';

export const DATA_LOAD_TIMEOUT = 30_000;
export const FORMATION_PROJECT_SLUG = 'cascade-data-alliance';
export const FOUNDATION_SLUG = 'test-foundation';

/**
 * The host a seeded cookie must be scoped to — the same precedence `playwright.config.ts` uses for
 * `baseURL`, so an `E2E_BASE_URL` override moves the cookie host along with the page under test
 * (mirrors `campaign-planning.helper.ts`). A hard-coded `localhost` puts the cookie on a host the
 * browser never visits.
 */
function e2eCookieHost(): string {
  return new URL(process.env['E2E_BASE_URL'] ?? `http://${process.env['E2E_HOST'] ?? 'localhost'}:${process.env['E2E_PORT'] ?? '4200'}`).hostname;
}

/**
 * One Me-lens pending-action row for a formation item (#2732), as `GET /api/user/pending-actions`
 * serves it — built from the `contribution_agreement_executed` fixture so a click-through lands on
 * a row the mocked checklist actually has. The `pendingActions` option on
 * `mockFormationChecklistApis` serves it.
 */
export function buildFormationPendingActionRow(): PendingActionItem {
  const item = getMockFormationItems(`formation:${FORMATION_PROJECT_SLUG}`).find(
    (candidate) => candidate.template_item_key === 'contribution_agreement_executed'
  );
  if (!item) throw new Error('Expected the contribution_agreement_executed fixture item.');
  return {
    type: 'FormationItem',
    badge: 'Cascade Data Alliance',
    text: item.title,
    icon: 'fa-light fa-diagram-project',
    severity: 'accent',
    buttonText: 'View item',
    date: item.due_date ?? undefined,
    formationProjectUid: item.project_uid,
    formationProjectSlug: FORMATION_PROJECT_SLUG,
    formationItemKey: item.template_item_key,
    formationItemUid: item.uid,
    formationItemStatus: item.status,
    formationIsGating: item.is_gating,
  };
}

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
    .addCookies([{ name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(state)), domain: e2eCookieHost(), path: '/', sameSite: 'Lax' }]);
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

/** The drill-down with `?item=<template_item_key>` — the deep link the section honours on both hosts (#2732). */
export async function gotoFormationDetailItem(page: Page, slug: string, itemKey: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/foundation/formations/${slug}?project=${FOUNDATION_SLUG}&item=${itemKey}`, { waitUntil: 'domcontentloaded' });
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
 * The date the mocked **project-settings** read serves, deliberately different from the checklist
 * response's `MOCK_FORMATION_ANNOUNCEMENT_DATE`. Since #2719 the sidebar formation card takes its
 * date from the checklist on both checklist hosts, so a card assertion naming the checklist's date
 * fails if the card ever regresses to this read. Equal dates would let such a regression render
 * the same string and stay green — the difference is what makes the date assertion itself
 * source-sensitive, alongside the throwing-`ProjectContextService` unit spec and the drill-down's
 * `not.toContainText(FOUNDATION_SLUG)`.
 *
 * Nothing asserts on this value directly; it exists so the settings route resolves at all (see the
 * route stub below — unmocked, the fake uid 404s and the dashboard-sidebar card errors instead of
 * rendering).
 */
export const FORMATION_SETTINGS_ANNOUNCEMENT_DATE = '2026-03-14';
/** The date the card actually renders on both checklist hosts — sourced from the checklist read. */
export const FORMATION_ANNOUNCEMENT_DATE = MOCK_FORMATION_ANNOUNCEMENT_DATE;
/** `FORMATION_ANNOUNCEMENT_DATE` as `formatAnnouncementDateLabel` renders it on the card. */
export const FORMATION_ANNOUNCEMENT_DATE_LABEL = 'Oct 25, 2026';

export async function mockFormationChecklistApis(
  page: Page,
  opts: {
    project: Project;
    checklistState?: FormationChecklistApiState;
    /** The checklist response's per-caller writer flag; defaults to `true` so editing flows (and the people card's Invite action) render. */
    canWrite?: boolean;
    /** The sidebar people card's read (#2724); defaults to the three-person fixture. */
    people?: FormationPeopleResponse;
    /** What `GET /api/user/pending-actions` serves — empty by default; the Me-dashboard formation-row spec passes a row (#2732). */
    pendingActions?: PendingActionItem[];
  }
): Promise<void> {
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
          can_write: opts.canWrite ?? true,
          can_set_status: true,
        }),
      })
    );
  } else {
    await FormationApiMockHelper.setupProjectFormationMock(page, opts.project.slug, { canWrite: opts.canWrite });
  }

  await FormationApiMockHelper.setupFormationItemMock(page);
  await FormationApiMockHelper.setupFormationItemActionMock(page);

  // Sidebar/other project-page widgets this page also renders — stub to empty so they don't block load
  // (or to the caller's rows, for the Me-dashboard formation-row spec).
  await page.route('**/api/user/pending-actions*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.pendingActions ?? []) })
  );

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
        announcement_date: FORMATION_SETTINGS_ANNOUNCEMENT_DATE,
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

  // The sidebar people card's own read (#2724) — a longer path the `**/api/projects/*/formation`
  // checklist glob above never matches, so it needs its own route.
  await FormationApiMockHelper.setupFormationPeopleMock(page, opts.people);
}

export async function gotoProjectOverview(page: Page, slug: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/project/overview?project=${slug}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

/**
 * Lands on the Me dashboard with the mocked formation row as the only pending action (#2732) —
 * every other Me-lens feed is stubbed empty so the row is deterministic on both dashboard variants
 * (`user-dashboard` and `multi-persona-dashboard` render the same `lfx-pending-actions`). Shared by
 * the content spec and its structural `-robust` twin.
 */
export async function gotoMeDashboardWithFormationRow(page: Page, flagEnabled = true): Promise<void> {
  await page.context().addCookies([{ name: LENS_COOKIE_KEY, value: 'me', domain: e2eCookieHost(), path: '/' }]);
  await stubFormationFlag(page, flagEnabled);
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas: ['contributor'], personaProjects: {}, projects: [], organizations: [], isRootWriter: false }),
    })
  );
  await page.route('**/api/user/meetings*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/user/past-meetings*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/user/formation-work*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ formations: [], items: [], state: 'complete' }) })
  );
  await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG), pendingActions: [buildFormationPendingActionRow()] });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

/**
 * One My Formations row (#2753) as `GET /api/user/formation-work` serves it — synthetic, keyed off
 * the checklist fixture project so a click-through lands on a checklist the mocks can serve.
 */
export function buildMyFormationSummary(overrides: Partial<MyFormationSummary> = {}): MyFormationSummary {
  return {
    formation_uid: `formation-${FORMATION_PROJECT_SLUG}`,
    project_uid: `e2e-${FORMATION_PROJECT_SLUG}-uid`,
    project_slug: FORMATION_PROJECT_SLUG,
    project_name: 'Cascade Data Alliance',
    sub_stage: 'engaged',
    sub_stage_raw: 'Formation - Engaged',
    announcement_date: MOCK_FORMATION_ANNOUNCEMENT_DATE,
    assigned_to_do: 2,
    assigned_done: 1,
    assigned_skipped: 0,
    items_done: 5,
    items_total: 17,
    gating_done: 0,
    gating_total: 0,
    blocking_item_title: 'Contribution agreement executed',
    ...overrides,
  };
}

/**
 * Three rows in deliberately wrong order for the page's need-based sort (#2753): the fixture
 * project (2 to do, blocked), an exploratory one with 1 to do and no announcement date, and one
 * whose upstream `sub_stage` has no queue-taxonomy equivalent (rendered verbatim, only under "All").
 */
export const MY_FORMATIONS_ROWS: MyFormationSummary[] = [
  buildMyFormationSummary({
    formation_uid: 'formation-orbit-ledger',
    project_uid: 'e2e-orbit-ledger-uid',
    project_slug: 'orbit-ledger',
    project_name: 'Orbit Ledger',
    sub_stage: null,
    sub_stage_raw: 'Formation - Disengaged',
    announcement_date: null,
    assigned_to_do: 0,
    assigned_done: 2,
    items_done: 17,
    items_total: 17,
    blocking_item_title: null,
  }),
  buildMyFormationSummary({
    formation_uid: 'formation-harbor-mesh',
    project_uid: 'e2e-harbor-mesh-uid',
    project_slug: 'harbor-mesh',
    project_name: 'Harbor Mesh',
    sub_stage: 'exploratory',
    sub_stage_raw: 'Formation - Exploratory',
    announcement_date: null,
    assigned_to_do: 1,
    assigned_done: 0,
    items_done: 0,
    items_total: 17,
    blocking_item_title: null,
  }),
  buildMyFormationSummary(),
];

/** One stubbed `GET /api/user/formation-work` response; a non-200 `status` needs no `body`. */
export interface MyFormationsStubResponse {
  status: number;
  body?: MyFormationWorkResponse;
}

export interface MyFormationsGotoOptions {
  flagEnabled?: boolean;
  /**
   * Responses for successive `GET /api/user/formation-work` calls; the last one repeats, so the
   * list must hold at least one. A non-200 status exercises the page's error state (the service
   * maps it to `state: 'unavailable'`).
   */
  responses?: [MyFormationsStubResponse, ...MyFormationsStubResponse[]];
}

/**
 * Lands on the Me-lens My Formations page (#2753) with `GET /api/user/formation-work` stubbed and
 * the other Me-lens reads the layout makes stubbed empty, the same way `gotoMeDashboardWithFormationRow`
 * does. The checklist APIs are mocked too so a row's click-through lands on a real checklist.
 * Shared by the content spec and its structural `-robust` twin.
 */
export async function gotoMyFormations(page: Page, options: MyFormationsGotoOptions = {}): Promise<void> {
  const flagEnabled = options.flagEnabled ?? true;
  const responses = options.responses ?? [{ status: 200, body: { formations: MY_FORMATIONS_ROWS, items: [], state: 'complete' } }];
  let call = 0;

  await page.context().addCookies([{ name: LENS_COOKIE_KEY, value: 'me', domain: e2eCookieHost(), path: '/' }]);
  await stubFormationFlag(page, flagEnabled);
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas: ['contributor'], personaProjects: {}, projects: [], organizations: [], isRootWriter: false }),
    })
  );
  await page.route('**/api/user/meetings*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/user/past-meetings*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/user/formation-work*', (route) => {
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body ?? { error: 'unavailable' }) });
  });
  await mockFormationChecklistApis(page, { project: buildBaseProject(FORMATION_PROJECT_SLUG) });

  await page.goto('/formations', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

/** Navigates to the formation checklist's own route (GH-1958), guarded by `formationProjectEnabledGuard`. */
export async function gotoProjectFormation(page: Page, slug: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/project/formation?project=${slug}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

/**
 * The checklist route with `?item=<template_item_key>` (#2732) — what a Me-lens pending-action row
 * links to, and the shape the item-assigned email can append (#2573, #2616).
 */
export async function gotoProjectFormationItem(page: Page, slug: string, itemKey: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/project/formation?project=${slug}&item=${itemKey}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}
