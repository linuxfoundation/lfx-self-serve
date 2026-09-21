// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Spec 050 (lfx-self-serve#2570) — Org Lens deep links: `/org/{segment}/{page}`.
 *
 * Scenarios from contracts/web-org-url-scheme.md §7:
 *   E1  — a fresh session opens a slug address and lands on the named organization: the selector
 *         shows it, lens fetches are scoped to its uid, and the selection cookie holds that uid.
 *   E13 — an upper-case slug resolves and the address is lowercased in place (FR-004). Uses org B,
 *         like every scenario that observes the resolver: A is the first stubbed row and so the
 *         bootstrap default, and an already-selected organization takes the guard's no-round-trip path.
 *   E2  — an SFID address for an organization that has a slug is rewritten to the slug form,
 *         keeping child segments, query and fragment (FR-002).
 *   E8/E9 — an address the resolver cannot answer for this viewer (unheld or unknown — one 404 by
 *         design, DR-002) lands on the Org Lens not-found page inside the shell, names no
 *         organization, and leaves the previous selection untouched (FR-022…FR-024).
 *   E9c — a fresh session (no selection cookie) on such an address stays on the not-found page after
 *         the org list picks its default: a default is a selection, never a navigation (SC-004).
 *   E10 — with the Org Lens flag off, a deep link lands on the same not-found page, not on `/`.
 *   E11 (US2) — switching organization on a detail page re-addresses it (detail segment, query and
 *         fragment kept), every rendered Org Lens link follows, and Back returns to the pre-switch
 *         organization and page.
 *   E11b (US2, T036) — switching on a memberships detail page keeps the foundation segment.
 *   E11c (US2) — switching on a legacy bare `/org/{page}` inserts the organization.
 *   E12 (US2) — picking the already-selected organization navigates nowhere.
 *   E12b (US2) — … except on the not-found dead end, where that pick is the viewer's way out to the
 *         organization's overview (also unit-tested in `org-selector.component.spec.ts`).
 *
 * Everything the BFF would answer is stubbed at the network edge (`/api/orgs/resolve/*`,
 * `/api/nav/org-items`, `/api/orgs/me/role-grants`, `/api/orgs/uid/*`), the same hermetic posture
 * as `org-multi-grant-switch.spec.ts`; the browser-side guard, router and AccountContextService run
 * for real. "Fresh session" means no selection cookie: the shared auth storage state may carry one
 * from global-setup's post-login landing, so every scenario clears it first. Scenarios that need a
 * selection other than the stubbed first row use org B, so the guard cannot take the
 * already-selected shortcut and the resolver request is observable.
 *
 * The viewport is pinned to desktop (see `test.use` below), so the sidebar selector is the one
 * instance on the page; assertions on it are by text.
 *
 * Scope: `page.route` stubs reach the browser only. A direct `page.goto` is server-rendered first,
 * and the guard's server run resolves against the real BFF (which answers 404 for these fixture
 * organizations, so the server renders the skeleton) — every assertion here is about the browser
 * run after hydration. The SSR contract (no cookie organization in the pre-hydration HTML) is E16.
 */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, ORG_LENS_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(120_000);

const SIDEBAR_TIMEOUT = 30_000;

// SFIDs are exactly 18 chars (`001` + 15 alphanumerics) — anything else fails the AccountContextService
// regex and the selection cookie never persists.
const ORG_A_UID = '0014100000DlaAAAAA';
const ORG_A_SLUG = 'deeplink-alpha-inc';
const ORG_A_NAME = 'DeepLink Alpha, Inc.';
const ORG_B_UID = '0014100000DlbBBBBB';
const ORG_B_SLUG = 'deeplink-bravo-llc';
const ORG_B_NAME = 'DeepLink Bravo, LLC';
const UNKNOWN_SLUG = 'no-such-organization';
// An organization that exists for someone else: the stub answers the same 404 it gives an unknown slug.
const UNHELD_SLUG = 'deeplink-charlie-corp';
const UNHELD_NAME = 'DeepLink Charlie Corp';
// Detail segments a switch must carry (US2 scenario 2, T036). Not stubbed: the pages' own
// not-found states are acceptable — the address is what these cases assert.
const DETAIL_PROJECT_SLUG = 'deeplink-project';
const DETAIL_FOUNDATION_SLUG = 'deeplink-foundation';

