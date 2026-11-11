// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Lens context for the Mentorship Programs pages in the Projects and Foundation lenses (linuxfoundation/lfx-mentorship#398),
 * covered end to end for linuxfoundation/lfx-mentorship#378.
 *
 * The lens mounts (`/project/mentorship`, `/foundation/mentorship`) resolve `?project=<slug>` with `GET /api/projects/<slug>`,
 * which also feeds the sidebar's write check. Everything the lens reads is stubbed with a synthetic foundation, project and
 * sub-project, and the nav lens items are stubbed so the app never swaps in the test account's real selection mid-test. The
 * `mentorship-enabled` flag, which gates only the sidebar entries, is pinned on through the non-production flag override.
 *
 * Pages are reached by client-side navigation from `/`: a full `page.goto()` would run the guard and the page reads on the
 * Express server, where `page.route` stubs do not apply.
 */

import {
  FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
  LENS_COOKIE_KEY,
  MENTORSHIP_ENABLED_FLAG,
  PERSONA_COOKIE_KEY,
  SELECTED_FOUNDATION_COOKIE_KEY,
  SELECTED_PROJECT_COOKIE_KEY,
} from '@lfx-one/shared/constants';
import type { PersistedPersonaState } from '@lfx-one/shared/interfaces';
import { expect, Page, Route } from '@playwright/test';

export type MentorshipLensKind = 'project' | 'foundation';

export interface MentorshipLensContext {
  uid: string;
  slug: string;
  name: string;
}

/** UUID-shaped, since the BFF checks the shape of a project uid. All synthetic. */
export const LENS_FOUNDATION: MentorshipLensContext = {
  uid: 'f0e2e398-0000-4000-8000-000000000001',
  slug: 'e2e-mentorship-foundation',
  name: 'Example Foundation',
};
export const LENS_PROJECT: MentorshipLensContext = { uid: 'a0e2e398-0000-4000-8000-000000000002', slug: 'e2e-mentorship-project', name: 'Example Project' };
export const LENS_SUB_PROJECT: MentorshipLensContext = {
  uid: 'b0e2e398-0000-4000-8000-000000000003',
  slug: 'e2e-mentorship-sub-project',
  name: 'Example Sub-project',
};

export const MENTORSHIP_LENS_PAGE_TIMEOUT = 30_000;

/**
 * The host the seeded cookies are scoped to: the same precedence `playwright.config.ts` uses for `baseURL`, so an `E2E_BASE_URL`
 * override moves the cookies with the page under test (as `formation-checklist.helper.ts` does).
 */
function e2eCookieHost(): string {
  return new URL(process.env['E2E_BASE_URL'] ?? `http://${process.env['E2E_HOST'] ?? 'localhost'}:${process.env['E2E_PORT'] ?? '4200'}`).hostname;
}

const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** The lens's own context: the foundation in the Foundation lens, the project in the Projects lens. */
export function lensContextOf(lens: MentorshipLensKind): MentorshipLensContext {
  return lens === 'foundation' ? LENS_FOUNDATION : LENS_PROJECT;
}

/** A lens Mentorship URL with its `?project=` slug, e.g. `lensPath('project', '/enroll')`. */
export function lensPath(lens: MentorshipLensKind, rest = ''): string {
  return `/${lens}/mentorship${rest}?project=${lensContextOf(lens).slug}`;
}

function projectStub(context: MentorshipLensContext, lens: MentorshipLensKind, writer: boolean) {
  return {
    uid: context.uid,
    slug: context.slug,
    name: context.name,
    description: `${context.name} (synthetic)`,
    public: true,
    parent_uid: '',
    stage: 'Active',
    category: lens === 'foundation' ? 'foundation' : 'project',
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
    writer,
  };
}

function contextCookie(lens: MentorshipLensKind) {
  const context = lensContextOf(lens);
  return {
    name: lens === 'foundation' ? SELECTED_FOUNDATION_COOKIE_KEY : SELECTED_PROJECT_COOKIE_KEY,
    value: encodeURIComponent(JSON.stringify(context)),
    domain: e2eCookieHost(),
    path: '/',
    sameSite: 'Lax' as const,
  };
}

/**
 * Seeds the lens: persona and lens cookies, the selected context, a root-writer persona (which allows both lenses), the project
 * read with `writer` (true by default), the writer summary, the nav lens items, and the `mentorship-enabled` flag pinned to
 * `flagEnabled` (true by default). Call before `openLensPage`.
 */
export async function stubMentorshipLens(page: Page, lens: MentorshipLensKind, options: { writer?: boolean; flagEnabled?: boolean } = {}): Promise<void> {
  const writer = options.writer ?? true;
  const context = lensContextOf(lens);
  const persona: PersistedPersonaState = {
    primary: lens === 'foundation' ? 'executive-director' : 'maintainer',
    all: [lens === 'foundation' ? 'executive-director' : 'maintainer'],
  };

  await page.addInitScript(
    ([storageKey, flagKey, value]) => {
      const current = JSON.parse(window.localStorage.getItem(storageKey as string) ?? '{}');
      window.localStorage.setItem(storageKey as string, JSON.stringify({ ...current, [flagKey as string]: value }));
    },
    [FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MENTORSHIP_ENABLED_FLAG, options.flagEnabled ?? true] as const
  );
  await page
    .context()
    .addCookies([
      { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(persona)), domain: e2eCookieHost(), path: '/', sameSite: 'Lax' },
      { name: LENS_COOKIE_KEY, value: lens, domain: e2eCookieHost(), path: '/', sameSite: 'Lax' },
      contextCookie(lens),
    ]);

  await page.route('**/api/user/personas*', (route) =>
    json(route, { personas: persona.all, personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  // An exact pattern: `**/api/projects/*` would also catch writer-summary, slugs and search.
  await page.route(`**/api/projects/${context.slug}`, (route) =>
    route.request().method() === 'GET' ? json(route, projectStub(context, lens, writer)) : route.fallback()
  );
  await page.route(`**/api/projects/${context.slug}?*`, (route) =>
    route.request().method() === 'GET' ? json(route, projectStub(context, lens, writer)) : route.fallback()
  );
  await page.route('**/api/projects/*/sfid*', (route) => json(route, { sfid: null }));
  await page.route('**/api/projects/writer-summary*', (route) =>
    json(route, { hasWriterFoundation: writer && lens === 'foundation', hasWriterProject: writer && lens === 'project' })
  );
  await page.route('**/api/nav/lens-items*', (route) => {
    const isFoundation = new URL(route.request().url()).searchParams.get('lens') !== 'project';
    const items = isFoundation
      ? [{ uid: LENS_FOUNDATION.uid, slug: LENS_FOUNDATION.slug, name: LENS_FOUNDATION.name, logoUrl: null, isFoundation: true }]
      : [{ uid: LENS_PROJECT.uid, slug: LENS_PROJECT.slug, name: LENS_PROJECT.name, logoUrl: null, isFoundation: false }];
    return json(route, { items, next_page_token: null, upstream_failed: false, lens: isFoundation ? 'foundation' : 'project' });
  });
}

/**
 * Lands on a lens page by client-side navigation from `/`. The `/` boot runs on the server with the account's real data and can
 * set a real selection, so the stubbed context cookie is set again before navigating. The sidebar is `hidden lg:flex`, so callers
 * pin a desktop viewport.
 */
export async function openLensPage(page: Page, lens: MentorshipLensKind, path: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: MENTORSHIP_LENS_PAGE_TIMEOUT });
  await page.context().addCookies([contextCookie(lens)]);
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}
