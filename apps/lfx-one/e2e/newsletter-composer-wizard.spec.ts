// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Block Composer in the creation wizard — Phase 1 (LFXV2-2385).
 *
 * Phase 1 replaced the wizard's rich-text body editor with the block composer,
 * so the ED composes a structured `body_layout` instead of raw HTML. This spec
 * locks in the two behaviours that integration introduced (the composer's own
 * palette/canvas mechanics are covered by the component itself):
 *   - Reopening a draft that carries a `body_layout` hydrates the composer in
 *     the Content step (draft → form → initialLayout → canvas).
 *   - Adding a block and saving persists `body_layout` in the update payload.
 *
 * The manifest fetch is stubbed so the palette is deterministic and independent
 * of the committed asset / template repo.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type {
  LensItem,
  Newsletter,
  NewsletterLayout,
  NewsletterListResponse,
  NewsletterTemplateManifest,
  PersistedPersonaState,
  PersonaType,
  UpdateNewsletterRequest,
} from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-000000000001';
const MOCK_NEWSLETTER_ID = 'n0000000-0000-0000-0000-000000000ccc';
const MOCK_COMMITTEE_UID = 'c0000000-0000-0000-0000-000000000bbb';

const MOCK_FOUNDATION_ITEM: LensItem = {
  uid: MOCK_FOUNDATION_UID,
  slug: MOCK_FOUNDATION_SLUG,
  name: 'Test Foundation',
  logoUrl: null,
  isFoundation: true,
};

// A small, deterministic manifest: one plain block plus a second to add.
const MOCK_MANIFEST: NewsletterTemplateManifest = {
  wrapper_key: 'default',
  blocks: [
    {
      block_type: 'intro_paragraph',
      label: 'Intro Paragraph',
      category: 'block',
      schema: { text: { type: 'richtext', label: 'Text' } },
      template: '<richtext field="text" class="body" />',
    },
    {
      block_type: 'sponsored_ad',
      label: 'Sponsored Ad',
      category: 'block',
      schema: { headline: { type: 'text', label: 'Headline' } },
      template: '<heading class="title">{{headline}}</heading>',
    },
  ],
};

// A draft that already carries a composed layout, so reopen exercises hydration.
const DRAFT_LAYOUT: NewsletterLayout = {
  wrapper_key: 'default',
  blocks: [{ block_type: 'intro_paragraph', content: { text: 'Hello from the saved draft' } }],
};

// A draft whose layout nests a child inside a container block. Reopen must keep
// the nested child even though hydration runs before the manifest resolves —
// container-ness is derived from the persisted `blocks` array, not the manifest.
const CONTAINER_DRAFT_LAYOUT: NewsletterLayout = {
  wrapper_key: 'default',
  blocks: [
    {
      block_type: 'mlops_community',
      content: {},
      blocks: [{ block_type: 'intro_paragraph', content: { text: 'Nested child survives reopen' } }],
    },
  ],
};

function buildProjectStub() {
  return {
    uid: MOCK_FOUNDATION_UID,
    slug: MOCK_FOUNDATION_SLUG,
    name: 'Test Foundation',
    description: 'Test foundation for newsletter composer wizard specs',
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

function buildDraft(overrides: Partial<Newsletter> = {}): Newsletter {
  return {
    id: MOCK_NEWSLETTER_ID,
    project_uid: MOCK_FOUNDATION_UID,
    subject: 'Launch week recap',
    body_html: '<p>Hello from the saved draft</p>',
    body_layout: DRAFT_LAYOUT,
    ed_reply_email: 'ed@example.com',
    committee_uids: [MOCK_COMMITTEE_UID],
    status: 'draft',
    total_recipients: 0,
    created_by: 'test-user',
    version: 1,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

// Two libraries so the picker has a real choice to switch between; the manifest
// stub returns the same deterministic palette for either key.
const MOCK_TEMPLATES = [
  { key: 'aaif-user-community', label: 'AAIF User Community' },
  { key: 'jim-community', label: 'Jim Community' },
];

async function stubManifest(page: Page): Promise<void> {
  await page.route('**/api/projects/*/newsletters/templates/*/manifest', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MANIFEST) })
  );
  // The library catalog (no `/manifest` suffix — a distinct route). Registered
  // after the manifest route; the glob ends at `/templates`, so the manifest
  // URL's extra segments never match this one.
  await page.route('**/api/projects/*/newsletters/templates', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: MOCK_TEMPLATES }) })
  );
}

