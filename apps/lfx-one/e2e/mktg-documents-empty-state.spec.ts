// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Marketing OS Documents area: the empty states, through the real template.
 *
 * A project with no stored Marketing OS output must say so for both kinds of document: a living
 * document (Brand Kit) shows "No Brand Kit yet" with a link to run its agent, and a run type
 * (LinkedIn posts) says it has no runs yet. The unit spec renders the component against a store
 * double; this pins the same two branches through the real route, guard and HTTP client, with
 * `/api/mktg-agents/documents` answering with every group empty.
 *
 * Coverage:
 *   D0  No type filter: All documents empty state
 *   D1  Living document with no revisions: `mktg-documents-empty-living` and its "Run the …" link
 *   D2  Run type with no runs: `mktg-documents-empty-runs`
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 *
 * The Marketing OS pages are dark-launched behind `mktg-os-agents-enabled`; the flag is pinned on
 * through the non-production localStorage override, so no LaunchDarkly targeting is needed.
 */

import {
  FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
  LENS_COOKIE_KEY,
  MKTG_DOCUMENT_TYPES,
  MKTG_OS_AGENTS_ENABLED_FLAG,
  MKTG_OS_AGENTS_ROUTE_SEGMENT,
  PERSONA_COOKIE_KEY,
  SELECTED_PROJECT_COOKIE_KEY,
} from '@lfx-one/shared/constants';
import type { MktgDocumentsResponse, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';

const PAGE_LOAD_TIMEOUT = 20_000;
const PROJECT_UID = 'p0000000-0000-0000-0000-00000000d0c5';
const PROJECT_SLUG = 'mktg-documents-e2e-project';
const PROJECT_NAME = 'Documents E2E Project';

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Every document type registered, none with a document: a project no Marketing OS agent has run for. */
function emptyDocuments(): MktgDocumentsResponse {
  return { project: PROJECT_UID, groups: MKTG_DOCUMENT_TYPES.map((type) => ({ type, documents: [] })) };
}

async function pinMktgFlag(page: Page): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [MKTG_OS_AGENTS_ENABLED_FLAG]: true }),
  ] as const);
}

async function seedContextCookies(page: Page): Promise<void> {
  const persona: PersistedPersonaState = { primary: 'executive-director' as PersonaType, all: ['executive-director' as PersonaType] };
  await page.context().addCookies([
    { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(persona)), domain: 'localhost', path: '/', sameSite: 'Lax' },
    { name: LENS_COOKIE_KEY, value: 'project', domain: 'localhost', path: '/', sameSite: 'Lax' },
    {
      name: SELECTED_PROJECT_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME })),
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ]);
}

/** The project lens context and the Documents area read, all stubbed so the page never reaches the real BFF. */
async function stubContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  await page.route(`**/api/projects/${PROJECT_SLUG}*`, (route) =>
    fulfillJson(route, { uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, parent_uid: '', writer: true })
  );
  await page.route('**/api/projects/*/sfid*', (route) => fulfillJson(route, { sfid: null }));
  // Without this the app loads the test account's REAL projects and can override the seeded context.
  await page.route('**/api/nav/lens-items*', (route) => {
    const isFoundation = new URL(route.request().url()).searchParams.get('lens') !== 'project';
    const items = isFoundation ? [] : [{ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, logoUrl: null, isFoundation: false }];
    return fulfillJson(route, { items, next_page_token: null, upstream_failed: false, lens: isFoundation ? 'foundation' : 'project' });
  });
  // The list read only (`/documents?project=`), not a document or revision path.
  await page.route(/\/api\/mktg-agents\/documents\?/, (route) => fulfillJson(route, emptyDocuments()));
}

/**
 * Boots the app and lands on the Documents area by SPA navigation: a full navigation would SSR the
 * route on the Express server, whose fetches bypass `page.route` and hit the real BFF.
 */
async function gotoDocuments(page: Page, query = ''): Promise<void> {
  await suppressCookieBanner(page);
  await pinMktgFlag(page);
  await seedContextCookies(page);
  await stubContext(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  // The '/' boot can Set-Cookie the account's real selection; re-assert the intended context.
  await seedContextCookies(page);
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/${MKTG_OS_AGENTS_ROUTE_SEGMENT}/documents?project=${PROJECT_SLUG}${query}`);

  await expect(page.getByTestId('mktg-documents-page')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('Marketing OS Documents area empty states', () => {
  // The shell's sidebar is `hidden lg:flex`; a desktop viewport keeps the boot assertion valid on every project.
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => {
    if (!process.env['TEST_USERNAME'] || !process.env['TEST_PASSWORD']) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  });

  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('documents-empty.png'), fullPage: true });
  });

  test('D0: no type filter shows the empty All documents collection', async ({ page }) => {
    await gotoDocuments(page);
    await expect(page.getByTestId('mktg-documents-empty-all')).toBeVisible();
    await expect(page.getByTestId('mktg-documents-empty-living')).toHaveCount(0);
    await expect(page.getByTestId('mktg-documents-project-title')).toHaveText(PROJECT_NAME);
  });

  test('D1: a living document with no revisions says so and links to its agent', async ({ page }) => {
    await gotoDocuments(page, '&type=brand-kit');

    const empty = page.getByTestId('mktg-documents-empty-living');
    await expect(empty).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(empty).toContainText('No Brand Kit yet');
    const prerequisite = page.getByTestId('mktg-documents-run-agent-brand-kit');
    await expect(prerequisite).toHaveText('Create messaging framework');
    await expect(prerequisite.getByRole('link', { name: 'Create messaging framework', exact: true })).toHaveAttribute('href', /\/foundation-setup\?project=/);
    // No revisions table is rendered for a document that does not exist yet.
    await expect(page.getByTestId('mktg-documents-revisions')).toHaveCount(0);
    await expect(page.getByTestId('mktg-documents-nav-brand-kit')).toContainText('Not generated yet');
  });

  test('D2: a run type with no runs says a new run is a new document', async ({ page }) => {
    await gotoDocuments(page, '&type=linkedin-post');

    const empty = page.getByTestId('mktg-documents-empty-runs');
    await expect(empty).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(empty).toContainText('No runs yet');
    await expect(empty).toContainText('a new run is a new document');
    await expect(page.getByTestId('mktg-documents-nav-linkedin-post')).toContainText('No runs yet');
  });
});
