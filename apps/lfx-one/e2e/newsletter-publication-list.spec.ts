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
    editor_type: 'blocks',
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

async function stubFailedPublicationsApi(page: Page): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletter-publications*`, (route) => {
    if (route.request().method() === 'GET') {
      // { error: '...' }, not { message: '...' } — the BFF's error envelope
      // (BaseApiError.toResponse) keys the upstream reason as `error`; a
      // `message`-shaped fixture would pass identically against the
      // pre-fix err?.error?.message read this commit replaced, so it
      // wouldn't actually pin the envelope key.
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal error' }) });
    }
    return route.fallback();
  });
}

// Registered after stubPublicationsApi (Playwright tries the most-recently
// registered route on a matching glob first, falling back to earlier ones),
// so this only intercepts the POST — the GET list load above still serves it.
async function stubCreatePublicationApi(page: Page, created: NewsletterPublication): Promise<{ requestBody: unknown }> {
  const capture: { requestBody: unknown } = { requestBody: undefined };
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletter-publications*`, (route) => {
    if (route.request().method() === 'POST') {
      capture.requestBody = route.request().postDataJSON();
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(created) });
    }
    return route.fallback();
  });
  return capture;
}

// Same registration-order note as stubCreatePublicationApi above: only
// intercepts the POST, so the initial GET list load still goes through
// stubPublicationsApi.
async function stubFailedCreatePublicationApi(page: Page, status: number, body: unknown): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletter-publications*`, (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
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

  test('the empty-state CTA creates a publication and lands on its (empty, scoped) editions view', async ({ page }) => {
    await stubPublicationsApi(page, []);
    // Hex, not a mnemonic 'new-pub-id' string: this id becomes the :pubId
    // route param on the editions navigation below, gated by the same
    // toValidUuid the row-navigation tests' fixtures are hex-only for — see
    // the MOCK_PUBLICATION_ID comment earlier in this file for the bug class
    // a non-hex id here would silently reintroduce.
    const newPublicationId = 'a0000000-0000-0000-0000-000000000099';
    const created = buildPublication({ id: newPublicationId, slug: 'weekly-digest', name: 'Weekly Digest' });
    const createStub = await stubCreatePublicationApi(page, created);
    // The destination (this brand-new publication's own editions view)
    // genuinely has none yet — a dedicated empty stub (not
    // stubNewslettersListApi's non-empty response) that also captures the
    // publication_id query param, same pattern as stubNewslettersListApi
    // itself, so the navigation can be asserted as scoped, not just landed.
    const newslettersStub: { requestedPublicationId: string | null | undefined } = { requestedPublicationId: undefined };
    await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters*`, (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === 'GET' && url.pathname.endsWith('/newsletters')) {
        newslettersStub.requestedPublicationId = url.searchParams.get('publication_id');
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ newsletters: [], next_page_token: undefined }) });
      }
      return route.fallback();
    });
    await gotoPublicationListUrl(page);

    await expect(page.getByTestId('newsletter-publication-list-empty-state'), 'empty state should render first').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByRole('button', { name: 'Create publication' }).click();

    // getByLabel, not a CSS reach below the input's own testid: the dialog's
    // <label for="create-publication-name"> is correctly associated (the
    // wrapper forwards its id input onto the inner native <input>), so this
    // is the semantic query, not a workaround.
    const dialogNameInput = page.getByLabel('Name');
    await expect(dialogNameInput, 'create-publication dialog should open').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await dialogNameInput.fill('Weekly Digest');
    await page.getByTestId('create-publication-submit').click();

    await expect(page).toHaveURL(new RegExp(`/foundation/newsletters/${MOCK_FOUNDATION_UID}/${newPublicationId}/editions(?:[?&]|$)`));
    expect(createStub.requestBody, 'derives the slug from the name, and defaults to the block composer').toEqual({
      name: 'Weekly Digest',
      slug: 'weekly-digest',
      editor_type: 'blocks',
    });
    expect(newslettersStub.requestedPublicationId, 'lands on a request scoped to the newly created publication').toBe(newPublicationId);
  });

  test('a 409 on create shows an inline, name-based error and keeps the typed name — second, independent layer over the component spec', async ({ page }) => {
    // Regression this guards: disabling the name field for the duration of
    // the request re-enabled it via nameControl.enable() with no options,
    // which emits on valueChanges by default — the same valueChanges
    // subscription that clears submitError on a genuine edit then fired on
    // re-enable itself, wiping the just-set error a heartbeat after the
    // failure handler set it. The component spec pins this at the unit
    // layer (see create-publication-dialog.component.spec.ts's "stays open
    // ... on a create failure" test); this test covers the same regression
    // end-to-end through the real HTTP stack, since the two layers fail
    // independently of each other.
    await stubPublicationsApi(page, []);
    await stubFailedCreatePublicationApi(page, 409, { error: 'a publication with slug "weekly-digest" already exists in this project' });
    await gotoPublicationListUrl(page);

    await expect(page.getByTestId('newsletter-publication-list-empty-state'), 'empty state should render first').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await page.getByRole('button', { name: 'Create publication' }).click();

    const dialogNameInput = page.getByLabel('Name');
    await expect(dialogNameInput, 'create-publication dialog should open').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await dialogNameInput.fill('Weekly Digest');
    await page.getByTestId('create-publication-submit').click();

    // Upstream's own conflict text names the slug, never shown by this
    // dialog — this pins the name-based substitute, not the raw string.
    await expect(page.getByTestId('create-publication-error'), 'inline error should stay visible after the request settles').toContainText(
      'A publication with a name like "Weekly Digest" already exists in this project. Try a more distinct name.',
      { timeout: ELEMENT_TIMEOUT }
    );
    await expect(dialogNameInput, 'the typed name must not be lost').toHaveValue('Weekly Digest');
    await expect(dialogNameInput, 'the field re-enables once the request settles').toBeEnabled();
  });

  test("the header 'New publication' button opens the same create dialog once publications already exist", async ({ page }) => {
    await stubPublicationsApi(page, [buildPublication()]);
    await gotoPublicationListUrl(page);

    await expect(page.locator(`[data-testid^="newsletter-publication-row-"]`)).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    // Only asserting the dialog opens here — the create flow itself is
    // pinned end-to-end by the empty-state CTA test above; duplicating that
    // full round trip for a second entry point into the same dialog would
    // only prove the same thing twice.
    await page.getByTestId('newsletter-publication-list-new-button').click();

    await expect(page.getByTestId('create-publication-name-input'), 'create-publication dialog should open').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('shows the error state with Retry (not the create empty-state) when the load fails', async ({ page }) => {
    await stubFailedPublicationsApi(page);
    await gotoPublicationListUrl(page);

    // The ready-state testid first, at PAGE_LOAD_TIMEOUT — same convention
    // every other first-assertion-after-navigation in this file uses
    // (gotoPublicationListUrl only waits for domcontentloaded, so this is
    // what actually absorbs SSR render + hydration + the failing round
    // trip). The toast check that follows, at the smaller ELEMENT_TIMEOUT,
    // is then effectively instant: the toast and this error state are set
    // in the same synchronous catchError block, so once this has resolved
    // the toast has already rendered and is nowhere near its 3s self-dismiss.
    await expect(page.getByTestId('newsletter-publication-list-error-state'), 'error state should render').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    // Pins the BFF envelope key this fixture is shaped to (`error`, not
    // `message`).
    await expect(page.locator('.p-toast'), 'toast should surface the upstream error message').toContainText('internal error', { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-publication-list-card')).toContainText("Couldn't load publications");
    await expect(page.getByTestId('newsletter-publication-list-empty-state'), 'the create-CTA empty state must not also render').toHaveCount(0);
    await expect(
      page.getByTestId('newsletter-publication-list-new-button'),
      'the header create button must not render either — a failed load cannot rule out existing publications'
    ).toHaveCount(0);
  });

  test('Retry re-fetches and shows the real list once the load succeeds', async ({ page }) => {
    await stubFailedPublicationsApi(page);
    await gotoPublicationListUrl(page);
    await expect(page.getByTestId('newsletter-publication-list-error-state')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await stubPublicationsApi(page, [buildPublication()]);
    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(page.locator('[data-testid^="newsletter-publication-row-"]')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('newsletter-publication-list-error-state')).toHaveCount(0);
  });
});
