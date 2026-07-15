// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Marketing Ops UI Access — LFXV2-2236.
 *
 * Verifies the FGA-guarded Marketing surfaces (Marketing section, Marketing Impact, Campaigns,
 * and the dashboard Marketing Overview section) respect the per-project grant matrix:
 *
 *   marketing_auditor (read) ⇒ Marketing section + Marketing Impact   (ED / Marketing Ops / Marketing Auditor)
 *   campaign_manager  (manage) ⇒ Campaigns + Marketing Overview        (ED / Marketing Ops only)
 *
 * Visibility is driven by the per-context access signals (client-side, post-hydration); route
 * denials are driven by the FGA route guards (fail closed → redirect to /foundation/overview).
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import type { LensItem, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const SIDEBAR_LOAD_TIMEOUT = 20_000;
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

const SIDEBAR = {
  marketingSection: 'sidebar-item-marketing',
  marketingImpact: 'sidebar-marketing-impact',
  campaigns: 'sidebar-marketing-campaigns',
};

// Root section of the Marketing Overview dashboard component (marketing-overview.component.html:4).
const MARKETING_OVERVIEW_SECTION = 'ed-evolution-section';

interface MarketingGrants {
  marketingAuditor?: boolean;
  campaignManager?: boolean;
}

function buildProjectStub(slug: string, writer: boolean, marketing?: MarketingGrants) {
  return {
    uid: MOCK_FOUNDATION_UID,
    slug,
    name: 'Test Foundation',
    description: 'Test foundation for marketing access regression tests',
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
    writer,
    marketingAuditor: marketing?.marketingAuditor ?? false,
    campaignManager: marketing?.campaignManager ?? false,
  };
}

async function stubPersona(page: Page, personas: string[], isRootMarketingAuditor = false): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas,
        personaProjects: {},
        projects: [],
        organizations: [],
        isRootWriter: false,
        isRootMarketingAuditor,
      }),
    })
  );
}

