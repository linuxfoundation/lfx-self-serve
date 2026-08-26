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
const MOCK_NEWSLETTER_ID = 'n0000000-0000-0000-0000-000000000aaa';
// Deliberately hex-only (not the `p...` mnemonic prefix sibling fixtures use
// for "publication") — this value reaches toValidUuid as the :pubId route
// param when a row navigates to its editions, and a non-hex prefix silently
// degrades that navigation to the unscoped list instead of failing a test
// (see this file's git history for exactly that bug). Named constants, not
// inline literals, so every use carries this warning rather than only the
// one at buildPublication's default.
const MOCK_PUBLICATION_ID = 'a0000000-0000-0000-0000-000000000001';
const MOCK_PUBLICATION_ID_2 = 'a0000000-0000-0000-0000-000000000002';

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
    id: MOCK_PUBLICATION_ID,
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
    id: MOCK_NEWSLETTER_ID,
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
// hasNewsletters() is false, so an empty stub here would make the assertions
// below either fail outright or pass only by racing the brief window where
// loading() is still true — the destination page's table branch renders
// during that loading window too (@else if (!loading() && !hasNewsletters())
// gates the empty state, not the table), so asserting the table alone is
// exactly as racy. The tests below assert the stubbed row itself instead,
// which only exists once this response has actually landed.
// Returned object's requestedPublicationId is populated (mutated in place)
// once the stub actually serves a request — read it only after the
// navigation that's expected to trigger the request, not immediately after
// calling this. Every caller reads it: the row keyboard tests assert it
// equals the activated publication's id (this request should be scoped);
// the "All newsletters" tests assert it's null (this request should be
// cross-publication) — so both directions of "did the app request the right
// thing" are pinned, not just "some response landed." Starts as `undefined`,
// not `null`: `null` is also url.searchParams.get()'s own "param absent"
// value, so initializing to it would make an unscoped-request assertion
// (toBeNull()) pass identically whether the stub was ever actually hit or
// not — undefined is a sentinel `searchParams.get()` can never itself
// produce, so a stub that's never invoked still fails that assertion loudly.
async function stubNewslettersListApi(page: Page): Promise<{ requestedPublicationId: string | null | undefined }> {
  const capture: { requestedPublicationId: string | null | undefined } = { requestedPublicationId: undefined };
  const listResponse: NewsletterListResponse = { newsletters: [buildDraft()], next_page_token: undefined };
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters*`, (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname.endsWith('/newsletters')) {
      capture.requestedPublicationId = url.searchParams.get('publication_id');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listResponse) });
    }
    return route.fallback();
  });
  return capture;
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
      buildPublication({ id: MOCK_PUBLICATION_ID_2, slug: 'release-notes', name: 'Release Notes', is_default: false }),
    ]);
    await gotoPublicationListUrl(page);

    const rows = page.locator('[data-testid^="newsletter-publication-row-"]');
    await expect(rows, 'both publications should render as rows').toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId(`publication-default-badge-${MOCK_PUBLICATION_ID}`), 'default badge should mark the default publication').toBeVisible();
    await expect(page.getByTestId(`publication-default-badge-${MOCK_PUBLICATION_ID_2}`), 'the non-default publication should not carry the badge').toHaveCount(
      0
    );
    await expect(page.getByTestId('newsletter-publication-list-empty-state')).toHaveCount(0);
  });

  test("'All newsletters' link routes to the flat, cross-publication list", async ({ page }) => {
    await stubPublicationsApi(page, []);
    const newslettersStub = await stubNewslettersListApi(page);
    await gotoPublicationListUrl(page);

    await expect(page.getByTestId('newsletter-publication-list-empty-state'), 'empty state should render first').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId('newsletter-publication-list-all-link').click();

    await expect(page).toHaveURL(/\/foundation\/newsletters\/list(?:[?&]|$)/);
    await expect(page.getByTestId(`newsletter-row-${MOCK_NEWSLETTER_ID}`), 'stubbed edition should render in the flat list').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    // Mirror of the row tests' scoped-request assertion below: "cross-
    // publication" means this request must carry no publication_id at all,
    // not just that a response landed.
    expect(newslettersStub.requestedPublicationId, 'flat list request should be unscoped').toBeNull();
  });

  // Both the publication row and the "All newsletters" link are non-native
  // (a <div role="button"> and an <a role="link"> respectively) rather than a
  // <button>/plain <a href>, specifically so keyboard activation had to be
  // wired by hand — these pin that it actually was, rather than trusting the
  // role/tabindex attributes the structural spec checks. Stubs the
  // destination (stubNewslettersListApi) and asserts it renders, same as the
  // click-based "All newsletters" test above, rather than only asserting the
  // URL changed — otherwise the row's Enter/Space path would depend on an
  // unstubbed request against the live dev backend to even resolve.
  for (const key of ['Enter', 'Space'] as const) {
    test(`${key} activates a publication row exactly like clicking it`, async ({ page }) => {
      const publicationId = MOCK_PUBLICATION_ID;
      await stubPublicationsApi(page, [buildPublication({ id: publicationId })]);
      const newslettersStub = await stubNewslettersListApi(page);
      await gotoPublicationListUrl(page);

      const row = page.getByTestId(`newsletter-publication-row-${publicationId}`);
      await expect(row, 'publication row should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
      await row.focus();
      await page.keyboard.press(key);

      await expect(page).toHaveURL(new RegExp(`/foundation/newsletters/${MOCK_FOUNDATION_UID}/${publicationId}/editions(?:[?&]|$)`));
      await expect(page.getByTestId(`newsletter-row-${MOCK_NEWSLETTER_ID}`), 'stubbed edition should render in the editions list').toBeVisible({
        timeout: ELEMENT_TIMEOUT,
      });
      // Confirms the destination request was actually scoped to this
      // publication, not merely that some response landed — the id-format fix
      // above is what makes this assertion meaningful rather than vacuous.
      expect(newslettersStub.requestedPublicationId, 'editions request should be scoped to the activated publication').toBe(publicationId);
    });
  }

  test("Enter activates the 'All newsletters' link exactly like clicking it", async ({ page }) => {
    await stubPublicationsApi(page, []);
    const newslettersStub = await stubNewslettersListApi(page);
    await gotoPublicationListUrl(page);

    // Same settle-wait as the click-based version above: the link sits in the
    // static header outside the loading/empty/populated branches, so it's
    // visible at first paint — waiting for the empty state first means
    // hydration (and its (keydown.enter) listener attachment) has actually
    // completed before the keypress, rather than leaning on event replay.
    await expect(page.getByTestId('newsletter-publication-list-empty-state'), 'empty state should render first').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    const link = page.getByTestId('newsletter-publication-list-all-link');
    await link.focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/foundation\/newsletters\/list(?:[?&]|$)/);
    await expect(page.getByTestId(`newsletter-row-${MOCK_NEWSLETTER_ID}`), 'stubbed edition should render in the flat list').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    expect(newslettersStub.requestedPublicationId, 'flat list request should be unscoped').toBeNull();
  });
});
