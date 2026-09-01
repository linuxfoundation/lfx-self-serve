// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Marketing Ops UI Access — LFXV2-2235 / LFXV2-2236.
 *
 * Verifies the dual client+server flag-gated `marketing_auditor` / `campaign_manager` root-scoped
 * grants added on top of the existing ED/LF-staff gating:
 *
 *   marketing_auditor  ⇒ Marketing section + full Marketing Impact access (ED / marketing_auditor)
 *   campaign_manager   ⇒ Campaigns                                        (ED / campaign_manager)
 *
 * The client flag (`marketing-ops-fga-enabled`) is pinned per-test via the non-production-only
 * localStorage override (`FEATURE_FLAG_OVERRIDE_STORAGE_KEY`) — see feature-flag.service.ts. This
 * keeps the suite hermetic: no real LaunchDarkly targeting is required, unlike org-lens-access.spec.ts.
 * The `/api/user/personas` route is stubbed directly, so the server-side `LFX_MARKETING_OPS_FGA_ENABLED`
 * env var (which only gates what the *real* endpoint computes) plays no role here — the stub controls
 * `isMarketingAuditor` / `isCampaignManager` on the response independent of that env var.
 *
 * Coverage (all "Flag" references below are the CLIENT flag — see the note above):
 *   S1  Flag ON  — marketing_auditor (contributor) sees Marketing section + Marketing Impact, no Campaigns
 *   S2  Flag ON  — marketing_auditor gets full Marketing Impact tabs (not the Social-Listening-only view)
 *   S3  Flag ON  — campaign_manager (contributor) additionally sees Campaigns in the sidebar
 *   S4  Flag ON  — campaign_manager route guard passes on /foundation/campaigns
 *   S5  Flag ON  — plain contributor (no grants) sees neither Marketing section nor Campaigns
 *   S6  Flag ON  — contributor without campaign_manager is redirected off /foundation/campaigns
 *   S7  Flag ON  — LF Staff stays Social-Listening-only on Marketing Impact even with marketing_auditor-equivalent access already granted via canViewExecutiveDashboards
 *   S8  Flag OFF (default) — grants present on the API response are ignored; behavior is byte-identical to pre-LFXV2-2236 ED/LF-staff-only gating
 *   S9  Flag ON  — marketing_auditor + campaign_manager grants do not unlock Health Metrics (ED/LF-Staff-only, LFXV2-2237)
 *   S10 Flag ON  — hybrid marketing_auditor (contributor + marketing grant) sees Marketing section under Project lens too, not just Foundation (LFXV2-2235)
 *
 * This suite does NOT flip the server `LFX_MARKETING_OPS_FGA_ENABLED` env var or hit protected
 * analytics/campaigns routes directly — see `require-marketing-access.middleware.spec.ts` for
 * the server-side flag-on/flag-off matrix (ED fast path, scoped-ED, root/project FGA cascade,
 * fail-closed) against the real middleware.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import type { LensItem, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MARKETING_OPS_FGA_ENABLED_FLAG, PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const SIDEBAR_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const MOCK_FOUNDATION_SLUG = 'test-foundation';

const MOCK_FOUNDATION_ITEM: LensItem = {
  uid: 'f0000000-0000-0000-0000-000000000001',
  slug: MOCK_FOUNDATION_SLUG,
  name: 'Test Foundation',
  logoUrl: null,
  isFoundation: true,
};

const SIDEBAR = {
  marketingSection: 'sidebar-item-marketing',
  marketingImpact: 'sidebar-marketing-impact',
  campaigns: 'sidebar-marketing-campaigns',
  healthMetrics: 'sidebar-metrics-health-metrics',
};

const CAMPAIGNS_PAGE = 'campaigns-page';
const MARKETING_IMPACT_PAGE = 'marketing-impact-page';

function buildProjectStub(slug: string, writer: boolean) {
  return {
    uid: MOCK_FOUNDATION_ITEM.uid,
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
  };
}

interface StubPersonaOptions {
  isLFStaff?: boolean;
  isMarketingAuditor?: boolean;
  isCampaignManager?: boolean;
}

async function stubPersona(page: Page, personas: string[], options: StubPersonaOptions = {}): Promise<void> {
  const { isLFStaff = false, isMarketingAuditor = false, isCampaignManager = false } = options;
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
        isLFStaff,
        isMarketingAuditor,
        isCampaignManager,
      }),
    })
  );
}

async function stubNavLensItems(page: Page, items: LensItem[] = [MOCK_FOUNDATION_ITEM]): Promise<void> {
  await page.route('**/api/nav/lens-items*', (route) => {
    const url = route.request().url();
    const requestedLens = new URL(url).searchParams.get('lens') ?? 'foundation';
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
      body: JSON.stringify({ items, next_page_token: null, upstream_failed: false, lens: 'foundation' }),
    });
  });
}

