// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

/**
 * Persona × Lens Navigation Regression — LFXV2-1661.
 *
 * Verifies that sidebar items and page content respect the persona × lens
 * matrix documented in docs/architecture/frontend/persona-content-matrix.md.
 *
 * Coverage:
 *   S1  Foundation lens — executive-director sees Metrics + Marketing sections
 *   S2  Foundation lens — board-member does NOT see Metrics / Marketing
 *   S3  Foundation lens — board-member with canWrite sees Newsletters
 *   S4  Foundation lens — board-member without canWrite hides Newsletters
 *   S5  Project lens — contributor without canWrite hides Newsletters
 *   S6  Project lens — contributor with canWrite sees Newsletters
 *   S7  Route guard — executiveDirectorGuard redirects non-ED to /foundation/overview
 *   S8  Route guard — executiveDirectorGuard passes for ED persona
 *   S9  Route guard — writerGuard redirects contributor without write access
 *   S10 Route guard — writerGuard passes for ED via synchronous fast path
 *   S11 Settings page — view-only banner shown to non-writer
 *   S12 Settings page — view-only banner hidden for writer
 *   S13 Settings lens redirect — me lens → /profile/settings (fragment preserved); foundation keeps prefixed route
 *   S14 Legacy transactions redirect — /me/transactions → /profile/transactions, embedded in the Profile shell
 *
 * Failure messages include the persona × lens × page combination so CI output
 * pinpoints the exact regression without digging through traces.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { LensItem, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

// ─── Timeouts ─────────────────────────────────────────────────────────────────

// Each test can do two full page navigations plus a 20s sidebar-load wait — the default
// 30s Playwright timeout is too tight on slow CI runners.
test.setTimeout(60_000);

const SIDEBAR_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

// ─── Test data ────────────────────────────────────────────────────────────────

const MOCK_FOUNDATION_SLUG = 'test-foundation';
const MOCK_PROJECT_SLUG = 'test-project';
const MOCK_PROJECT_UID = 'p0000000-0000-0000-0000-000000000001';

const MOCK_FOUNDATION_ITEM: LensItem = {
  uid: 'f0000000-0000-0000-0000-000000000001',
  slug: MOCK_FOUNDATION_SLUG,
  name: 'Test Foundation',
  logoUrl: null,
  isFoundation: true,
};

const MOCK_PROJECT_ITEM: LensItem = {
  uid: MOCK_PROJECT_UID,
  slug: MOCK_PROJECT_SLUG,
  name: 'Test Project',
  logoUrl: null,
  isFoundation: false,
};

function buildProjectStub(slug: string, writer: boolean) {
  return {
    uid: MOCK_PROJECT_UID,
    slug,
    name: 'Test Project',
    description: 'Test project for persona navigation regression tests',
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

// ─── Sidebar testIds ───────────────────────────────────────────────────────────
// Auto-generated pattern (sidebar.component.ts:91):
//   testId = item.testId || `sidebar-item-${item.label.toLowerCase().replace(/\s+/g, '-')}`
// Explicit testIds defined in main-layout.component.ts are noted with (explicit).

const SIDEBAR = {
  // Foundation + Project standard items (visible to all lens users)
  dashboard: 'sidebar-item-dashboard',
  meetings: 'sidebar-item-meetings',
  events: 'sidebar-item-events',
  mailingLists: 'sidebar-item-mailing-lists',
  groups: 'sidebar-item-groups',
  documents: 'sidebar-item-documents',
  // Governance section (section wrapper + children)
  governanceSection: 'sidebar-item-governance',
  votes: 'sidebar-item-votes',
  surveys: 'sidebar-item-surveys',
  permissions: 'sidebar-item-permissions',
  // Communications section — canSeeNewsletters() = ED OR canWrite()
  communicationsSection: 'sidebar-item-communications',
  foundationNewsletters: 'sidebar-foundation-newsletters', // explicit
  projectNewsletters: 'sidebar-project-newsletters', // explicit
  // Metrics section — executive-director only
  metricsSection: 'sidebar-item-metrics',
  healthMetrics: 'sidebar-metrics-health-metrics', // explicit
  // Marketing section — executive-director only
  marketingSection: 'sidebar-item-marketing',
  marketingImpact: 'sidebar-marketing-impact', // explicit
  campaigns: 'sidebar-marketing-campaigns', // explicit
};

// ─── Stub helpers ─────────────────────────────────────────────────────────────

async function stubPersona(page: Page, personas: string[], isRootWriter = false): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas,
        personaProjects: {},
        projects: [],
        organizations: [],
        isRootWriter,
      }),
    })
  );
}

async function stubNavLensItems(page: Page, lens: 'foundation' | 'project', items?: LensItem[]): Promise<void> {
  const resolvedItems = items ?? [lens === 'foundation' ? MOCK_FOUNDATION_ITEM : MOCK_PROJECT_ITEM];
  await page.route('**/api/nav/lens-items*', (route) => {
    const url = route.request().url();
    if (!url.includes(`lens=${lens}`)) {
      // Fulfill non-matching lens requests with empty items to keep the suite fully hermetic.
      // Echo the requested lens param back so NavigationService routing logic stays correct for
      // any lens value the app may prefetch (e.g. 'org', 'me'), not just 'foundation'/'project'.
      const requestedLens = new URL(url).searchParams.get('lens') ?? lens;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], next_page_token: null, upstream_failed: false, lens: requestedLens }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: resolvedItems, next_page_token: null, upstream_failed: false, lens }),
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
  // Stub the UID-based sfid lookup (ProjectContextService.selectedFoundationSfid).
  // Wildcard UID so both project (MOCK_PROJECT_UID) and foundation (MOCK_FOUNDATION_ITEM.uid)
  // sfid requests are intercepted — selectedFoundationSfid uses the foundation lens-item UID,
  // not the project UID.
  await page.route('**/api/projects/*/sfid*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sfid: null }),
    })
  );
}

