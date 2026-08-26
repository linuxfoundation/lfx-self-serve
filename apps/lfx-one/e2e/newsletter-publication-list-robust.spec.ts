// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Publication List — Structural Tests — LFXV2-2582.
 *
 * Companion to `newsletter-publication-list.spec.ts`. Asserts the data-testid
 * contract for the landing page — presence/nesting/counts, isolated from copy
 * changes that the content spec exercises.
 *
 * Why this exists: per `docs/architecture/testing/e2e-testing.md`, every feature
 * with E2E coverage gets a content spec AND a structural (`-robust`) spec. The
 * structural spec is the regression net for refactors that move DOM around but
 * keep testid semantics stable.
 */

import type { LensItem, NewsletterPublication, NewsletterPublicationListResponse, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-000000000001';
// Deliberately hex-only (not the `p...` mnemonic prefix sibling fixtures use
// for "publication") — kept in sync with this module's content spec,
// newsletter-publication-list.spec.ts, where this value reaches toValidUuid
// as the :pubId route param on navigation (this file only asserts
// attributes, so it doesn't itself exercise that path, but a mismatched id
// here would desync the two specs' fixtures for no reason). A non-hex prefix
// silently degrades that navigation to the unscoped list instead of failing
// a test — named constants, not inline literals, so every use carries this
// warning.
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
    description: 'Test foundation for newsletter publication list structural specs',
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

async function stubBackend(page: Page, publications: NewsletterPublication[]): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true }),
    })
  );

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

  await page.route(`**/api/projects/${MOCK_FOUNDATION_SLUG}*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildProjectStub()) })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sfid: null }) }));

  const response: NewsletterPublicationListResponse = { publications };
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletter-publications*`, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    }
    return route.fallback();
  });
}