const ROLE_GRANTS_BODY = {
  writers: [ORG_A_UID, ORG_B_UID],
  auditors: [],
  cascadingWriters: [],
  cascadingAuditors: [],
  isStaff: false,
  username: 'e2e-deep-link',
  loaded_at: new Date().toISOString(),
};

const ORG_ITEMS_BODY = {
  items: [
    {
      uid: ORG_A_UID,
      accountId: ORG_A_UID,
      name: ORG_A_NAME,
      slug: ORG_A_SLUG,
      logoUrl: null,
      primaryDomain: 'alpha.example',
      isMember: true,
      parentName: null,
    },
    {
      uid: ORG_B_UID,
      accountId: ORG_B_UID,
      name: ORG_B_NAME,
      slug: ORG_B_SLUG,
      logoUrl: null,
      primaryDomain: 'bravo.example',
      isMember: true,
      parentName: null,
    },
  ],
  next_page_token: null,
  upstream_failed: false,
  total: 2,
};

const RESOLVE_BY_SEGMENT: Record<string, { uid: string; slug: string; name: string }> = {
  [ORG_A_SLUG]: { uid: ORG_A_UID, slug: ORG_A_SLUG, name: ORG_A_NAME },
  [ORG_A_UID]: { uid: ORG_A_UID, slug: ORG_A_SLUG, name: ORG_A_NAME },
  [ORG_B_SLUG]: { uid: ORG_B_UID, slug: ORG_B_SLUG, name: ORG_B_NAME },
  [ORG_B_UID]: { uid: ORG_B_UID, slug: ORG_B_SLUG, name: ORG_B_NAME },
};

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — keep the test running.
  }
}

/** Stubs every org-identity call the shell makes, and records the segments the guard asked the resolver about. */
async function stubOrgIdentity(page: Page): Promise<{ resolved: string[] }> {
  const resolved: string[] = [];

  await page.route('**/api/orgs/me/role-grants', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROLE_GRANTS_BODY) })
  );
  await page.route('**/api/nav/org-items*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORG_ITEMS_BODY) }));

  // The resolver contract: lowercase segment in, 200 {uid, slug, name} for an org this viewer can
  // read, 404 for everything else (unknown and forbidden are indistinguishable by design).
  await page.route('**/api/orgs/resolve/*', (route) => {
    const url = new URL(route.request().url());
    const segment = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    resolved.push(segment);
    const hit = RESOLVE_BY_SEGMENT[segment];
    if (!hit) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Organization not found' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hit) });
  });

  // Canonical record reconciliation fired after adoption — answer with the same identity so the
  // display fields settle without a real member-service.
  await page.route('**/api/orgs/uid/*', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const uid = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    const hit = RESOLVE_BY_SEGMENT[uid];
    if (!hit) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Organization not found' }) });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ uid: hit.uid, accountId: hit.uid, name: hit.name, slug: hit.slug, parentUid: null, isMember: true, logoUrl: null }),
    });
  });

  return { resolved };
}

/** Pins `org-lens-enabled` for this page before the app's flag-provider bootstrap runs — see `FEATURE_FLAG_OVERRIDE_STORAGE_KEY` (non-production builds). */
async function stubOrgLensFlag(page: Page, enabled: boolean): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [ORG_LENS_ENABLED_FLAG]: enabled }),
  ] as const);
}

async function plantSelectionCookie(page: Page, baseURL: string | undefined, uid: string): Promise<void> {
  // Planted for the configured base URL (E2E_BASE_URL may override localhost).
  if (!baseURL) throw new Error('baseURL fixture is required to plant the selection cookie');
  await page.context().addCookies([{ name: 'lfx-selected-account', value: encodeURIComponent(JSON.stringify({ uid })), url: baseURL, sameSite: 'Lax' }]);
}

async function readSelectionCookie(page: Page): Promise<{ uid: string } | undefined> {
  const cookies = await page.context().cookies();
  const raw = cookies.find((c) => c.name === 'lfx-selected-account')?.value;
  return raw ? (JSON.parse(decodeURIComponent(raw)) as { uid: string }) : undefined;
}

