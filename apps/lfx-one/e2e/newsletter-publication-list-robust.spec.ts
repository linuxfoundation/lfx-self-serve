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
    const DEFAULT_ID = 'p0000000-0000-0000-0000-000000000001';
    const OTHER_ID = 'p0000000-0000-0000-0000-000000000002';

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
    // are pinned by the content spec's "Enter activates a publication row"
    // case, which asserts the resulting navigation, not just the attributes
    // that make the element focusable.
    test('each row exposes a focusable button role via role/tabindex', async ({ page }) => {
      const row = page.getByTestId(`newsletter-publication-row-${DEFAULT_ID}`);
      await expect(row).toHaveAttribute('role', 'button');
      await expect(row).toHaveAttribute('tabindex', '0');
    });
  });
});