/**
 * Seeds the SSR persona cookie so that Angular guards running server-side
 * (e.g. executiveDirectorGuard, writerGuard) read the correct persona from
 * the cookie rather than defaulting to 'contributor'.
 *
 * page.route() stubs only intercept browser-side XHR — they never reach the
 * SSR Node.js process. Seeding the cookie via page.context().addCookies()
 * causes Playwright to attach it to every request including the initial SSR
 * navigation, making guard tests hermetic.
 */
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
    // Malformed URL — let the test surface the failure naturally.
  }
}

/** Navigate to a page and wait for the sidebar to finish loading. */
async function gotoAndWaitForSidebar(page: Page, url: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  // Sidebar renders items only after lensLoaded() becomes true (loading skeleton disappears).
  await expect(page.getByTestId('sidebar'), `[${url}] sidebar should be visible`).toBeVisible({ timeout: SIDEBAR_LOAD_TIMEOUT });
  await expect(page.getByTestId('sidebar-menu-loading'), `[${url}] sidebar loading skeleton should disappear`).toHaveCount(0, {
    timeout: SIDEBAR_LOAD_TIMEOUT,
  });
}

// ─── S1–S4: Foundation lens ────────────────────────────────────────────────────

test.describe('S1: Foundation lens — executive-director persona', () => {
  test.beforeEach(async ({ page }) => {
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page, 'foundation');
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, true);
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);
  });

  test('shows standard navigation items (dashboard, meetings, events, mailing lists, groups, documents)', async ({ page }) => {
    for (const testId of [SIDEBAR.dashboard, SIDEBAR.meetings, SIDEBAR.events, SIDEBAR.mailingLists, SIDEBAR.groups, SIDEBAR.documents]) {
      await expect(page.getByTestId(testId), `persona=executive-director lens=foundation item=${testId}`).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    }
  });

  test('shows Governance section (votes, surveys, permissions)', async ({ page }) => {
    await expect(page.getByTestId(SIDEBAR.governanceSection), 'persona=executive-director lens=foundation section=governance').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.votes), 'persona=executive-director lens=foundation item=votes').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(SIDEBAR.surveys), 'persona=executive-director lens=foundation item=surveys').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(SIDEBAR.permissions), 'persona=executive-director lens=foundation item=permissions').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });

  test('shows Communications section with Newsletters (canSeeNewsletters = ED)', async ({ page }) => {
    await expect(page.getByTestId(SIDEBAR.communicationsSection), 'persona=executive-director lens=foundation section=communications').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.foundationNewsletters), 'persona=executive-director lens=foundation item=newsletters').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });

  test('shows Metrics section with Health Metrics (ED-only)', async ({ page }) => {
    await expect(page.getByTestId(SIDEBAR.metricsSection), 'persona=executive-director lens=foundation section=metrics').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.healthMetrics), 'persona=executive-director lens=foundation item=health-metrics').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });

  test('shows Marketing section with Marketing Impact and Campaigns (ED-only)', async ({ page }) => {
    await expect(page.getByTestId(SIDEBAR.marketingSection), 'persona=executive-director lens=foundation section=marketing').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.marketingImpact), 'persona=executive-director lens=foundation item=marketing-impact').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.campaigns), 'persona=executive-director lens=foundation item=campaigns').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });
});