async function stubPersona(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true }),
    })
  );
}

async function stubNavLensItems(page: Page): Promise<void> {
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

async function stubProjectApi(page: Page): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_SLUG}*`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildProjectStub()) })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sfid: null }) }));
}

async function stubCommittees(page: Page): Promise<void> {
  await page.route('**/api/committees*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ uid: MOCK_COMMITTEE_UID, name: 'Technical Steering Committee', category: 'Technical' }]),
    })
  );
}

async function stubRecipientCount(page: Page): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/recipient-count`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 42 }) })
  );
}

// Serve the draft on GET and echo an updated draft on PUT. The PUT handler mirrors
// the backend's render-on-write: it derives body_html and returns the body_layout
// the client sent, so downstream form state stays consistent.
async function stubNewsletterDraft(page: Page): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/${MOCK_NEWSLETTER_ID}`, (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildDraft()) });
    }
    if (method === 'PUT') {
      const payload = route.request().postDataJSON() as UpdateNewsletterRequest;
      const updated = buildDraft({ version: 2, body_layout: payload.body_layout, body_html: '<p>server-rendered</p>' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) });
    }
    return route.fallback();
  });

  const listResponse: NewsletterListResponse = { newsletters: [buildDraft()], next_page_token: undefined };
  await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters*`, (route) => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname.endsWith('/newsletters')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listResponse) });
    }
    return route.fallback();
  });
}