test.describe('Org Lens deep links — /org/{segment}/{page}', () => {
  // Desktop layout on every project, as the other Org Lens specs pin it: the shell renders a second
  // selector copy inside the mobile drawer (a modal `p-drawer` whose content stays in the DOM once
  // opened), and a switch scenario that opened it would leave every later `org-selector` assertion
  // with two matches under strict mode.
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page, context }) => {
    await context.clearCookies({ name: 'lfx-selected-account' });
    // Pin the Org Lens flag on so the scenarios do not depend on the environment's LaunchDarkly state
    // (a direct visit can be redirected before the authenticated flag context is ready). E10 pins it
    // off again — its init script is registered later and wins.
    await stubOrgLensFlag(page, true);
  });

  test('E1: a fresh session opens a slug address and lands on the named organization', async ({ page }) => {
    const { resolved } = await stubOrgIdentity(page);

    // Lens fetches carry the selected org uid in their path; capture them to prove scoping.
    const lensUids = new Set<string>();
    page.on('request', (request) => {
      const match = /\/api\/orgs\/([^/]+)\/lens\//.exec(request.url());
      if (match) lensUids.add(decodeURIComponent(match[1]));
    });

    await page.goto(`/org/${ORG_B_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // The guard resolved exactly the address segment (lowercase) and adopted B.
    await expect.poll(() => resolved, { timeout: SIDEBAR_TIMEOUT }).toContain(ORG_B_SLUG);
    await expect(page).toHaveURL(new RegExp(`/org/${ORG_B_SLUG}/overview(\\?|#|$)`), { timeout: SIDEBAR_TIMEOUT });

    await expect(page.getByTestId('org-selector')).toContainText(ORG_B_NAME, { timeout: SIDEBAR_TIMEOUT });

    // Selection cookie now names B — the persistence contract a later visit relies on.
    await expect.poll(async () => (await readSelectionCookie(page))?.uid, { timeout: SIDEBAR_TIMEOUT }).toBe(ORG_B_UID);

    // Every lens fetch issued while rendering was scoped to B, never to A (the first row).
    await expect.poll(() => lensUids.size, { timeout: SIDEBAR_TIMEOUT }).toBeGreaterThan(0);
    expect([...lensUids]).toEqual([ORG_B_UID]);
  });

  test('E13: an upper-case slug resolves and the address is lowercased in place', async ({ page }) => {
    const { resolved } = await stubOrgIdentity(page);

    await page.goto(`/org/${ORG_B_SLUG.toUpperCase()}/projects`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect.poll(() => resolved, { timeout: SIDEBAR_TIMEOUT }).toContain(ORG_B_SLUG);
    expect(resolved.some((segment) => segment !== segment.toLowerCase())).toBe(false);

    // FR-004: the address itself is rewritten to the lowercase slug, not just matched case-insensitively.
    await expect(page).toHaveURL(new RegExp(`/org/${ORG_B_SLUG}/projects(\\?|#|$)`), { timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('org-selector')).toContainText(ORG_B_NAME, { timeout: SIDEBAR_TIMEOUT });
    await expect.poll(async () => (await readSelectionCookie(page))?.uid, { timeout: SIDEBAR_TIMEOUT }).toBe(ORG_B_UID);
  });

  test('E2: an SFID address is rewritten to the slug form, keeping child segments, query and fragment', async ({ page }) => {
    const { resolved } = await stubOrgIdentity(page);

    // B is not the default first row, so the address must go through the resolver (not the
    // already-selected shortcut) to learn the slug it is rewritten to.
    await page.goto(`/org/${ORG_B_UID}/projects?tab=active#top`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect.poll(() => resolved, { timeout: SIDEBAR_TIMEOUT }).toContain(ORG_B_UID);
    await expect(page).toHaveURL(new RegExp(`/org/${ORG_B_SLUG}/projects\\?tab=active#top$`), { timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('org-selector')).toContainText(ORG_B_NAME, { timeout: SIDEBAR_TIMEOUT });
    await expect.poll(async () => (await readSelectionCookie(page))?.uid, { timeout: SIDEBAR_TIMEOUT }).toBe(ORG_B_UID);
  });

  // Unheld and unknown are one scenario at the wire (the resolver's 404 is the same, DR-002), so the
  // two contract rows share one body. Selection B, not the first row: if the cookie were lost, bootstrap
  // would fall back to A and a "still A" assertion could not tell preserved from defaulted.
  for (const [scenario, slug, leaked] of [
    ['E8: an organization the viewer does not hold', UNHELD_SLUG, UNHELD_NAME],
    ['E9: an unknown organization', UNKNOWN_SLUG, UNKNOWN_SLUG],
  ] as const) {
    test(`${scenario} lands on the Org Lens not-found page and leaves the selection untouched`, async ({ page, baseURL }) => {
      await stubOrgIdentity(page);
      await plantSelectionCookie(page, baseURL, ORG_B_UID);

      await page.goto(`/org/${slug}/overview`, { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SIDEBAR_TIMEOUT });
      // The branded dead end, inside the shell (FR-022): the sidebar selector is still there and still B.
      await expect(page.getByTestId('org-not-found')).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
      await expect(page.getByTestId('org-selector')).toContainText(ORG_B_NAME, { timeout: SIDEBAR_TIMEOUT });
      // FR-023: nothing about the addressed organization reaches the DOM.
      await expect(page.locator('body')).not.toContainText(leaked);
      // FR-024: a failed address never rewrites the selection — B survives, and no default took over.
      expect((await readSelectionCookie(page))?.uid).toBe(ORG_B_UID);
    });
  }

  // The bootstrap default is the one path that can leave the dead end without the viewer asking: with
  // no selection to restore, the org list's first row is selected — and that selection must stay a
  // selection, never a navigation (FR-022–FR-024, SC-004). E8/E9 plant a cookie, so they never reach it.
  test('E9c: a fresh session (no selection cookie) stays on the not-found page after the org list defaults', async ({ page }) => {
    await stubOrgIdentity(page);
    await page.context().clearCookies({ name: 'lfx-selected-account' });

    await page.goto(`/org/${UNKNOWN_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('org-not-found')).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    // Captured once the dead end has settled and before the org list can have answered: a default
    // that navigated (pushed or replaced) would move the URL, and a push would also grow this.
    const historyAtNotFound = await page.evaluate(() => window.history.length);
    // The default has been picked (the selector names A) …
    await expect(page.getByTestId('org-selector')).toContainText(ORG_A_NAME, { timeout: SIDEBAR_TIMEOUT });
    // … and the address is still the dead end, with nothing pushed under it. A settle window first,
    // then the assertion: a navigation one task later (a `replaceUrl` one leaves `history.length`
    // alone) must be given the chance to happen — polling for the status quo would pass on its
    // first tick and prove nothing.
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/);
    expect(await page.evaluate(() => window.history.length)).toBe(historyAtNotFound);
    await expect(page.locator('body')).not.toContainText(UNKNOWN_SLUG);
  });

  test('E10: with the Org Lens flag off, a deep link lands on the not-found page, not on the dashboard', async ({ page, baseURL }) => {
    await stubOrgIdentity(page);
    await stubOrgLensFlag(page, false);
    await plantSelectionCookie(page, baseURL, ORG_A_UID);

    await page.goto(`/org/${ORG_B_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('org-not-found')).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    // The dead end is reached before any resolution: the addressed organization is never named in
    // the state's copy, and the selection is untouched. B is one of the viewer's OWN held
    // organizations here, so it may legitimately appear in the FR-008 held-organization list
    // (spec 053 FR-019) — the wording is what must stay silent about the address.
    await expect(page.getByTestId('org-not-found-title')).not.toContainText(ORG_B_NAME);
    await expect(page.getByTestId('org-not-found-description')).not.toContainText(ORG_B_NAME);
    expect((await readSelectionCookie(page))?.uid).toBe(ORG_A_UID);
  });

  /** Opens the (desktop) selector and picks an organization row. */
  async function switchOrg(page: Page, uid: string): Promise<void> {
    await page.getByTestId('org-selector').click();
    await expect(page.getByTestId('org-selector-list')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(`org-item-${uid}`).click();
  }

  test('E11: switching organization on a detail page re-addresses it, keeping child segments, query and fragment; Back returns to the pre-switch org', async ({
    page,
  }) => {
    await stubOrgIdentity(page);

    // A detail address: the `:projectSlug` child segment is the part of the page a switch must carry.
    // The project need not exist for either organization — the page's own not-found state is fine;
    // what is asserted is the address.
    await page.goto(`/org/${ORG_A_SLUG}/projects/${DETAIL_PROJECT_SLUG}?tab=active#top`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('org-selector')).toContainText(ORG_A_NAME, { timeout: SIDEBAR_TIMEOUT });

    await switchOrg(page, ORG_B_UID);

    // The address follows the selection: same page and detail segment, query and fragment, B's segment.
    await expect(page).toHaveURL(new RegExp(`/org/${ORG_B_SLUG}/projects/${DETAIL_PROJECT_SLUG}\\?tab=active#top$`), { timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('org-selector')).toContainText(ORG_B_NAME, { timeout: SIDEBAR_TIMEOUT });
    await expect.poll(async () => (await readSelectionCookie(page))?.uid, { timeout: SIDEBAR_TIMEOUT }).toBe(ORG_B_UID);
    // Every rendered Org Lens link now addresses B — a leftover literal such as `/org/projects` fails
    // this, not just a stale A link. EasyCLA included since lfx-self-serve#2743.
    const orgHrefs = await page.locator(`a[href^="/org/"]`).evaluateAll((links) => links.map((a) => a.getAttribute('href') ?? ''));
    expect(orgHrefs).toContain(`/org/${ORG_B_SLUG}/overview`);
    expect(orgHrefs.filter((href) => !href.startsWith(`/org/${ORG_B_SLUG}/`))).toEqual([]);

    // The switch is a user intent: Back returns to the pre-switch organization and page (not an intermediate address).
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/org/${ORG_A_SLUG}/projects/${DETAIL_PROJECT_SLUG}\\?tab=active#top$`), { timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('org-selector')).toContainText(ORG_A_NAME, { timeout: SIDEBAR_TIMEOUT });
  });

  // T036: a memberships detail page switched in place — the foundation segment stays and the page
  // refetches for B (FR-016) rather than bouncing to the list.
  test('E11b: switching on a memberships detail page keeps the foundation segment', async ({ page }) => {
    await stubOrgIdentity(page);

    await page.goto(`/org/${ORG_A_SLUG}/memberships/${DETAIL_FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('org-selector')).toContainText(ORG_A_NAME, { timeout: SIDEBAR_TIMEOUT });

    await switchOrg(page, ORG_B_UID);

    await expect(page).toHaveURL(new RegExp(`/org/${ORG_B_SLUG}/memberships/${DETAIL_FOUNDATION_SLUG}(\\?|#|$)`), { timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('org-selector')).toContainText(ORG_B_NAME, { timeout: SIDEBAR_TIMEOUT });
  });

  test('E11c: switching on a legacy bare page inserts the organization into the address', async ({ page, baseURL }) => {
    await stubOrgIdentity(page);
    await plantSelectionCookie(page, baseURL, ORG_A_UID);

    await page.goto('/org/people', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('org-selector')).toContainText(ORG_A_NAME, { timeout: SIDEBAR_TIMEOUT });

    await switchOrg(page, ORG_B_UID);

    await expect(page).toHaveURL(new RegExp(`/org/${ORG_B_SLUG}/people(\\?|#|$)`), { timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('org-selector')).toContainText(ORG_B_NAME, { timeout: SIDEBAR_TIMEOUT });
  });

  test('E12: picking the already-selected organization navigates nowhere', async ({ page }) => {
    await stubOrgIdentity(page);

    await page.goto(`/org/${ORG_B_SLUG}/memberships`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('org-selector')).toContainText(ORG_B_NAME, { timeout: SIDEBAR_TIMEOUT });
    const before = page.url();
    const historyBefore = await page.evaluate(() => window.history.length);

    await switchOrg(page, ORG_B_UID);
    // The pick closes the panel; from then on nothing may move. A settle window, then the
    // assertion — a status-quo poll would pass on its first tick and let a navigation one task
    // later (or a `replaceUrl` one, which keeps `history.length`) through.
    await expect(page.getByTestId('org-selector-list')).toBeHidden({ timeout: 10_000 });
    await page.waitForTimeout(1_000);
    expect(page.url()).toBe(before);
    expect(await page.evaluate(() => window.history.length)).toBe(historyBefore);
  });

  // The dead end's selection is the bootstrap default (E9c), which never made it into the address — so
  // the row shown as selected is, for a single-organization viewer, the only way out.
  test('E12b: picking the already-selected organization on the not-found page leaves for its overview', async ({ page }) => {
    await stubOrgIdentity(page);
    await page.context().clearCookies({ name: 'lfx-selected-account' });

    await page.goto(`/org/${UNKNOWN_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('org-selector')).toContainText(ORG_A_NAME, { timeout: SIDEBAR_TIMEOUT });

    await switchOrg(page, ORG_A_UID);

    await expect(page).toHaveURL(new RegExp(`/org/${ORG_A_SLUG}/overview(\\?|#|$)`), { timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('org-selector')).toContainText(ORG_A_NAME, { timeout: SIDEBAR_TIMEOUT });
  });
});
