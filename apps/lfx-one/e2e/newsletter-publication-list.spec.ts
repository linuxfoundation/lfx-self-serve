// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Publication List — landing page — LFXV2-2582.
 *
 * `NewsletterPublicationListComponent` replaced the flat newsletter list as the
 * `/newsletters` landing route. This spec locks in the empty state (no
 * publications yet) and the populated state, plus the "All newsletters" link
 * that routes back to the flat, cross-publication list — the one remaining
 * entry point for unfiled editions and opt-out management once this page owns
 * the landing route.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type {
  LensItem,
  Newsletter,
  NewsletterListResponse,
  NewsletterPublication,
  NewsletterPublicationListResponse,
  PersistedPersonaState,
  PersonaType,
} from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-000000000001';

const MOCK_FOUNDATION_ITEM: LensItem = {
  uid: MOCK_FOUNDATION_UID,
  slug: MOCK_FOUNDATION_SLUG,
  name: 'Test Foundation',
  logoUrl: null,
  isFoundation: true,
};

function buildProjectStub() {
  return {
    uid: MOCK_FOUNDATION_UID,
    slug: MOCK_FOUNDATION_SLUG,
    name: 'Test Foundation',
    description: 'Test foundation for newsletter publication list specs',
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

function buildPublication(overrides: Partial<NewsletterPublication> = {}): NewsletterPublication {
  return {
    id: 'p0000000-0000-0000-0000-000000000001',
    project_uid: MOCK_FOUNDATION_UID,
    slug: 'weekly-digest',
    name: 'Weekly Digest',
    is_default: true,
    wrapper_content: null,
    editor_type: 'block',
    created_by: 'test-user',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    version: 1,
    ...overrides,
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

async function stubNavLensItems(page: Page): Promise<void> {
  await page.route('**/api/nav/lens-items*', (route) => {
    const requestedLens = new URL(route.request().url()).searchParams.get('lens') ?? 'foundation';
    if (requestedLens !== 'foundation') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], next_page_token: null, upstream_failed: false, lens: requestedLens }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [MOCK_FOUNDATION_ITEM], next_page_token: null, upstream_failed: false, lens: 'foundation' }),
    });
  });
}

async function stubProjectApi(page: Page): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_SLUG}*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildProjectStub()) })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sfid: null }) }));
}

async function stubPublicationsApi(page: Page, publications: NewsletterPublication[]): Promise<void> {
  const response: NewsletterPublicationListResponse = { publications };
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletter-publications*`, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    }
    return route.fallback();
  });
}

function buildDraft(): Newsletter {
  return {
    id: 'n0000000-0000-0000-0000-000000000aaa',
    project_uid: MOCK_FOUNDATION_UID,
    subject: 'Welcome to KubeCon Recap',
    body_html: '<p>Recap body.</p>',
    ed_reply_email: 'ed@example.com',
    committee_uids: [],
    status: 'draft',
    total_recipients: 0,
    created_by: 'test-user',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// A non-empty stub, not an empty one: NewsletterListComponent's 'draft' tab
// (the default landing tab) branches to its own empty state whenever
// hasNewsletters() is false, so an empty stub here would make the
// newsletter-list-table assertion below either fail outright or pass only by
// racing the brief window where loading() is still true — the destination
// page's table branch needs at least one row to render deterministically.
async function stubNewslettersListApi(page: Page): Promise<void> {
  const listResponse: NewsletterListResponse = { newsletters: [buildDraft()], next_page_token: undefined };
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters*`, (route) => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname.endsWith('/newsletters')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listResponse) });
    }
    return route.fallback();
  });
}

async function setPersonaCookie(page: Page, personas: string[]): Promise<void> {
  const state: PersistedPersonaState = {
    primary: personas[0] as PersonaType,
    all: personas as PersonaType[],
  };
  await page.context().addCookies([
    {
      name: PERSONA_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify(state)),
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
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

async function gotoPublicationListUrl(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/foundation/newsletters?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Newsletter publication list — landing page', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page, ['executive-director']);
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page);
  });

  test('shows the empty state and its create CTA when the project has no publications', async ({ page }) => {
    await stubPublicationsApi(page, []);
    await gotoPublicationListUrl(page);

    await expect(page.getByTestId('newsletter-publication-list-empty-state'), 'empty state should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('newsletter-publication-list-card')).toContainText('No publications yet');
    await expect(page.getByTestId('newsletter-publication-list-all-link'), "'All newsletters' link should stay available").toBeVisible();
  });

  test('lists each publication as a row, with the default badge only on the default one', async ({ page }) => {
    await stubPublicationsApi(page, [
      buildPublication(),
      buildPublication({ id: 'p0000000-0000-0000-0000-000000000002', slug: 'release-notes', name: 'Release Notes', is_default: false }),
    ]);
    await gotoPublicationListUrl(page);

    const rows = page.locator('[data-testid^="newsletter-publication-row-"]');
    await expect(rows, 'both publications should render as rows').toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(
      page.getByTestId('publication-default-badge-p0000000-0000-0000-0000-000000000001'),
      'default badge should mark the default publication'
    ).toBeVisible();
    await expect(
      page.getByTestId('publication-default-badge-p0000000-0000-0000-0000-000000000002'),
      'the non-default publication should not carry the badge'
    ).toHaveCount(0);
    await expect(page.getByTestId('newsletter-publication-list-empty-state')).toHaveCount(0);
  });

  test("'All newsletters' link routes to the flat, cross-publication list", async ({ page }) => {
    await stubPublicationsApi(page, []);
    await stubNewslettersListApi(page);
    await gotoPublicationListUrl(page);

    await expect(page.getByTestId('newsletter-publication-list-empty-state'), 'empty state should render first').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId('newsletter-publication-list-all-link').click();

    await expect(page).toHaveURL(/\/foundation\/newsletters\/list(?:[?&]|$)/);
    await expect(page.getByTestId('newsletter-list-table'), 'flat list should render after navigating').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });
});