async function setPersonaCookie(page: Page): Promise<void> {
  const state: PersistedPersonaState = {
    primary: 'executive-director' as PersonaType,
    all: ['executive-director'] as PersonaType[],
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

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

// Reopen the draft (lands on the Review screen) then jump into the Content step
// via the per-section Edit affordance, where the composer lives.
async function gotoContentStep(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/foundation/newsletters/${MOCK_FOUNDATION_UID}/${MOCK_NEWSLETTER_ID}/edit?project=${MOCK_FOUNDATION_SLUG}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page).not.toHaveURL(/auth0\.com/);

  await expect(page.getByTestId('newsletter-review')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await page.getByTestId('newsletter-review-content-edit-btn').click();
  await expect(page.getByTestId('newsletter-manage-stepper')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
}

test.describe('Newsletter composer in the wizard — Phase 1', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page);
    await stubPersona(page);
    await stubNavLensItems(page);
    await stubProjectApi(page);
    await stubCommittees(page);
    await stubRecipientCount(page);
    await stubManifest(page);
    await stubNewsletterDraft(page);
  });

  test('reopening a draft hydrates the composer from body_layout', async ({ page }) => {
    await gotoContentStep(page);

    // The composer mounts inside the Content step and rehydrates the saved layout.
    await expect(page.getByTestId('newsletter-composer')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-composer-block-intro_paragraph')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    // The empty-canvas placeholder must not show when a layout hydrated.
    await expect(page.getByTestId('newsletter-composer-canvas-empty')).toHaveCount(0);
  });

  test('reopening a container draft keeps its nested children', async ({ page }) => {
    // Serve a draft whose layout nests a child inside a container. Registered in
    // the test so it takes precedence over the beforeEach draft stub.
    await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/${MOCK_NEWSLETTER_ID}`, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildDraft({ body_layout: CONTAINER_DRAFT_LAYOUT })) });
      }
      return route.fallback();
    });

    await gotoContentStep(page);

    // The container hydrated as a container (children preserved), so the nested
    // child renders inside it — the regression the manifest-independent
    // container detection guards against (children were previously dropped when
    // hydration ran before the manifest loaded).
    await expect(page.getByTestId('newsletter-composer-block-mlops_community')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-composer-child-intro_paragraph')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-composer-canvas-empty')).toHaveCount(0);
  });

  test('adding a block persists body_layout in the update payload', async ({ page }) => {
    await gotoContentStep(page);
    await expect(page.getByTestId('newsletter-composer-block-intro_paragraph')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Adding a block from the palette appends it to the canvas and updates the
    // form's body_layout. Blocks is the default active tab, so the palette is
    // already visible — no need to click the rail tab (clicking the active tab
    // now toggles the panel collapsed).
    const paletteItem = page.getByTestId('newsletter-composer-palette-item-sponsored_ad');
    await expect(paletteItem).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await paletteItem.click();
    await expect(page.getByTestId('newsletter-composer-block-sponsored_ad')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Saving flushes the composed layout to the update endpoint. The PUT body must
    // carry body_layout with both blocks — this is the Phase 1 persistence contract.
    const [request] = await Promise.all([
      page.waitForRequest(
        (req) => req.method() === 'PUT' && req.url().includes(`/newsletters/${MOCK_NEWSLETTER_ID}`) && JSON.stringify(req.postDataJSON()).includes('sponsored_ad'),
        { timeout: ELEMENT_TIMEOUT }
      ),
      page.getByTestId('newsletter-manage-draft-btn').click(),
    ]);

    const payload = request.postDataJSON() as UpdateNewsletterRequest;
    expect(payload.body_layout).toBeTruthy();
    const blockTypes = (payload.body_layout?.blocks ?? []).map((b) => b.block_type);
    expect(blockTypes).toContain('intro_paragraph');
    expect(blockTypes).toContain('sponsored_ad');
    // The layout records the selected block library so the server renders from it.
    expect(payload.body_layout?.template_key).toBeTruthy();
  });

  test('switching to the simple editor confirms before discarding in-session blocks', async ({ page }) => {
    // Open a draft with no saved body, so it starts on an empty Blocks canvas —
    // the initial layout has zero blocks, which is exactly the case where a
    // frozen initial-layout read would wrongly skip the discard confirm.
    await page.route(`**/api/projects/${MOCK_FOUNDATION_UID}/newsletters/${MOCK_NEWSLETTER_ID}`, (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildDraft({ body_layout: undefined, body_html: '' })) });
      }
      return route.fallback();
    });

    await gotoContentStep(page);
    await expect(page.getByTestId('newsletter-content-editor-toggle')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Build a block in-session (not present in the loaded draft).
    const paletteItem = page.getByTestId('newsletter-composer-palette-item-sponsored_ad');
    await expect(paletteItem).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await paletteItem.click();
    await expect(page.getByTestId('newsletter-composer-block-sponsored_ad')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Switching to Simple must confirm first — the in-session block would be lost.
    await page.getByTestId('newsletter-content-editor-simple').click();
    await expect(page.getByText('Switching to the simple editor discards')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Accepting swaps to the rich-text body and clears the blocks.
    await page.getByRole('button', { name: 'Switch' }).click();
    await expect(page.getByTestId('newsletter-content-body')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-composer-block-sponsored_ad')).toHaveCount(0);
  });

  test('clicking the active rail tab collapses and re-opens its panel', async ({ page }) => {
    await gotoContentStep(page);
    // Blocks is active by default, so its panel body is visible.
    await expect(page.getByTestId('newsletter-composer-panel')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // A second click on the active Blocks tab collapses the panel (the rail stays).
    await page.getByTestId('newsletter-composer-tab-blocks').click();
    await expect(page.getByTestId('newsletter-composer-panel')).toHaveCount(0);
    await expect(page.getByTestId('newsletter-composer-rail')).toBeVisible();

    // A third click re-opens it.
    await page.getByTestId('newsletter-composer-tab-blocks').click();
    await expect(page.getByTestId('newsletter-composer-panel')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('the Fields sidebar minimizes to a re-open strip and restores', async ({ page }) => {
    await gotoContentStep(page);
    // The Fields header (with its minimize control) is present by default.
    await expect(page.getByTestId('newsletter-composer-fields-collapse')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.getByTestId('newsletter-composer-fields-collapse').click();
    await expect(page.getByTestId('newsletter-composer-fields-expand')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-composer-fields-collapse')).toHaveCount(0);

    await page.getByTestId('newsletter-composer-fields-expand').click();
    await expect(page.getByTestId('newsletter-composer-fields-collapse')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('switching the block library clears the canvas after confirmation', async ({ page }) => {
    await gotoContentStep(page);
    // The reopened draft hydrates one block, and the library picker is present.
    await expect(page.getByTestId('newsletter-composer-block-intro_paragraph')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-composer-library-select')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Switching libraries with blocks present prompts a confirm; accept it.
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByTestId('newsletter-composer-library-select').locator('.p-select, [role="combobox"]').first().click();
    await page.getByRole('option', { name: 'Jim Community', exact: true }).click();

    // The canvas is cleared, since block types can differ between libraries.
    await expect(page.getByTestId('newsletter-composer-block-intro_paragraph')).toHaveCount(0);
    await expect(page.getByTestId('newsletter-composer-canvas-empty')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });
});