// Registered after stubBackend's own publications route (later registration
// wins), so everything else (persona/nav/project) still serves normally and
// only the publications GET fails.
async function stubBackendFailed(page: Page): Promise<void> {
  await stubBackend(page, []);
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletter-publications*`, (route) => {
    if (route.request().method() === 'GET') {
      // { error: '...' }, not { message: '...' } — see the sibling
      // stubFailedPublicationsApi in newsletter-publication-list.spec.ts for
      // why the envelope key matters here.
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal error' }) });
    }
    return route.fallback();
  });
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

async function gotoPublicationList(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/foundation/newsletters?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Newsletter Publication List — Structural Tests', () => {
  test.describe('Card root + persistent chrome', () => {
    test('renders the card root and the All newsletters link regardless of publication count', async ({ page }) => {
      await setPersonaCookie(page, ['executive-director']);
      await stubBackend(page, []);
      await gotoPublicationList(page);

      await expect(page.getByTestId('newsletter-publication-list-card')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
      await expect(page.getByTestId('newsletter-publication-list-all-link')).toBeAttached();
    });

    test("hides the header 'New publication' button when the project has no publications", async ({ page }) => {
      await setPersonaCookie(page, ['executive-director']);
      await stubBackend(page, []);
      await gotoPublicationList(page);

      await expect(page.getByTestId('newsletter-publication-list-empty-state')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
      await expect(page.getByTestId('newsletter-publication-list-new-button')).toHaveCount(0);
    });

    test("shows the header 'New publication' button once at least one publication exists", async ({ page }) => {
      await setPersonaCookie(page, ['executive-director']);
      await stubBackend(page, [buildPublication()]);
      await gotoPublicationList(page);

      await expect(page.locator('[data-testid^="newsletter-publication-row-"]')).toHaveCount(1, { timeout: PAGE_LOAD_TIMEOUT });
      await expect(page.getByTestId('newsletter-publication-list-new-button')).toBeAttached();
    });

    test("hides the header 'New publication' button after a failed load, alongside the empty state", async ({ page }) => {
      await setPersonaCookie(page, ['executive-director']);
      await stubBackendFailed(page);
      await gotoPublicationList(page);

      await expect(page.getByTestId('newsletter-publication-list-error-state')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
      await expect(page.getByTestId('newsletter-publication-list-new-button')).toHaveCount(0);
      await expect(page.getByTestId('newsletter-publication-list-empty-state')).toHaveCount(0);
    });
  });

  test.describe('Create-publication dialog', () => {
    test.beforeEach(async ({ page }) => {
      await setPersonaCookie(page, ['executive-director']);
      await stubBackend(page, []);
      await gotoPublicationList(page);
      await expect(page.getByTestId('newsletter-publication-list-empty-state')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
      // Scoped role, no name filter: this file asserts the testid contract
      // isolated from copy changes (see this file's own docstring) — a
      // getByRole(..., { name: 'Create publication' }) filter would make
      // this whole block break on a copy change too, same as the content
      // spec, defeating the split. Scoping to the empty-state testid is what
      // keeps the query unambiguous without needing the label text.
      await page.getByTestId('newsletter-publication-list-empty-state').getByRole('button').click();
    });

    // Presence/nesting only — the content spec (newsletter-publication-list.spec.ts)
    // exercises the actual create round trip, the 409 failure copy, and the
    // field-disable-while-submitting behavior; this file only pins that the
    // testid contract those tests (and any future one) can rely on is stable.
    test('attaches the dialog and its name field, cancel, and submit testids', async ({ page }) => {
      await expect(page.getByTestId('create-publication-dialog')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
      await expect(page.getByTestId('create-publication-name-input')).toBeAttached();
      await expect(page.getByTestId('create-publication-cancel')).toBeAttached();
      await expect(page.getByTestId('create-publication-submit')).toBeAttached();
      // Not attached until a create attempt actually fails.
      await expect(page.getByTestId('create-publication-error')).toHaveCount(0);
    });

    test('attaches the inline error testid once a create attempt fails', async ({ page }) => {
      await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletter-publications*`, (route) => {
        if (route.request().method() === 'POST') {
          return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal error' }) });
        }
        return route.fallback();
      });

      // Chained under the element's own testid, not getByLabel: this file's
      // whole point is to stay copy-independent (see the docstring at the
      // top), and the "Name" label text is exactly the kind of change the
      // content spec exists to catch instead. The testid lands on the
      // <lfx-input-text> host, not the input itself (input-text.component.html
      // forwards its own [id] onto the native <input>, but that's a separate
      // binding from the host's data-testid), so .fill() needs the descendant
      // native input, reached by chaining under the host testid rather than a
      // raw #id selector.
      await page.getByTestId('create-publication-name-input').locator('input').fill('Weekly Digest');
      await page.getByTestId('create-publication-submit').click();

      await expect(page.getByTestId('create-publication-error')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
    });
  });

  test.describe('Empty state', () => {
    test.beforeEach(async ({ page }) => {
      await setPersonaCookie(page, ['executive-director']);
      await stubBackend(page, []);
      await gotoPublicationList(page);
      await expect(page.getByTestId('newsletter-publication-list-empty-state')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
    });

    test('renders exactly one empty-state node and zero rows', async ({ page }) => {
      await expect(page.getByTestId('newsletter-publication-list-empty-state')).toHaveCount(1);
      await expect(page.locator('[data-testid^="newsletter-publication-row-"]')).toHaveCount(0);
    });
  });

  test.describe('Populated rows', () => {
    const DEFAULT_ID = MOCK_PUBLICATION_ID;
    const OTHER_ID = MOCK_PUBLICATION_ID_2;

    test.beforeEach(async ({ page }) => {
      await setPersonaCookie(page, ['executive-director']);
      await stubBackend(page, [
        buildPublication({ id: DEFAULT_ID }),
        buildPublication({ id: OTHER_ID, slug: 'release-notes', name: 'Release Notes', is_default: false }),
      ]);
      await gotoPublicationList(page);
      await expect(page.locator('[data-testid^="newsletter-publication-row-"]')).toHaveCount(2, { timeout: PAGE_LOAD_TIMEOUT });
    });

    test('renders one row per publication and hides the empty state', async ({ page }) => {
      await expect(page.getByTestId(`newsletter-publication-row-${DEFAULT_ID}`)).toBeAttached();
      await expect(page.getByTestId(`newsletter-publication-row-${OTHER_ID}`)).toBeAttached();
      await expect(page.getByTestId('newsletter-publication-list-empty-state')).toHaveCount(0);
    });

    test('nests the default badge inside its own row only, per dynamic id suffix', async ({ page }) => {
      const defaultRow = page.getByTestId(`newsletter-publication-row-${DEFAULT_ID}`);
      const otherRow = page.getByTestId(`newsletter-publication-row-${OTHER_ID}`);

      await expect(defaultRow.getByTestId(`publication-default-badge-${DEFAULT_ID}`)).toBeAttached();
      await expect(otherRow.getByTestId(`publication-default-badge-${OTHER_ID}`)).toHaveCount(0);
      // The badge testid is scoped to its own row's id — asserting against the
      // whole page (not just within otherRow) that no cross-row testid leaked.
      await expect(page.getByTestId(`publication-default-badge-${OTHER_ID}`)).toHaveCount(0);
    });

    // Only the role/tabindex contract, not the actual keydown handlers — those
    // are pinned by the content spec's "Enter activates a publication row" /
    // "Space activates a publication row" cases, which assert the resulting
    // navigation, not just the attributes that make the element focusable.
    test('each row exposes a focusable button role via role/tabindex', async ({ page }) => {
      const row = page.getByTestId(`newsletter-publication-row-${DEFAULT_ID}`);
      await expect(row).toHaveAttribute('role', 'button');
      await expect(row).toHaveAttribute('tabindex', '0');
    });
  });
});
