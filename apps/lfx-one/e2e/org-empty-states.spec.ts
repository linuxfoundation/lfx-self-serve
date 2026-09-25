// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Spec 053 (lfx-self-serve#2533) — Org Lens empty states, driven through the real pages (FR-021).
 *
 * Every scenario is hermetic: the four Org Lens seams (`/api/orgs/me/role-grants`,
 * `/api/nav/org-items`, `/api/orgs/resolve/{segment}`, `/api/user/personas`) are stubbed per test, so
 * the assertions do not depend on the bootstrap user's real grants. Quickstart rows:
 *
 * - S1a–S1d: one section (the ROI annual trend) rendering genuine-empty vs could-not-verify vs
 *   no-access vs could-not-load, told apart by the refusal's stated `code`, never by status alone.
 * - S2a–S2d: no-organization on /org/overview; no-access and wrong-organization on /org/not-found
 *   (the addressed organization never named; unheld and nonexistent byte-identical).
 * - S3a–S3c: the two halves of #2090 — a held-but-partial lookup renders the page plus the switcher
 *   notice, an unheld partial or failed lookup renders the page-level could-not-load state.
 * - S4: staff check failed carries the correlation reference and never falls through.
 * - S5: an LF-staff session sees the search invite; a contractor holding an explicit org grant (not
 *   in `LF_TEAM_IDS` since the rollback of lfx-self-serve#2157) keeps the switcher but loses
 *   catalogue search.
 * - S7 lives in `org-projects.spec.ts` / `org-selector.spec.ts` (legacy wording updated in place).
 */

import { ACCOUNT_COOKIE_KEY } from '@lfx-one/shared/constants/accounts.constants';
import { LENS_COOKIE_KEY } from '@lfx-one/shared/constants/lens.constants';
import { ORG_LENS_EMPTY_STATE_COPY } from '@lfx-one/shared/constants/org-lens-empty-state.constants';
import { expect, Page, test } from '@playwright/test';

import { fulfillJson, gotoOrgRoiPage, skipWhenAuthMissing, stubOrgLensContext } from './helpers/org-roi.helper';

test.setTimeout(120_000);

const SETTLE_TIMEOUT = 30_000;

// SFIDs are exactly 18 chars (`001` + 15 alphanumerics) — anything else fails the AccountContextService
// regex and the selection never persists.
const ORG_A_UID = '0014100000EsaAAAAA';
const ORG_A_SLUG = 'held-org';
const ORG_A_NAME = 'Held Org';
// Addressed but never held — the resolver answers the same 404 for an organization that exists for
// someone else and one that does not exist at all (spec 050 DR-002), so both slugs share one stub.
const UNHELD_SLUG = 'some-unheld-slug';
const UNHELD_NAME = 'Unheld Org';
const NONEXISTENT_SLUG = 'never-existed-org';
const CORRELATION_ID = '11111111-2222-3333-4444-555555555555';

const RETIRED_NO_ORG_HEADLINE = 'No organization linked';
const NO_ACCESS_COPY = ORG_LENS_EMPTY_STATE_COPY['no-access'];

type RoleGrantsOverrides = Partial<{
  writers: string[];
  auditors: string[];
  isStaff: boolean;
  isContractor: boolean;
  degraded: boolean;
  lookupOutcome: 'ok' | 'partial' | 'failed';
  staffCheck: 'ok' | 'failed';
  correlationId: string;
}>;

function roleGrantsBody(overrides: RoleGrantsOverrides = {}): Record<string, unknown> {
  return {
    writers: [],
    auditors: [],
    cascadingWriters: [],
    cascadingAuditors: [],
    isStaff: false,
    degraded: false,
    lookupOutcome: 'ok',
    staffCheck: 'ok',
    username: 'e2e-empty-states',
    loaded_at: new Date().toISOString(),
    ...overrides,
  };
}

function orgItemRow(uid: string, slug: string, name: string): Record<string, unknown> {
  return { uid, accountId: uid, name, slug, logoUrl: null, primaryDomain: `${slug}.example`, isMember: true, parentName: null };
}

function personaOrg(uid: string, name: string): Record<string, unknown> {
  return { accountId: uid, accountName: name, membershipTier: '', uid };
}

interface IdentityStubs {
  /** 200 body of the lookup; ignored when `roleGrantsStatus` is set. */
  roleGrants?: Record<string, unknown>;
  /** Transport-level failure of the lookup (e.g. 502) — the roster never loads. */
  roleGrantsStatus?: number;
  orgItems?: Record<string, unknown>[];
  personaOrgs?: Record<string, unknown>[];
  /** Segments the resolver answers 200 for; everything else is a 404. */
  resolvable?: { uid: string; slug: string; name: string }[];
}

/** Stubs every org-identity call the shell makes; counts role-grants requests so Retry can be proven to re-issue the lookup. */
async function stubOrgIdentity(page: Page, stubs: IdentityStubs): Promise<{ roleGrantsRequests: () => number; roleGrantsRefreshes: () => number }> {
  let roleGrantsRequests = 0;
  let roleGrantsRefreshes = 0;
  const orgItems = stubs.orgItems ?? [];
  const resolvable = stubs.resolvable ?? [];

  // Bootstrap fetches the bare path; the viewer's Retry adds `?refresh=1` (BFF cache bypass).
  await page.route('**/api/orgs/me/role-grants*', (route) => {
    roleGrantsRequests += 1;
    if (new URL(route.request().url()).searchParams.get('refresh') === '1') {
      roleGrantsRefreshes += 1;
    }
    if (stubs.roleGrantsStatus !== undefined) {
      return route.fulfill({ status: stubs.roleGrantsStatus, contentType: 'text/plain', body: 'Bad Gateway' });
    }
    return fulfillJson(route, stubs.roleGrants ?? roleGrantsBody());
  });

  await page.route('**/api/nav/org-items*', (route) =>
    fulfillJson(route, { items: orgItems, next_page_token: null, upstream_failed: false, total: orgItems.length })
  );

  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['contributor'], personaProjects: {}, projects: [], organizations: stubs.personaOrgs ?? [], isRootWriter: false })
  );

  await page.route('**/api/analytics/org-lens-account-context*', (route) => fulfillJson(route, []));

  // Resolver contract: 200 {uid, slug, name} for an org this viewer can read, 404 for everything else
  // (unknown and forbidden are indistinguishable by design).
  await page.route('**/api/orgs/resolve/*', (route) => {
    const segment = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    const hit = resolvable.find((org) => org.slug === segment || org.uid === segment);
    if (!hit) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Organization not found' }) });
    }
    return fulfillJson(route, hit);
  });

  // Canonical record reconciliation after a selection — same identity, so display fields settle.
  await page.route('**/api/orgs/uid/*', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const uid = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    const hit = resolvable.find((org) => org.uid === uid);
    if (!hit) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Organization not found' }) });
    return fulfillJson(route, { uid: hit.uid, accountId: hit.uid, name: hit.name, slug: hit.slug, parentUid: null, isMember: true, logoUrl: null });
  });

  // The page's own sections are not under test here; answer fast so a real BFF round trip never
  // decides how long "the page rendered" takes.
  await page.route('**/api/orgs/*/lens/**', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'stubbed' }) })
  );

  return { roleGrantsRequests: () => roleGrantsRequests, roleGrantsRefreshes: () => roleGrantsRefreshes };
}