test.describe('S2: Foundation lens — board-member persona (no Metrics, no Marketing)', () => {
  test.beforeEach(async ({ page }) => {
    await stubPersona(page, ['board-member']);
    await stubNavLensItems(page, 'foundation');
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);
  });

  test('shows standard navigation items', async ({ page }) => {
    for (const testId of [SIDEBAR.dashboard, SIDEBAR.meetings, SIDEBAR.events, SIDEBAR.mailingLists, SIDEBAR.groups, SIDEBAR.documents]) {
      await expect(page.getByTestId(testId), `persona=board-member lens=foundation item=${testId}`).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    }
  });

  test('shows Governance section', async ({ page }) => {
    await expect(page.getByTestId(SIDEBAR.governanceSection), 'persona=board-member lens=foundation section=governance').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });

  test('hides Metrics section (ED-only)', async ({ page }) => {
    await expect(page.getByTestId(SIDEBAR.metricsSection), 'persona=board-member lens=foundation section=metrics should be absent').toHaveCount(0, {
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.healthMetrics), 'persona=board-member lens=foundation item=health-metrics should be absent').toHaveCount(0, {
      timeout: ELEMENT_TIMEOUT,
    });
  });

  test('hides Marketing section (ED-only)', async ({ page }) => {
    await expect(page.getByTestId(SIDEBAR.marketingSection), 'persona=board-member lens=foundation section=marketing should be absent').toHaveCount(0, {
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.marketingImpact), 'persona=board-member lens=foundation item=marketing-impact should be absent').toHaveCount(0, {
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.campaigns), 'persona=board-member lens=foundation item=campaigns should be absent').toHaveCount(0, {
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

test.describe('S3: Foundation lens — board-member with canWrite sees Newsletters', () => {
  test('Communications section and Newsletters are visible when writer=true', async ({ page }) => {
    await stubPersona(page, ['board-member']);
    await stubNavLensItems(page, 'foundation');
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, true);
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);

    await expect(page.getByTestId(SIDEBAR.communicationsSection), 'persona=board-member canWrite=true lens=foundation section=communications').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.foundationNewsletters), 'persona=board-member canWrite=true lens=foundation item=newsletters').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

test.describe('S4: Foundation lens — board-member without canWrite hides Newsletters', () => {
  test('Communications section and Newsletters are hidden when writer=false', async ({ page }) => {
    await stubPersona(page, ['board-member']);
    await stubNavLensItems(page, 'foundation');
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);

    await expect(
      page.getByTestId(SIDEBAR.communicationsSection),
      'persona=board-member canWrite=false lens=foundation section=communications should be absent'
    ).toHaveCount(0, {
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(
      page.getByTestId(SIDEBAR.foundationNewsletters),
      'persona=board-member canWrite=false lens=foundation item=newsletters should be absent'
    ).toHaveCount(0, {
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

// ─── S5–S6: Project lens ───────────────────────────────────────────────────────

test.describe('S5: Project lens — contributor without canWrite hides Newsletters', () => {
  test('Communications section and Newsletters are hidden when writer=false', async ({ page }) => {
    await stubPersona(page, ['contributor']);
    await stubNavLensItems(page, 'project');
    await stubProjectApi(page, MOCK_PROJECT_SLUG, false);
    await gotoAndWaitForSidebar(page, `/project/overview?project=${MOCK_PROJECT_SLUG}`);

    await expect(
      page.getByTestId(SIDEBAR.communicationsSection),
      'persona=contributor canWrite=false lens=project section=communications should be absent'
    ).toHaveCount(0, {
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.projectNewsletters), 'persona=contributor canWrite=false lens=project item=newsletters should be absent').toHaveCount(
      0,
      {
        timeout: ELEMENT_TIMEOUT,
      }
    );
  });
});

test.describe('S6: Project lens — contributor with canWrite sees Newsletters', () => {
  test('Communications section and Newsletters are visible when writer=true', async ({ page }) => {
    await stubPersona(page, ['contributor']);
    await stubNavLensItems(page, 'project');
    await stubProjectApi(page, MOCK_PROJECT_SLUG, true);
    await gotoAndWaitForSidebar(page, `/project/overview?project=${MOCK_PROJECT_SLUG}`);

    await expect(page.getByTestId(SIDEBAR.communicationsSection), 'persona=contributor canWrite=true lens=project section=communications').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    await expect(page.getByTestId(SIDEBAR.projectNewsletters), 'persona=contributor canWrite=true lens=project item=newsletters').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

test.describe('S5b: Project lens — standard items visible to all project users', () => {
  test.beforeEach(async ({ page }) => {
    await stubPersona(page, ['contributor']);
    await stubNavLensItems(page, 'project');
    await stubProjectApi(page, MOCK_PROJECT_SLUG, false);
    await gotoAndWaitForSidebar(page, `/project/overview?project=${MOCK_PROJECT_SLUG}`);
  });

  test('shows standard navigation items (dashboard, meetings, mailing lists, groups, documents)', async ({ page }) => {
    for (const testId of [SIDEBAR.dashboard, SIDEBAR.meetings, SIDEBAR.mailingLists, SIDEBAR.groups, SIDEBAR.documents]) {
      await expect(page.getByTestId(testId), `persona=contributor lens=project item=${testId}`).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    }
  });

  test('shows Governance section (votes, surveys, permissions)', async ({ page }) => {
    await expect(page.getByTestId(SIDEBAR.governanceSection), 'persona=contributor lens=project section=governance').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(SIDEBAR.votes), 'persona=contributor lens=project item=votes').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(SIDEBAR.surveys), 'persona=contributor lens=project item=surveys').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId(SIDEBAR.permissions), 'persona=contributor lens=project item=permissions').toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });
});

// ─── S7–S10: Route guards ──────────────────────────────────────────────────────

test.describe('S7: Route guard — executiveDirectorGuard redirects non-ED', () => {
  test('board-member navigating to /foundation/health-metrics is redirected to /foundation/overview', async ({ page }) => {
    await stubPersona(page, ['board-member']);
    await stubNavLensItems(page, 'foundation');
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
    await setPersonaCookie(page, ['board-member']);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.goto(`/foundation/health-metrics?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // executiveDirectorGuard redirects to /foundation/overview
    await expect(page, 'persona=board-member should be redirected away from /foundation/health-metrics').toHaveURL(/\/foundation\/overview/, {
      timeout: ELEMENT_TIMEOUT,
    });
  });

  test('board-member navigating to /foundation/marketing-impact is redirected to /foundation/overview', async ({ page }) => {
    await stubPersona(page, ['board-member']);
    await stubNavLensItems(page, 'foundation');
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
    await setPersonaCookie(page, ['board-member']);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.goto(`/foundation/marketing-impact?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page, 'persona=board-member should be redirected away from /foundation/marketing-impact').toHaveURL(/\/foundation\/overview/, {
      timeout: ELEMENT_TIMEOUT,
    });
  });

  test('board-member navigating to /foundation/campaigns is redirected to /foundation/overview', async ({ page }) => {
    await stubPersona(page, ['board-member']);
    await stubNavLensItems(page, 'foundation');
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, false);
    await setPersonaCookie(page, ['board-member']);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.goto(`/foundation/campaigns?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page, 'persona=board-member should be redirected away from /foundation/campaigns').toHaveURL(/\/foundation\/overview/, {
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

test.describe('S8: Route guard — executiveDirectorGuard passes for ED persona', () => {
  test('ED navigating to /foundation/health-metrics is NOT redirected', async ({ page }) => {
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page, 'foundation');
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, true);
    await setPersonaCookie(page, ['executive-director']);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.goto(`/foundation/health-metrics?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page, 'persona=executive-director should remain on /foundation/health-metrics').toHaveURL(/\/foundation\/health-metrics/, {
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

test.describe('S9: Route guard — writerGuard redirects contributor without write access', () => {
  test('contributor (writer=false) navigating to /project/meetings/create is redirected to overview', async ({ page }) => {
    await stubPersona(page, ['contributor']);
    await stubNavLensItems(page, 'project');
    await stubProjectApi(page, MOCK_PROJECT_SLUG, false);
    await setPersonaCookie(page, ['contributor']);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.goto(`/project/meetings/create?project=${MOCK_PROJECT_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // writerGuard redirects to /project/overview when writer=false
    await expect(page, 'persona=contributor canWrite=false should be redirected away from /project/meetings/create').toHaveURL(/\/project\/overview/, {
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

test.describe('S10: Route guard — writerGuard fast path for ED persona', () => {
  test('ED (synchronous fast path) navigating to /project/meetings/create is NOT redirected', async ({ page }) => {
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page, 'project');
    await stubProjectApi(page, MOCK_PROJECT_SLUG, true);
    await setPersonaCookie(page, ['executive-director']);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.goto(`/project/meetings/create?project=${MOCK_PROJECT_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // writerGuard returns true synchronously for ED (no project API call needed)
    await expect(page, 'persona=executive-director should remain on /project/meetings/create').toHaveURL(/\/project\/meetings\/create/, {
      timeout: ELEMENT_TIMEOUT,
    });
  });
});

// ─── S11–S12: Settings page write-gating ──────────────────────────────────────

test.describe('S11: Settings / Permissions page — view-only banner for non-writer', () => {
  test('contributor (writer=false) sees view-only access banner on settings page', async ({ page }) => {
    await stubPersona(page, ['contributor']);
    await stubNavLensItems(page, 'project');
    await stubProjectApi(page, MOCK_PROJECT_SLUG, false);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.goto(`/project/settings?project=${MOCK_PROJECT_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(
      page.getByText('You have view-only access to this project'),
      'persona=contributor canWrite=false lens=project page=settings should show view-only banner'
    ).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });
});

test.describe('S12: Settings / Permissions page — no banner for writer', () => {
  test('contributor (writer=true) does NOT see view-only banner on settings page', async ({ page }) => {
    await stubPersona(page, ['contributor']);
    await stubNavLensItems(page, 'project');
    await stubProjectApi(page, MOCK_PROJECT_SLUG, true);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.goto(`/project/settings?project=${MOCK_PROJECT_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(
      page.getByText('You have view-only access to this project'),
      'persona=contributor canWrite=true lens=project page=settings should NOT show view-only banner'
    ).toHaveCount(0, { timeout: ELEMENT_TIMEOUT });
  });
});

// ─── S13: Settings lens redirect (settingsLensRedirectGuard) ───────────────────

test.describe('S13: Settings lens redirect — me lens → /profile/settings', () => {
  test('me lens redirects /settings?src=nav#developer-settings to /profile/settings preserving query + fragment', async ({ page }) => {
    await stubPersona(page, ['contributor']);
    await setPersonaCookie(page, ['contributor']);

    // Me lens is the default; no project context needed.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.goto('/settings?src=nav#developer-settings', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // settingsLensRedirectGuard maps me-lens /settings → /profile/settings, carrying both the query
    // param and the fragment through so the header's Developer Settings anchor link still lands right.
    await expect(page, 'me lens should redirect /settings to /profile/settings with ?src=nav and #developer-settings preserved').toHaveURL(
      /\/profile\/settings\?src=nav#developer-settings$/,
      { timeout: ELEMENT_TIMEOUT }
    );
  });

  test('foundation lens keeps the lens-prefixed /foundation/settings route', async ({ page }) => {
    await stubPersona(page, ['executive-director']);
    await stubNavLensItems(page, 'foundation');
    await stubProjectApi(page, MOCK_FOUNDATION_SLUG, true);
    await setPersonaCookie(page, ['executive-director']);

    // Establish the foundation lens first, then hit the flat /settings route.
    await gotoAndWaitForSidebar(page, `/foundation/overview?project=${MOCK_FOUNDATION_SLUG}`);

    await page.goto(`/settings?project=${MOCK_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page, 'foundation lens should redirect /settings to /foundation/settings with ?project preserved').toHaveURL(
      /\/foundation\/settings\?project=test-foundation/,
      { timeout: ELEMENT_TIMEOUT }
    );
  });
});

// ─── S14: Legacy transactions redirect (/me/transactions → /profile/transactions) ──

test.describe('S14: Legacy transactions redirect — /me/transactions → /profile/transactions', () => {
  test('redirects the legacy path and renders the dashboard embedded in the Profile shell', async ({ page }) => {
    await stubPersona(page, ['contributor']);
    await setPersonaCookie(page, ['contributor']);

    // Me lens is the default; establish it, then hit the legacy transactions path.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.goto('/me/transactions', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // The route redirects the former /me/transactions page to the canonical Profile tab.
    await expect(page, 'legacy /me/transactions should redirect to /profile/transactions').toHaveURL(/\/profile\/transactions$/, {
      timeout: ELEMENT_TIMEOUT,
    });

    // The transactions dashboard renders inside the Profile shell, which owns the page header…
    await expect(page.getByTestId('transactions-dashboard'), 'transactions dashboard should render').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('profile-page-title'), 'Profile shell header should own the page title').toBeVisible({
      timeout: ELEMENT_TIMEOUT,
    });
    // …so the dashboard's own standalone header is suppressed in embedded mode.
    await expect(page.getByTestId('transactions-title'), 'embedded dashboard should not render its standalone header').toHaveCount(0);
  });
});