async function stubProjectApi(page: Page, slug: string, writer: boolean): Promise<void> {
  await page.route(`**/api/projects/${slug}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildProjectStub(slug, writer)),
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

/** See persona-navigation.spec.ts's identically-named helper for the full rationale (SSR guard cookie seeding). */
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

/**
 * Pins the client `marketing-ops-fga-enabled` flag before any application code runs, via the
 * non-production-only localStorage override — see feature-flag.service.ts's `readFlagOverride`.
 * Without this, the guards/sidebar/component would evaluate against the real (default-off)
 * LaunchDarkly flag and every "flag ON" scenario below would silently fall through to the
 * flag-off behavior instead of exercising the new code path.
 */
async function stubMarketingOpsFlag(page: Page, enabled: boolean): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [MARKETING_OPS_FGA_ENABLED_FLAG]: enabled }),
  ] as const);
}

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — let the test surface the failure naturally.
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

// ─── S1-S2: marketing_auditor — Marketing Impact access, no Campaigns ─────────

test.describe('S1-S2: Foundation lens — marketing_auditor (flag ON, contributor persona)', () => {
  test.beforeEach(async ({ page }) => {
    await stubMarketingOpsFlag(page, true);
    await stubPersona(page, ['contributor'], { isMarketingAuditor: true });
    await setPersonaCookie(page, ['contributor']);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
    await gotoAndWaitForSidebar(page, `/foundation/marketing-impact?project=${MOCK_FOUNDATION_SLUG}`);
  });

  test('sees Marketing section with Marketing Impact but not Campaigns', async ({ page }) => {
    await expect(page.getByTestId(SIDEBAR.marketingSection), 'persona=marketing_auditor section=marketing').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.marketingImpact), 'persona=marketing_auditor item=marketing-impact').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.campaigns), 'persona=marketing_auditor item=campaigns should be hidden').toHaveCount(0);
  });

  test('Marketing Impact page shows full tabs, not the Social-Listening-only view', async ({ page }) => {
    await expect(page.getByTestId(MARKETING_IMPACT_PAGE), 'persona=marketing_auditor page=marketing-impact').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId('marketing-impact-social-listening-only'), 'persona=marketing_auditor social-listening-only should be hidden').toHaveCount(0);
    await expect(page.getByTestId('marketing-impact-focus-bar'), 'persona=marketing_auditor focus-bar should be visible').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

// ─── S3-S4: campaign_manager — Campaigns access ───────────────────────────────

test.describe('S3-S4: Foundation lens — campaign_manager (flag ON, contributor persona)', () => {
  test.beforeEach(async ({ page }) => {
    await stubMarketingOpsFlag(page, true);
    await stubPersona(page, ['contributor'], { isCampaignManager: true });
    await setPersonaCookie(page, ['contributor']);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
  });

  test('sees Campaigns in the sidebar', async ({ page }) => {
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);
    await expect(page.getByTestId(SIDEBAR.campaigns), 'persona=campaign_manager item=campaigns').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('route guard admits campaign_manager onto /foundation/campaigns', async ({ page }) => {
    await gotoAndWaitForSidebar(page, `/foundation/campaigns?project=${MOCK_FOUNDATION_SLUG}`);
    await expect(page.getByTestId(CAMPAIGNS_PAGE), 'persona=campaign_manager page=campaigns should render, not redirect').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

// ─── S5-S6: no grants — flag ON but ungranted contributor stays locked out ────

test.describe('S5-S6: Foundation lens — contributor with no marketing grants (flag ON)', () => {
  test.beforeEach(async ({ page }) => {
    await stubMarketingOpsFlag(page, true);
    await stubPersona(page, ['contributor']);
    await setPersonaCookie(page, ['contributor']);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
  });

  test('sees neither Marketing section nor Campaigns', async ({ page }) => {
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);
    await expect(page.getByTestId(SIDEBAR.marketingSection), 'persona=contributor(no-grants) section=marketing should be hidden').toHaveCount(0);
  });

  test('is redirected off /foundation/campaigns to /foundation/overview', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.goto(`/foundation/campaigns?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page, 'persona=contributor(no-grants) should be redirected away from campaigns').toHaveURL(/\/foundation\/overview/, {
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

// ─── S7: LF Staff stays Social-Listening-only regardless of the flag ──────────

test.describe('S7: Foundation lens — LF Staff (flag ON, no marketing_auditor grant)', () => {
  test.beforeEach(async ({ page }) => {
    await stubMarketingOpsFlag(page, true);
    await stubPersona(page, ['contributor'], { isLFStaff: true });
    await setPersonaCookie(page, ['contributor']);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
    await gotoAndWaitForSidebar(page, `/foundation/marketing-impact?project=${MOCK_FOUNDATION_SLUG}`);
  });

  test('Marketing Impact page still shows Social Listening only, not full tabs', async ({ page }) => {
    await expect(page.getByTestId('marketing-impact-social-listening-only'), 'persona=lf-staff social-listening-only should be visible').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId('marketing-impact-focus-bar'), 'persona=lf-staff focus-bar should be hidden').toHaveCount(0);
  });
});

// ─── S8: flag OFF — grants on the API response are inert (default-safe fallback) ──

test.describe('S8: Foundation lens — flag OFF (default) ignores marketing_auditor/campaign_manager grants', () => {
  test.beforeEach(async ({ page }) => {
    await stubMarketingOpsFlag(page, false);
    // Grants are true on the stub response — if the flag gating were broken, these would leak through.
    await stubPersona(page, ['contributor'], { isMarketingAuditor: true, isCampaignManager: true });
    await setPersonaCookie(page, ['contributor']);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
  });

  test('sidebar hides Marketing section and Campaigns despite granted API response', async ({ page }) => {
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);
    await expect(page.getByTestId(SIDEBAR.marketingSection), 'flag=off section=marketing should stay hidden').toHaveCount(0);
  });

  test('/foundation/campaigns still redirects to /foundation/overview despite granted API response', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.goto(`/foundation/campaigns?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page, 'flag=off campaign_manager grant should not bypass the guard').toHaveURL(/\/foundation\/overview/, { timeout: ELEMENT_TIMEOUT });
  });

  test('/foundation/marketing-impact shows Social-Listening-only view despite granted API response', async ({ page }) => {
    // A plain contributor has no route access to Marketing Impact at all while the flag is off
    // (the route still gates on canViewExecutiveDashboards) — grant LF Staff so this test actually
    // reaches the page, then verify the granted marketing_auditor flag doesn't unlock full tabs.
    await stubPersona(page, ['contributor'], { isLFStaff: true, isMarketingAuditor: true, isCampaignManager: true });

    await gotoAndWaitForSidebar(page, `/foundation/marketing-impact?project=${MOCK_FOUNDATION_SLUG}`);
    await expect(page.getByTestId('marketing-impact-social-listening-only'), 'flag=off marketing_auditor grant should not unlock full tabs').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

// ─── S9: marketing_auditor/campaign_manager grants do not unlock Health Metrics ──

test.describe('S9: Foundation lens — marketing_auditor + campaign_manager grants do not unlock Health Metrics (flag ON)', () => {
  test.beforeEach(async ({ page }) => {
    await stubMarketingOpsFlag(page, true);
    await stubPersona(page, ['contributor'], { isMarketingAuditor: true, isCampaignManager: true });
    await setPersonaCookie(page, ['contributor']);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
  });

  test('sidebar hides Health Metrics despite marketing_auditor/campaign_manager grants', async ({ page }) => {
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);
    await expect(
      page.getByTestId(SIDEBAR.healthMetrics),
      'persona=marketing_auditor+campaign_manager item=health-metrics should be hidden (ED/LF-Staff-only)'
    ).toHaveCount(0);
  });

  test('is redirected off /foundation/health-metrics to /foundation/overview', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.goto(`/foundation/health-metrics?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page, 'persona=marketing_auditor+campaign_manager should be redirected away from health-metrics').toHaveURL(/\/foundation\/overview/, {
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

// ─── S10: hybrid marketing_auditor also sees Marketing under Project lens ─────

test.describe('S10: Project lens — hybrid marketing_auditor (flag ON, contributor + marketing grant)', () => {
  test.beforeEach(async ({ page }) => {
    await stubMarketingOpsFlag(page, true);
    // A 'contributor' persona alone grants the project lens (project-scoped role); adding
    // isMarketingAuditor also grants the foundation lens via hasMarketingGrant — together these
    // make the user hybrid, reproducing the bug: the Marketing section must still surface from
    // Project lens, not just Foundation lens.
    await stubPersona(page, ['contributor'], { isMarketingAuditor: true });
    await setPersonaCookie(page, ['contributor']);
    await stubNavLensItems(page);
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
    await gotoAndWaitForSidebar(page, `/project/overview?project=${MOCK_FOUNDATION_SLUG}`);
  });

  test('sees Marketing section with Marketing Impact under Project lens', async ({ page }) => {
    await expect(page.getByTestId(SIDEBAR.marketingSection), 'persona=hybrid-marketing_auditor lens=project section=marketing').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.marketingImpact), 'persona=hybrid-marketing_auditor lens=project item=marketing-impact').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });
});