async function stubNavLensItems(page: Page): Promise<void> {
  await page.route('**/api/nav/lens-items*', (route) => {
    const url = route.request().url();
    if (!url.includes('lens=foundation')) {
      const requestedLens = new URL(url).searchParams.get('lens') ?? 'foundation';
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

async function stubProjectApi(page: Page, slug: string, writer: boolean, marketing?: MarketingGrants): Promise<void> {
  await page.route(`**/api/projects/${slug}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildProjectStub(slug, writer, marketing)),
    })
  );
  await page.route('**/api/projects/*/sfid*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sfid: null }),
    })
  );
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

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    /* Malformed URL — let the test surface the failure naturally. */
  }
}

async function gotoAndWaitForSidebar(page: Page, url: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  await expect(page.getByTestId('sidebar'), `[${url}] sidebar should be visible`).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
  await expect(page.getByTestId('sidebar-menu-loading'), `[${url}] sidebar loading skeleton should disappear`).toHaveCount(0, {
    timeout: SIDEBAR_LOAD_TIMEOUT,
  });
}

async function gotoRoute(page: Page, url: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

// ─── US1: Find a project and view its marketing dashboards ──────────────────────

test.describe('US1: Marketing Ops (non-ED) — marketing_auditor + campaign_manager', () => {
  test.beforeEach(async ({ page }) => {
    await stubPersona(page, ['contributor'], /* isRootMarketingAuditor */ true);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false, { marketingAuditor: true, campaignManager: true });
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);
  });

  test('foundation lens is available and the Marketing section + entries are visible', async ({ page }) => {
    // Successfully rendering the Marketing section on /foundation/overview proves the foundation
    // lens is active — which for a non-board persona requires isRootMarketingAuditor to be honored.
    await expect(page.getByTestId(SIDEBAR.marketingSection), 'marketing ops lens=foundation section=marketing').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(SIDEBAR.marketingImpact), 'marketing ops lens=foundation item=marketing-impact').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(SIDEBAR.campaigns), 'marketing ops lens=foundation item=campaigns').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });
});

test.describe('US1: Marketing Auditor — marketing_auditor only (no campaign_manager)', () => {
  test.beforeEach(async ({ page }) => {
    await stubPersona(page, ['contributor'], /* isRootMarketingAuditor */ true);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false, { marketingAuditor: true, campaignManager: false });
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);
  });

  test('sees Marketing Impact (read-only) but NOT Campaigns', async ({ page }) => {
    await expect(page.getByTestId(SIDEBAR.marketingSection), 'auditor lens=foundation section=marketing').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(SIDEBAR.marketingImpact), 'auditor lens=foundation item=marketing-impact').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(SIDEBAR.campaigns), 'auditor lens=foundation item=campaigns should be absent').toHaveCount(0, { timeout: ELEMENT_TIMEOUT });
  });
});

test.describe('US1: non-granted project — no marketing_auditor', () => {
  test('hides the Marketing section', async ({ page }) => {
    await stubPersona(page, ['contributor'], /* isRootMarketingAuditor */ true);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false, { marketingAuditor: false, campaignManager: false });
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);

    await expect(page.getByTestId(SIDEBAR.marketingSection), 'no grant ⇒ marketing section absent').toHaveCount(0, { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(SIDEBAR.marketingImpact), 'no grant ⇒ marketing impact absent').toHaveCount(0, { timeout: ELEMENT_TIMEOUT });
  });

  test('blocks /foundation/marketing-impact (redirects to overview)', async ({ page }) => {
    await stubPersona(page, ['contributor'], /* isRootMarketingAuditor */ true);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false, { marketingAuditor: false, campaignManager: false });
    await setPersonaCookie(page, ['contributor']);
    await gotoRoute(page, `/foundation/marketing-impact?project=${MOCK_FOUNDATION_SLUG}`);

    await expect(page, 'no marketing_auditor ⇒ blocked from Marketing Impact').toHaveURL(/\/foundation\/overview/, { timeout: ELEMENT_TIMEOUT });
  });
});

// ─── US2: Manage campaigns for authorized projects ──────────────────────────────

test.describe('US2: Campaigns access — campaign_manager gates the surface', () => {
  test('Marketing Ops (campaign_manager) sees the Campaigns entry', async ({ page }) => {
    await stubPersona(page, ['contributor'], /* isRootMarketingAuditor */ true);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false, { marketingAuditor: true, campaignManager: true });
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);

    await expect(page.getByTestId(SIDEBAR.campaigns), 'campaign_manager ⇒ campaigns entry visible').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('Marketing Auditor (no campaign_manager) is blocked from /foundation/campaigns', async ({ page }) => {
    await stubPersona(page, ['contributor'], /* isRootMarketingAuditor */ true);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false, { marketingAuditor: true, campaignManager: false });
    await setPersonaCookie(page, ['contributor']);
    await gotoRoute(page, `/foundation/campaigns?project=${MOCK_FOUNDATION_SLUG}`);

    await expect(page, 'auditor lacks campaign_manager ⇒ blocked from Campaigns').toHaveURL(/\/foundation\/overview/, { timeout: ELEMENT_TIMEOUT });
  });
});

// ─── US3: Dashboard Marketing Overview section ──────────────────────────────────

test.describe('US3: dashboard Marketing Overview — campaign_manager gated', () => {
  test('ED with campaign_manager sees the Marketing Overview section', async ({ page }) => {
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, true, { marketingAuditor: true, campaignManager: true });
    await setPersonaCookie(page, ['executive-director']);
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);

    await expect(page.getByTestId(MARKETING_OVERVIEW_SECTION), 'campaign_manager ⇒ Marketing Overview visible').toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
  });

  test('user without campaign_manager does NOT see the Marketing Overview section', async ({ page }) => {
    await stubPersona(page, ['board-member']);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false, { marketingAuditor: false, campaignManager: false });
    await setPersonaCookie(page, ['board-member']);
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);

    await expect(page.getByTestId(MARKETING_OVERVIEW_SECTION), 'no campaign_manager ⇒ Marketing Overview absent').toHaveCount(0, { timeout: ELEMENT_TIMEOUT });
  });
});
