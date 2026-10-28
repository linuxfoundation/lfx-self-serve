// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Project Lens → Participating Organizations (#2091): the empty states, through the real template.
 *
 * A project with no company code activity in the selected window must say so instead of rendering a
 * zeroed page, and a filter that matches no company must leave the page in place with the table's
 * no-match message. The unit spec renders the component against a service double; this pins the
 * same two branches through the real route and HTTP client, with the BFF reads stubbed.
 *
 * Coverage:
 *   P1  Summary `null` (no activity in the window): `participating-orgs-empty` and its copy
 *   P2  Summary with counts, list with no rows: the table's `participating-orgs-no-match` message
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 */

import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import type {
  PersistedPersonaState,
  PersonaType,
  ProjectParticipatingOrgsPage,
  ProjectParticipatingOrgsSummary,
  ProjectParticipatingOrgsSummaryResponse,
} from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

const PAGE_LOAD_TIMEOUT = 20_000;
const PROJECT_UID = 'p0000000-0000-0000-0000-00000000a091';
const PROJECT_SLUG = 'participating-orgs-e2e-project';
const PROJECT_NAME = 'Participating Orgs E2E Project';
const FOUNDATION_SLUG = 'synthetic-foundation';

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function summaryWithActivity(): ProjectParticipatingOrgsSummary {
  return {
    projectSlug: PROJECT_SLUG,
    foundationSlug: FOUNDATION_SLUG,
    foundationName: 'Synthetic Foundation',
    range: '12mo',
    asOfDate: '2026-10-15',
    orgsCount: 3,
    membersCount: 1,
    contributingMembersCount: 1,
    nonMembersCount: 2,
    unidentifiedCount: 1,
    memberCommits: 40,
    companyCommits: 100,
    allCommits: 160,
    memberCommitShareOfCompanyCommits: 0.4,
  };
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

/** The project lens context and the two participating-orgs reads, all stubbed so the page never reaches the real BFF. */
async function stubContext(page: Page, summary: ProjectParticipatingOrgsSummaryResponse, list: ProjectParticipatingOrgsPage): Promise<void> {
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
  await page.route(new RegExp(`/api/projects/${PROJECT_SLUG}/participating-orgs/summary\\?`), (route) => fulfillJson(route, summary));
  // The list read only (`/participating-orgs?…`), not the summary or export paths.
  await page.route(new RegExp(`/api/projects/${PROJECT_SLUG}/participating-orgs\\?`), (route) => fulfillJson(route, list));
}

/**
 * Boots the app and lands on the page by SPA navigation: a full navigation would SSR the route on the
 * Express server, whose fetches bypass `page.route` and hit the real BFF.
 */
async function gotoParticipatingOrgs(page: Page, summary: ProjectParticipatingOrgsSummaryResponse, list: ProjectParticipatingOrgsPage): Promise<void> {
  await seedContextCookies(page);
  await stubContext(page, summary, list);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  // The '/' boot can Set-Cookie the account's real selection; re-assert the intended context.
  await seedContextCookies(page);
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/project/participating-orgs?project=${PROJECT_SLUG}`);

  await expect(page.getByTestId('participating-orgs-page')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('Project Lens Participating Organizations empty states', () => {
  // The shell's sidebar is `hidden lg:flex`; a desktop viewport keeps the boot assertion valid on every project.
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => {
    if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  });

  test('P1: a window with no company code activity says so instead of a zeroed page', async ({ page }) => {
    await gotoParticipatingOrgs(page, { summary: null }, { rows: [], totalRecords: 0, foundationSlug: FOUNDATION_SLUG });

    const empty = page.getByTestId('participating-orgs-empty');
    await expect(empty).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(empty).toContainText('No code contributions from companies in this period');
    await expect(page.getByTestId('participating-orgs-table')).toHaveCount(0);
    // Another window stays one click away.
    await expect(page.getByTestId('participating-orgs-range')).toBeVisible();
  });

  test('P2: filters that match no company keep the page and show the table no-match message', async ({ page }) => {
    await gotoParticipatingOrgs(page, { summary: summaryWithActivity() }, { rows: [], totalRecords: 0, foundationSlug: FOUNDATION_SLUG });

    const noMatch = page.getByTestId('participating-orgs-no-match');
    await expect(noMatch).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(noMatch).toContainText('No organizations match these filters.');
    await expect(page.getByTestId('participating-orgs-tiles')).toBeVisible();
    await expect(page.getByTestId('stat-card-Member Commit Share')).toContainText('40%');
    await expect(page.getByTestId('participating-orgs-empty')).toHaveCount(0);
  });
});
