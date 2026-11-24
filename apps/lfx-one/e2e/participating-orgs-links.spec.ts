// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Project Lens → Participating Companies name links, through the real template.
 *
 * Coverage:
 *   L1  Mocked links answer: a member keeps its membership link, a readable non-member links to its Company Lens home
 *       (`/company/{segment}`), an addressable CDP company links to `/company/{CDP id}`, anything else is plain
 *   L2  A failed links read (500) leaves every name plain, the member's no-access hint included
 *   L3  Real BFF: a made-up CDP id is never answered as a CDP company (`cdpCompanyIds: []`)
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 */

import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY, PROJECT_PARTICIPATING_ORGS_LINKS_CDP_IDS_PARAM, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import type {
  PersistedPersonaState,
  PersonaType,
  ProjectParticipatingOrg,
  ProjectParticipatingOrgsOrgLensLinksResponse,
  ProjectParticipatingOrgsPage,
  ProjectParticipatingOrgsSummary,
  ProjectParticipatingOrgsSummaryResponse,
} from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

import {
  SYNTHETIC_ORG_ACCOUNT_ID,
  SYNTHETIC_ORG_NAME,
  SYNTHETIC_SECOND_ORG_ACCOUNT_ID,
  SYNTHETIC_SECOND_ORG_LEGAL_NAME,
} from './fixtures/mock-data/synthetic-org.mock';

const PAGE_LOAD_TIMEOUT = 20_000;
const PROJECT_UID = 'p0000000-0000-0000-0000-00000000a092';
const PROJECT_SLUG = 'participating-orgs-links-e2e-project';
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
  await stubLinks(page);

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

const NON_MEMBER_PLAIN_ACCOUNT_ID = '0014100000GammAAAA';
const CDP_LINKED_ID = 'c0ffee00-0000-4000-8000-000000000062';
const CDP_PLAIN_ID = 'c0ffee00-0000-4000-8000-000000000063';
const MADE_UP_CDP_ID = '00000000-0000-4000-8000-0000deadbeef';

let linksAnswer: { status: number; body: ProjectParticipatingOrgsOrgLensLinksResponse | { code: string } } = {
  status: 200,
  body: { readableAccountIds: [], cdpCompanyIds: [] },
};

async function stubLinks(page: Page): Promise<void> {
  await page.route(new RegExp(`/api/projects/${PROJECT_SLUG}/participating-orgs/org-lens-links\\?`), (route) =>
    route.fulfill({ status: linksAnswer.status, contentType: 'application/json', body: JSON.stringify(linksAnswer.body) })
  );
}

function row(overrides: Partial<ProjectParticipatingOrg>): ProjectParticipatingOrg {
  return {
    participantKey: '',
    accountId: null,
    organizationId: null,
    name: '',
    logoUrl: null,
    isUnidentified: false,
    isMember: false,
    membershipTierClass: null,
    commits: 10,
    commitsPrev: null,
    commitsChange: null,
    contributors: 2,
    contributorsPrev: null,
    contributorsChange: null,
    ...overrides,
  };
}

const ROWS: ProjectParticipatingOrg[] = [
  row({ participantKey: SYNTHETIC_ORG_ACCOUNT_ID, accountId: SYNTHETIC_ORG_ACCOUNT_ID, name: SYNTHETIC_ORG_NAME, isMember: true, membershipTierClass: 'Gold' }),
  row({ participantKey: SYNTHETIC_SECOND_ORG_ACCOUNT_ID, accountId: SYNTHETIC_SECOND_ORG_ACCOUNT_ID, name: SYNTHETIC_SECOND_ORG_LEGAL_NAME }),
  row({ participantKey: NON_MEMBER_PLAIN_ACCOUNT_ID, accountId: NON_MEMBER_PLAIN_ACCOUNT_ID, name: 'Gamma Plain Co' }),
  row({ participantKey: `cdev:${CDP_LINKED_ID}`, organizationId: CDP_LINKED_ID, name: 'Linked CDP Co', isUnidentified: true }),
  row({ participantKey: `cdev:${CDP_PLAIN_ID}`, organizationId: CDP_PLAIN_ID, name: 'Plain CDP Co', isUnidentified: true }),
];

const LIST: ProjectParticipatingOrgsPage = { rows: ROWS, totalRecords: ROWS.length, foundationSlug: FOUNDATION_SLUG };