const HELD_ORG = { uid: ORG_A_UID, slug: ORG_A_SLUG, name: ORG_A_NAME };

async function gotoOverview(page: Page): Promise<void> {
  await page.goto('/org/overview', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).toHaveURL(/\/org\/overview(\?|#|$)/, { timeout: SETTLE_TIMEOUT });
}

/** The one page-level block on /org/overview: `org-overview-no-access-*` roots are kept for every state it renders. */
function overviewState(page: Page) {
  return {
    root: page.getByTestId('org-overview-no-access-state'),
    title: page.getByTestId('org-overview-no-access-title'),
    description: page.getByTestId('org-overview-no-access-description'),
    primary: page.getByTestId('org-overview-no-access-primary'),
    retry: page.getByTestId('org-overview-no-access-retry'),
    contactSupport: page.getByTestId('org-overview-no-access-contact-support'),
  };
}

test.describe('Org Lens empty states (spec 053)', () => {
  test.beforeEach(async ({ context }) => {
    // Fresh session: no remembered selection.
    await context.clearCookies({ name: ACCOUNT_COOKIE_KEY });
  });

  test.describe('page level — could not be loaded (#2090, FR-009 / FR-010)', () => {
    test('S3a (#2090 half 1): a held organization on a partial lookup renders the page and the switcher notice, not a no-access block', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ writers: [ORG_A_UID], degraded: true, lookupOutcome: 'partial' }),
        orgItems: [orgItemRow(ORG_A_UID, ORG_A_SLUG, ORG_A_NAME)],
        personaOrgs: [personaOrg(ORG_A_UID, ORG_A_NAME)],
        resolvable: [HELD_ORG],
      });

      await gotoOverview(page);

      // FR-016 rule (1): the resolved entry is authoritative — the page renders for A.
      await expect(page.getByTestId('org-overview-title')).toContainText(ORG_A_NAME, { timeout: SETTLE_TIMEOUT });
      await expect(overviewState(page).root).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('Some organizations could not be loaded');

      // FR-010: the switcher says the list is a lower bound, with its own Retry.
      const trigger = page.getByTestId('org-selector');
      await expect(trigger).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await trigger.click();
      await expect(page.getByTestId('org-selector-list')).toBeVisible({ timeout: SETTLE_TIMEOUT });
      const notice = page.getByTestId('org-selector-list-incomplete');
      await expect(notice).toBeVisible();
      await expect(notice).toContainText('may be missing');
      await expect(page.getByTestId('org-selector-list-incomplete-retry')).toBeVisible();
    });

    test('S3b (#2090 half 2): a partial lookup that resolved nothing renders could-not-load, never the no-organization copy', async ({ page }) => {
      await stubOrgIdentity(page, { roleGrants: roleGrantsBody({ degraded: true, lookupOutcome: 'partial' }) });

      await gotoOverview(page);

      const state = overviewState(page);
      await expect(state.root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(state.root).toHaveAttribute('data-state', 'could-not-load');
      await expect(state.title).toHaveText('Some organizations could not be loaded');
      await expect(state.retry).toBeVisible();
      // FR-009: nothing about what failed (no count, no names) and no revocation reading.
      await expect(state.description).toContainText('nothing has been removed from your access');
      await expect(page.locator('body')).not.toContainText(RETIRED_NO_ORG_HEADLINE);
      await expect(page.getByTestId('org-overview-loading')).toHaveCount(0);
    });

    test('S3c: a transport failure of the lookup renders could-not-load, and Retry re-issues the lookup', async ({ page }) => {
      const { roleGrantsRequests, roleGrantsRefreshes } = await stubOrgIdentity(page, { roleGrantsStatus: 502 });

      await gotoOverview(page);

      const state = overviewState(page);
      await expect(state.root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(state.root).toHaveAttribute('data-state', 'could-not-load');
      await expect(state.title).toHaveText('Some organizations could not be loaded');
      await expect(page.locator('body')).not.toContainText(RETIRED_NO_ORG_HEADLINE);

      const before = roleGrantsRequests();
      await state.retry.click();
      await expect.poll(roleGrantsRequests, { timeout: SETTLE_TIMEOUT }).toBeGreaterThan(before);
      // Retry asks the BFF to recompute past its cache, so it cannot be served the same stale answer.
      expect(roleGrantsRefreshes()).toBeGreaterThan(0);
      // Still failing → still could-not-load; the state does not degrade into a different one.
      await expect(state.root).toHaveAttribute('data-state', 'could-not-load');
    });
  });

  test.describe('page level — staff check failed (FR-011)', () => {
    test('S4: a failed team check renders staff-check-failed with the correlation reference and never the employee copy', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ isStaff: false, staffCheck: 'failed', correlationId: CORRELATION_ID, lookupOutcome: 'ok' }),
      });

      await gotoOverview(page);

      const state = overviewState(page);
      await expect(state.root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(state.root).toHaveAttribute('data-state', 'staff-check-failed');
      await expect(state.title).toHaveText('We could not confirm your staff access');
      await expect(state.description).toContainText(CORRELATION_ID);
      await expect(state.description).toContainText('not a change to your permissions');
      await expect(state.retry).toBeVisible();
      await expect(state.contactSupport).toBeVisible();
      // The never-fall-through rule: neither no-organization nor no-access wording.
      await expect(page.locator('body')).not.toContainText(RETIRED_NO_ORG_HEADLINE);
      await expect(page.locator('body')).not.toContainText('You do not have access to this organization');
    });
  });

  test.describe('page level — no organization / no access / wrong organization (FR-006 – FR-008)', () => {
    test('S2a: a clean lookup with nothing held renders no-organization with the affiliation action', async ({ page }) => {
      await stubOrgIdentity(page, { roleGrants: roleGrantsBody() });

      await gotoOverview(page);

      const state = overviewState(page);
      await expect(state.root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(state.root).toHaveAttribute('data-state', 'no-organization');
      await expect(state.title).toHaveText('No organization linked to your account');
      // FR-002: a first-time visitor learns what Organization Lens is — the product sentence opens the paragraph.
      await expect(state.description).toContainText('Organization Lens shows how a company shows up in open source');
      // Primary: Add an affiliation → the in-app profile attributions page (SC-004 destination).
      await expect(state.primary).toBeVisible();
      await expect(state.primary).toContainText('Add an affiliation');
      // Secondary: Contact support.
      await expect(state.contactSupport).toBeVisible();
      await expect(state.retry).toHaveCount(0);
      await expect(page.getByTestId('org-overview-loading')).toHaveCount(0);
      await expect(page.getByTestId('org-overview-empty-state')).toHaveCount(0);
      // Following the primary must reach its destination, not just render (SC-004).
      await state.primary.click();
      await expect(page).toHaveURL(/\/profile\/attributions(\?|#|$)/, { timeout: SETTLE_TIMEOUT });
      // The profile is a Me page: the lens must follow, not stay on Organization with its menu.
      await expect(page.getByTestId('lens-me-tab')).toHaveAttribute('aria-pressed', 'true', { timeout: SETTLE_TIMEOUT });
      await expect(page.getByTestId('lens-org-tab')).toHaveAttribute('aria-pressed', 'false');
    });

    // The profile route declares the Me lens, so every way in switches — not only the in-app link:
    // a deep link, a refresh or back/forward while the Organization lens is the saved one.
    test('S2a′: opening the profile directly with the Organization lens saved lands in the Me lens', async ({ page, baseURL }) => {
      // Scoped to baseURL, not a hardcoded host: on an E2E_BASE_URL override a localhost cookie would
      // never reach the app, and the Me fallback would pass this test without exercising the route lens.
      await page.context().addCookies([{ name: LENS_COOKIE_KEY, value: 'org', url: baseURL ?? 'http://localhost:4200' }]);

      await page.goto('/profile/attributions', { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      await expect(page).toHaveURL(/\/profile\/attributions(\?|#|$)/, { timeout: SETTLE_TIMEOUT });
      await expect(page.getByTestId('lens-me-tab')).toHaveAttribute('aria-pressed', 'true', { timeout: SETTLE_TIMEOUT });
      await expect(page.getByTestId('lens-org-tab')).toHaveAttribute('aria-pressed', 'false');
    });

    // Unheld and nonexistent are one scenario at the wire (spec 050 DR-002), so S2b and S2d share
    // one body and both pin their wording to the same registry entry — that is what makes them
    // byte-identical (FR-017) rather than merely similar.
    for (const [scenario, slug, leaked] of [
      ['S2b: an addressed organization the viewer cannot see', UNHELD_SLUG, [UNHELD_SLUG, UNHELD_NAME, 'some-unheld']],
      ['S2d: an addressed organization that does not exist', NONEXISTENT_SLUG, [NONEXISTENT_SLUG]],
    ] as const) {
      test(`${scenario} renders no-access with nothing about the organization (FR-007, FR-017, FR-018)`, async ({ page }) => {
        await stubOrgIdentity(page, { roleGrants: roleGrantsBody() });

        await page.goto(`/org/${slug}/overview`, { waitUntil: 'domcontentloaded' });
        skipWhenAuthMissing(page);

        await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SETTLE_TIMEOUT });
        // Spec 050's outer hook survives; the state block inside it is the shared component.
        await expect(page.getByTestId('org-not-found')).toBeVisible({ timeout: SETTLE_TIMEOUT });
        const root = page.getByTestId('org-not-found-state');
        await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
        await expect(root).toHaveAttribute('data-state', 'no-access');
        await expect(page.getByTestId('org-not-found-title')).toHaveText(NO_ACCESS_COPY.headline);
        await expect(page.getByTestId('org-not-found-title')).toHaveText('You do not have access to this organization');
        // Exactly the registry reason: no administrator names, no membership status, no counts can be
        // interpolated into a string that carries no placeholders.
        await expect(page.getByTestId('org-not-found-description')).toHaveText(NO_ACCESS_COPY.reason);
        await expect(page.getByTestId('org-not-found-description')).toContainText("organization's own Organization Lens administrators");
        await expect(page.getByTestId('org-not-found-contact-support')).toBeVisible();
        await expect(page.getByTestId('org-not-found-org-list')).toHaveCount(0);
        // FR-017 / FR-018: nothing about the addressed organization reaches the DOM.
        for (const text of leaked) {
          await expect(page.locator('body')).not.toContainText(text);
        }
      });
    }

    test('S2c: an addressed organization outside the held list renders wrong-organization listing the held one, target unnamed (FR-008)', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ writers: [ORG_A_UID] }),
        orgItems: [orgItemRow(ORG_A_UID, ORG_A_SLUG, ORG_A_NAME)],
        personaOrgs: [personaOrg(ORG_A_UID, ORG_A_NAME)],
        resolvable: [HELD_ORG],
      });

      await page.goto(`/org/${UNHELD_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SETTLE_TIMEOUT });
      const root = page.getByTestId('org-not-found-state');
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'wrong-organization');
      await expect(page.getByTestId('org-not-found-title')).toHaveText('You do not have access to this organization');
      await expect(page.getByTestId('org-not-found-description')).toContainText('not on your list');

      // The caller's own organizations are the primary action; the addressed one is never named.
      const orgList = page.getByTestId('org-not-found-org-list');
      await expect(orgList).toBeVisible();
      await expect(orgList).toContainText(ORG_A_NAME);
      await expect(page.getByTestId(`org-not-found-org-${ORG_A_UID}`)).toBeVisible();
      await expect(page.locator('body')).not.toContainText(UNHELD_NAME);
      await expect(page.locator('body')).not.toContainText(UNHELD_SLUG);
      // Secondary: Ask for access → support.
      const askForAccess = page.getByTestId('org-not-found-contact-support');
      await expect(askForAccess).toBeVisible();
      await expect(askForAccess).toContainText('Ask for access');

      // The list is the primary action, so it must actually lead somewhere: picking the held
      // organization selects it and opens its overview (FR-005 / SC-004).
      await page.getByTestId(`org-not-found-org-${ORG_A_UID}`).click();
      await expect(page).toHaveURL(new RegExp(`/org/${ORG_A_SLUG}/overview(\\?|#|$)`), { timeout: SETTLE_TIMEOUT });
    });

    // FR-016 rules 2–4 apply on the dead end too: a roster that never loaded, or a team check that
    // threw, says nothing about access — the page must not fall back to the no-access wording
    // (FR-009 / FR-011). Both are reachable with an addressed slug because the guard lands here
    // before the classifier has anything to say.
    test('S2g: an addressed organization with a failed lookup renders could-not-load on the dead end, never no-access', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ lookupOutcome: 'failed', degraded: true }),
        orgItems: [],
        personaOrgs: [],
        resolvable: [],
      });

      await page.goto(`/org/${UNHELD_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SETTLE_TIMEOUT });
      const root = page.getByTestId('org-not-found-state');
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'could-not-load');
      await expect(page.getByTestId('org-not-found-title')).toHaveText('Some organizations could not be loaded');
      await expect(page.getByTestId('org-not-found-retry')).toBeVisible();
      await expect(page.locator('body')).not.toContainText('You do not have access');
    });

    test('S2h: an addressed organization with a failed staff check renders staff-check-failed with the reference on the dead end', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ isStaff: false, staffCheck: 'failed', correlationId: CORRELATION_ID, lookupOutcome: 'ok' }),
        orgItems: [],
        personaOrgs: [],
        resolvable: [],
      });

      await page.goto(`/org/${UNHELD_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SETTLE_TIMEOUT });
      const root = page.getByTestId('org-not-found-state');
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'staff-check-failed');
      await expect(page.getByTestId('org-not-found-title')).toHaveText('We could not confirm your staff access');
      await expect(page.getByTestId('org-not-found-description')).toContainText(CORRELATION_ID);
      await expect(page.getByTestId('org-not-found-retry')).toBeVisible();
      await expect(page.locator('body')).not.toContainText('You do not have access');
    });

    // FR-016 rule 3 on the dead end: a partial roll-up that left the caller holding nothing is an
    // outage, not a denial — the #2090 class the classifier closes must not reopen on this route.
    test('S2i: an addressed organization with a partial lookup and nothing held renders could-not-load on the dead end', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ lookupOutcome: 'partial', degraded: true }),
        orgItems: [],
        personaOrgs: [],
        resolvable: [],
      });

      await page.goto(`/org/${UNHELD_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SETTLE_TIMEOUT });
      const root = page.getByTestId('org-not-found-state');
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'could-not-load');
      await expect(page.getByTestId('org-not-found-retry')).toBeVisible();
      await expect(page.locator('body')).not.toContainText('You do not have access');
    });

    // An LF-team caller reaches organizations through switcher search, not through a list of their
    // own grants — so with no own rows the dead end must still offer a primary action (FR-005) and
    // must not claim they lack access (their entitlement is blanket). Cause-blind per DR-002.
    test('S2e: an LF-team caller with no own organizations sees the search invite, not an empty list or no-access copy', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ isStaff: true }),
        orgItems: [],
        personaOrgs: [],
        resolvable: [],
      });

      await page.goto(`/org/${UNHELD_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SETTLE_TIMEOUT });
      const root = page.getByTestId('org-not-found-state');
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'not-found-staff');
      await expect(page.getByTestId('org-not-found-title')).toHaveText('This link does not open an organization');
      await expect(page.getByTestId('org-not-found-primary')).toBeVisible();
      await expect(page.getByTestId('org-not-found-org-list')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('You do not have access');
      await expect(page.locator('body')).not.toContainText(UNHELD_NAME);
    });

    // FR-012 / "never say no access when the truth is a failed lookup": an LF-team caller holds
    // every organization, so even with own rows an unresolvable address is not a wrong-organization
    // case — the invite wins, and the own rows are not listed (staff reach any org through search).
    test('S2f: an LF-team caller with own organizations still sees the search invite, never wrong-organization', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ isStaff: true, writers: [ORG_A_UID] }),
        orgItems: [orgItemRow(ORG_A_UID, ORG_A_SLUG, ORG_A_NAME)],
        personaOrgs: [personaOrg(ORG_A_UID, ORG_A_NAME)],
        resolvable: [HELD_ORG],
      });

      await page.goto(`/org/${UNHELD_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SETTLE_TIMEOUT });
      const root = page.getByTestId('org-not-found-state');
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'not-found-staff');
      await expect(page.getByTestId('org-not-found-primary')).toBeVisible();
      // Staff reach any organization through switcher search: the staff state lists none of their own.
      await expect(page.getByTestId('org-not-found-org-list')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('You do not have access');
      await expect(page.locator('body')).not.toContainText(UNHELD_NAME);
    });
  });

  test.describe('page level — LF team affordance (FR-012)', () => {
    test('S5 (staff): an LF-team session with no selection sees the staff search invite, never a no-access state', async ({ page }) => {
      await stubOrgIdentity(page, { roleGrants: roleGrantsBody({ isStaff: true }) });

      await gotoOverview(page);

      await expect(page.getByTestId('org-overview-empty-state')).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(page.getByTestId('org-overview-empty-description-staff')).toBeVisible();
      await expect(page.getByTestId('org-overview-empty-description-staff')).toContainText('Search for an organization');
      await expect(overviewState(page).root).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(RETIRED_NO_ORG_HEADLINE);
      await expect(page.locator('body')).not.toContainText('You do not have access to this organization');
      // The switcher is the control that fills an LF-team member's empty list — it must be there.
      await expect(page.getByTestId('org-selector')).toBeVisible({ timeout: SETTLE_TIMEOUT });
    });

    // Since the rollback of lfx-self-serve#2157, lf-contractor is not in `LF_TEAM_IDS`, so the server
    // answers `isStaff: false` for a contractor. A contractor holding one explicit org grant keeps
    // the switcher (they hold an org) but loses the catalogue search this rollback removes. The e2e
    // stubs `isStaff` on the wire, so it pins the UI contract only; what fails if `lf-contractor` is
    // re-added to `LF_TEAM_IDS` is the unit spec (`org-role-grants.service.spec.ts`). The switcher
    // sequence copies M4 in `org-multi-grant-switch.spec.ts` (non-LF-team: no catalogue search).
    test('S5 (contractor): a contractor with an explicit org grant keeps the switcher but gets no catalogue search', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ isStaff: false, auditors: [ORG_A_UID] }),
        orgItems: [orgItemRow(ORG_A_UID, ORG_A_SLUG, ORG_A_NAME)],
        personaOrgs: [personaOrg(ORG_A_UID, ORG_A_NAME)],
        resolvable: [HELD_ORG],
      });

      await gotoOverview(page);

      await expect(page.getByTestId('org-overview-empty-description-staff')).toHaveCount(0);
      const trigger = page.getByTestId('org-selector');
      await expect(trigger).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await trigger.click();
      const listbox = page.locator('#org-selector-listbox');
      await expect(listbox).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(listbox).toContainText(ORG_A_NAME);
      // The removed affordance: no LF-team catalogue search input.
      await expect(page.getByTestId('org-search-input')).toHaveCount(0);
    });
  });

  // #2961 — an LF contractor with no grant. The page keys on the server's answer (the read gate for a
  // selected organization, the resolver for an address), never on the roster, and always gives the
  // contractor reason rather than employee copy, a zero-metric overview or a retryable failure.
  test.describe('page level — LF contractor without a grant (#2961)', () => {
    const CONTRACTOR_HEADLINE = ORG_LENS_EMPTY_STATE_COPY['contractor-no-grant'].headline;

    /** The read gate's answer for the selected organization; registered last so it wins over the lens stub. */
    async function stubReadCheck(page: Page, status: 204 | 403): Promise<void> {
      await page.route('**/api/orgs/*/lens/read-check*', (route) =>
        status === 204
          ? route.fulfill({ status: 204, body: '' })
          : route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'FORBIDDEN', message: 'stubbed' }) })
      );
    }

    test('C4: with nothing selected and nothing held, a contractor sees contractor-no-grant, not no-organization', async ({ page }) => {
      await stubOrgIdentity(page, { roleGrants: roleGrantsBody({ isContractor: true }) });

      await gotoOverview(page);

      const state = overviewState(page);
      await expect(state.root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(state.root).toHaveAttribute('data-state', 'contractor-no-grant');
      await expect(state.title).toHaveText(CONTRACTOR_HEADLINE);
      await expect(state.contactSupport).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Add an affiliation');
    });

    test('C1: a persona-seeded organization the read gate refuses renders contractor-no-grant, never a zero-metric overview', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ isContractor: true }),
        personaOrgs: [personaOrg(ORG_A_UID, ORG_A_NAME)],
      });
      await stubReadCheck(page, 403);

      await gotoOverview(page);

      const state = overviewState(page);
      await expect(state.root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(state.root).toHaveAttribute('data-state', 'contractor-no-grant');
      await expect(page.getByTestId('org-overview-title')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('You do not have access to any organizations');
      // The copy depends only on the caller. (The header switcher still shows their own persona org.)
      await expect(state.root).not.toContainText(ORG_A_NAME);
    });

    test('C3: a deep link the resolver refuses renders contractor-no-grant on the dead end, with the organization unnamed', async ({ page }) => {
      await stubOrgIdentity(page, { roleGrants: roleGrantsBody({ isContractor: true }) });

      await page.goto(`/org/${UNHELD_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SETTLE_TIMEOUT });
      const root = page.getByTestId('org-not-found-state');
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'contractor-no-grant');
      await expect(page.locator('body')).not.toContainText('your OSPO');
      await expect(page.locator('body')).not.toContainText(UNHELD_NAME);
    });

    // Every Org page renders the shared page state, not only Overview (#2977 review): People stands in
    // for the pages that used to show their own load errors to a refused contractor.
    test('C1-people: the People page renders contractor-no-grant for a refused persona-seeded organization', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ isContractor: true }),
        personaOrgs: [personaOrg(ORG_A_UID, ORG_A_NAME)],
      });
      await stubReadCheck(page, 403);

      await page.goto('/org/people', { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      const root = page.getByTestId('org-people-no-access-state');
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'contractor-no-grant');
      await expect(root).not.toContainText(ORG_A_NAME);
    });

    // The negative case: the read gate also admits FGA-only readers (key-contact auditors) that no
    // roster lists. A roster-based rule would lock them out; this one keeps their page.
    test('C-admit: a persona-seeded organization the read gate admits renders the page', async ({ page }) => {
      await stubOrgIdentity(page, {
        roleGrants: roleGrantsBody({ isContractor: true }),
        personaOrgs: [personaOrg(ORG_A_UID, ORG_A_NAME)],
        resolvable: [HELD_ORG],
      });
      await stubReadCheck(page, 204);

      await gotoOverview(page);

      await expect(page.getByTestId('org-overview-title')).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(overviewState(page).root).toHaveCount(0);
    });
  });

  // One section stands in for all of them (the shared component is the only renderer). The ROI
  // annual trend mounts once the page-level portfolio (summary + coverage) has data, which the ROI
  // helper's defaults provide; only the section's own endpoint is overridden below. Playwright
  // matches the most recently registered route first, so the override wins over the helper's.
  test.describe('section level — ROI annual trend (FR-013 – FR-015)', () => {
    const ANNUAL = '**/api/orgs/*/lens/roi/annual*';
    const section = (page: Page) => ({
      root: page.getByTestId('org-roi-annual-trend-empty-state'),
      title: page.getByTestId('org-roi-annual-trend-empty-title'),
      retry: page.getByTestId('org-roi-annual-trend-empty-retry'),
      contactSupport: page.getByTestId('org-roi-annual-trend-empty-contact-support'),
    });

    async function stubAnnualFailure(page: Page, status: number, body: unknown): Promise<{ requests: () => number }> {
      let requests = 0;
      await page.route(ANNUAL, (route) => {
        requests += 1;
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      });
      return { requests: () => requests };
    }

    test('S1a: no rows for an entitled caller renders the genuine-empty state, distinct from an outage', async ({ page }) => {
      await stubOrgLensContext(page, { annual: { method: 'blended', rows: [], apportioned: false } });
      await gotoOrgRoiPage(page);

      const { root, title, retry } = section(page);
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'section-empty');
      // FR-013: "No {things} recorded" where no period applies — and no Retry, because nothing failed.
      await expect(title).toHaveText('No ROI records recorded');
      await expect(retry).toHaveCount(0);
      await expect(root).not.toContainText('could not');
      await expect(page.getByTestId('org-roi-annual-trend-chart')).toHaveCount(0);
    });

    test('S1b: a refusal stating the access check was unavailable renders could-not-verify with Retry, not no-access and not empty', async ({ page }) => {
      await stubOrgLensContext(page);
      const { requests } = await stubAnnualFailure(page, 503, { code: 'ROLE_GRANTS_UNAVAILABLE', message: 'stubbed' });
      await gotoOrgRoiPage(page);

      const { root, title, retry } = section(page);
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'section-could-not-verify');
      await expect(title).toHaveText('Access could not be verified');
      await expect(root).not.toContainText('You do not have access');
      await expect(retry).toBeVisible();

      // Retry re-issues the section's own request.
      const before = requests();
      await retry.click();
      await expect.poll(requests, { timeout: SETTLE_TIMEOUT }).toBeGreaterThan(before);
    });

    test('S1c: a refusal for lack of access renders the shared section no-access wording', async ({ page }) => {
      await stubOrgLensContext(page);
      await stubAnnualFailure(page, 403, { code: 'FORBIDDEN', message: 'stubbed' });
      await gotoOrgRoiPage(page);

      const { root, title, retry, contactSupport } = section(page);
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'section-no-access');
      await expect(title).toHaveText('You do not have access to this organization');
      await expect(contactSupport).toBeVisible();
      await expect(retry).toHaveCount(0);
      // Retired wording must not come back through the section path either.
      await expect(page.locator('body')).not.toContainText('You do not have Org Lens access for this organization.');
    });

    test('S1c′: the refusal reason decides, not the status — a 403 stating the check was unavailable is could-not-verify', async ({ page }) => {
      await stubOrgLensContext(page);
      await stubAnnualFailure(page, 403, { code: 'ROLE_GRANTS_UNAVAILABLE', message: 'stubbed' });
      await gotoOrgRoiPage(page);

      const { root, title } = section(page);
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'section-could-not-verify');
      await expect(title).toHaveText('Access could not be verified');
    });

    test('S1d: a non-access failure renders section could-not-load with Retry', async ({ page }) => {
      await stubOrgLensContext(page);
      const { requests } = await stubAnnualFailure(page, 500, { message: 'stubbed' });
      await gotoOrgRoiPage(page);

      const { root, title, retry } = section(page);
      await expect(root).toBeVisible({ timeout: SETTLE_TIMEOUT });
      await expect(root).toHaveAttribute('data-state', 'section-could-not-load');
      await expect(title).toHaveText('This section could not be loaded');
      await expect(root).not.toContainText('access');
      await expect(retry).toBeVisible();

      const before = requests();
      await retry.click();
      await expect.poll(requests, { timeout: SETTLE_TIMEOUT }).toBeGreaterThan(before);
    });
  });
});