function nameOf(page: Page, participantKey: string) {
  return page.getByTestId(`participating-orgs-row-${participantKey}-name`);
}

test.describe('Project Lens Participating Companies name links', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => {
    if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  });

  test('L1: members keep their link; readable non-members and CDP companies link into Company Lens; others are plain', async ({ page }) => {
    linksAnswer = { status: 200, body: { readableAccountIds: [SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_SECOND_ORG_ACCOUNT_ID], cdpCompanyIds: [CDP_LINKED_ID] } };
    const linksRequest = page.waitForRequest(/\/participating-orgs\/org-lens-links\?/);
    await gotoParticipatingOrgs(page, { summary: summaryWithActivity() }, LIST);

    const query = new URL((await linksRequest).url()).searchParams;
    expect(query.get('accountIds')).toBe(SYNTHETIC_ORG_ACCOUNT_ID);
    expect(query.get('nonMemberAccountIds')?.split(',').sort()).toEqual([NON_MEMBER_PLAIN_ACCOUNT_ID, SYNTHETIC_SECOND_ORG_ACCOUNT_ID].sort());
    expect(query.get(PROJECT_PARTICIPATING_ORGS_LINKS_CDP_IDS_PARAM)?.split(',').sort()).toEqual([CDP_LINKED_ID, CDP_PLAIN_ID].sort());

    const member = nameOf(page, SYNTHETIC_ORG_ACCOUNT_ID);
    await expect(member).toHaveAttribute('href', new RegExp(`^/company/[^/]+/memberships/${FOUNDATION_SLUG}$`), { timeout: PAGE_LOAD_TIMEOUT });

    await expect(nameOf(page, SYNTHETIC_SECOND_ORG_ACCOUNT_ID)).toHaveAttribute('href', /^\/company\/[^/]+$/);
    await expect(nameOf(page, SYNTHETIC_SECOND_ORG_ACCOUNT_ID)).toHaveAttribute('data-name-kind', 'org-lens-home-link');
    await expect(nameOf(page, `cdev:${CDP_LINKED_ID}`)).toHaveAttribute('href', `/company/${CDP_LINKED_ID}`);

    for (const key of [NON_MEMBER_PLAIN_ACCOUNT_ID, `cdev:${CDP_PLAIN_ID}`]) {
      const name = nameOf(page, key);
      await expect(name).toBeVisible();
      expect(await name.evaluate((el) => el.tagName)).toBe('SPAN');
      await expect(name).not.toHaveAttribute('role', 'note');
    }
  });

  test('L2: a failed links read leaves every name plain', async ({ page }) => {
    linksAnswer = { status: 500, body: { code: 'INTERNAL' } };
    const linksResponse = page.waitForResponse(/\/participating-orgs\/org-lens-links\?/);
    await gotoParticipatingOrgs(page, { summary: summaryWithActivity() }, LIST);
    expect((await linksResponse).status()).toBe(500);

    for (const { participantKey } of ROWS) {
      const name = nameOf(page, participantKey);
      await expect(name).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
      expect(await name.evaluate((el) => el.tagName)).toBe('SPAN');
    }
    await expect(page.getByTestId('participating-orgs-table').locator('a[data-name-kind]')).toHaveCount(0);
  });

  test('L3: the real BFF never answers a made-up CDP id as a CDP company', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    const lensItems = await page.request.get('/api/nav/lens-items?lens=project');
    const slugs: string[] = lensItems.ok() ? ((await lensItems.json())?.items ?? []).map((item: { slug?: string }) => item.slug).filter(Boolean) : [];
    let answered: ProjectParticipatingOrgsOrgLensLinksResponse | null = null;
    for (const slug of slugs.slice(0, 5)) {
      const response = await page.request.get(
        `/api/projects/${encodeURIComponent(slug)}/participating-orgs/org-lens-links?${PROJECT_PARTICIPATING_ORGS_LINKS_CDP_IDS_PARAM}=${MADE_UP_CDP_ID}`
      );
      if (response.ok()) {
        answered = await response.json();
        break;
      }
    }
    test.skip(answered === null, 'The harness identity cannot read the participating companies of any project it lists');
    expect(answered?.cdpCompanyIds).toEqual([]);
  });
});
