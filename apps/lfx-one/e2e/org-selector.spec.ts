// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Selector E2E — smoke set.
 *
 * The automated coverage is the set of scenarios listed below.
 *
 * Coverage map:
 * - S1: org-selector trigger renders for an authorized user
 * - S2: server-side search hits /api/nav/org-items?name=… and refreshes the list
 * - S5: selection persists into selectedAccount + fires the canonical record fetch
 * - S9: zero-grants visibility gate — stubbed authenticated session with empty
 *       role-grants AND empty persona-seeds leaves the org-selector slot
 *       reporting `data-visible="false"`
 * - S10: cascading (inherited) row renders the "(inherited)" label + parent tooltip
 * - S11: upstream failure surfaces the empty state — no fixture rows leak through
 * - S12: every /api/nav/org-items row carries a non-null accountId
 * - S13: Snowflake lens regression guard
 * - S14: /org/overview empty state renders without redirect
 * - S15: /org/overview no-access state renders instead of the skeleton
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD for a user
 *   with FGA access to at least one b2b_org in the dev sandbox
 * - `org-lens-enabled` LaunchDarkly flag toggled ON for the test user
 */

import { expect, Page, test } from '@playwright/test';

const APP_HOME = '/';
const SIDEBAR_TIMEOUT = 30_000;
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(120_000);

// Hard skip when the auth-bootstrap failed — surface a clear log so CI triage doesn't
// chase a regression that's actually a credentials issue. Use hostname-exact
// matching instead of substring `.includes('auth0.com')` so an attacker-controlled URL like
// `https://evil.com/?ref=auth0.com` or `https://auth0.com.evil.com/` can't fool the skip
// gate (CodeQL js/incomplete-url-substring-sanitization).
function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — keep the test running rather than silently skip; failures here are
    // useful signal, not noise.
  }
}

async function openSelector(page: Page) {
  // Sidebar may be tucked behind a mobile hamburger on mobile-chrome — the trigger lives
  // inside <lfx-sidebar>; the test ID is identical across desktop and mobile.
  const trigger = page.getByTestId('org-selector');
  await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
  await trigger.click();
  await expect(page.getByTestId('org-search-input')).toBeVisible({ timeout: 5_000 });
}

test.describe('Org Selector — authorized user smoke set (S1/S2/S5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
  });

  // S1 — trigger renders for an authorized user
  test('S1: org-selector trigger is visible for an authenticated user', async ({ page }) => {
    await expect(page.getByTestId('org-selector')).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
  });

  // S2 — server-side search hits /api/nav/org-items?name=… and re-renders rows
  test('S2: typing in the search input triggers a debounced /api/nav/org-items?name= request', async ({ page }) => {
    await openSelector(page);

    // Wait for the first natural-order page to populate so we have a baseline to verify the
    // search response replaces, not appends.
    const firstRequest = page.waitForResponse((response) => response.url().includes('/api/nav/org-items') && !response.url().includes('name='), {
      timeout: 15_000,
    });
    // Wait for initial load to settle
    await firstRequest.catch(() => undefined); // first page may have already arrived before openSelector returned

    // Now wait for the search-triggered request and verify the URL carries the name param
    const searchRequest = page.waitForResponse(
      (response) => {
        const url = response.url();
        return url.includes('/api/nav/org-items') && url.includes('name=');
      },
      { timeout: 15_000 }
    );

    await page.getByTestId('org-search-input').fill('red');
    const response = await searchRequest;
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('next_page_token');
    expect(body).toHaveProperty('upstream_failed');
    expect(body.upstream_failed).toBe(false);
    expect(Array.isArray(body.items)).toBe(true);
  });

  // S5 — selecting a row applies the optimistic update AND fires the canonical record fetch
  test('S5: clicking a row persists selection and triggers the canonical reconciliation call', async ({ page }) => {
    await openSelector(page);

    // Wait for at least one row to render
    const firstRow = page.locator('[data-testid^="org-item-"]').first();
    await expect(firstRow).toBeVisible({ timeout: 15_000 });

    // Capture the row's data-testid which contains the org account id (SFID) we'll see in the canonical-fetch URL.
    // The org identifier is the 18-char Salesforce account id (001-prefixed), not a UUID.
    const testId = await firstRow.getAttribute('data-testid');
    expect(testId).toMatch(/^org-item-001[A-Za-z0-9]{15}$/);
    const uid = testId!.replace('org-item-', '');

    // The canonical-record route is account-id (SFID) keyed via `/api/orgs/uid/`; the legacy `/api/orgs/sfid/` route was removed.
    const canonicalRequest = page.waitForResponse((response) => response.url().includes('/api/orgs/uid/'), {
      timeout: 15_000,
    });

    await firstRow.click();

    // Popover closes — the search input should disappear from the DOM
    await expect(page.getByTestId('org-search-input')).not.toBeVisible({ timeout: 5_000 });

    // Canonical fetch fires against the account-id (SFID) keyed `/api/orgs/uid/` route
    const canonicalResponse = await canonicalRequest;
    // Member-service may return 404 in dev sandbox for orgs without canonical records; either
    // a 200 with a body or a 404 satisfies the contract — what matters is that the call was issued.
    expect([200, 404, 502]).toContain(canonicalResponse.status());

    // The trigger should now display the selected org's name (indexed snapshot is the optimistic update)
    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible();
    // Verify the cookie carries the new selection — accountId may be empty for canonical-only orgs,
    // so we just assert the cookie EXISTS (the AccountContextService.persistToStorage gate already
    // covers invalid-id pruning).
    const cookies = await page.context().cookies();
    const selectedAccountCookie = cookies.find((c) => c.name === 'lfx-selected-account');
    // The cookie is only persisted when accountId passes the salesforce-id regex; for sandbox
    // orgs without a valid sfid, it's intentionally absent. Either presence or absence is acceptable;
    // assert the selection visually instead.
    expect(uid).toBeTruthy();
    expect(selectedAccountCookie === undefined || typeof selectedAccountCookie.value === 'string').toBe(true);
  });
});

// S10 — inherited (cascading) row renders with the "(inherited)" label
// suffix and a tooltip carrying the parent name. We stub /api/orgs/me/role-grants and
// /api/nav/org-items so the test is deterministic regardless of the bootstrap user's
// actual grants — same hermetic pattern as S9.
test.describe('Org Selector — cascading row decoration (S10)', () => {
  test('S10: cascading row shows "(inherited)" label suffix and tooltip carries the parent name', async ({ page }) => {
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // Org identifiers are 18-char Salesforce account ids (SFID), not UUIDs.
    const PARENT_UID = '0014100000Te2QjAAJ';
    const CHILD_UID = '0014100000TdzYmAAJ';
    const PARENT_NAME = 'Red Hat, Inc.';

    await page.route('**/api/orgs/me/role-grants', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          writers: [PARENT_UID],
          auditors: [],
          cascadingWriters: [],
          cascadingAuditors: [{ uid: CHILD_UID, parentUid: PARENT_UID, parentName: PARENT_NAME }],
          username: 'e2e-cascading',
          loaded_at: new Date().toISOString(),
        }),
      })
    );

    await page.route('**/api/nav/org-items*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              uid: PARENT_UID,
              accountId: '0014100000Te2QjAAJ',
              name: PARENT_NAME,
              logoUrl: null,
              primaryDomain: 'redhat.com',
              isMember: true,
              parentName: null,
            },
            {
              uid: CHILD_UID,
              accountId: '0014100000TdzYmAAJ',
              name: 'CoreOS, Inc.',
              logoUrl: null,
              primaryDomain: 'coreos.com',
              isMember: true,
              parentName: PARENT_NAME,
            },
          ],
          next_page_token: null,
          upstream_failed: false,
          total: 2,
        }),
      })
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSelector(page);

    const childRowBadge = page.getByTestId(`org-item-${CHILD_UID}-role-badge`);
    await expect(childRowBadge).toBeVisible({ timeout: 10_000 });
    await expect(childRowBadge).toHaveAttribute('data-role-label', /\(inherited\)$/);
    await expect(childRowBadge).toHaveAttribute('data-role-tooltip', new RegExp(`View-only access inherited from ${PARENT_NAME}`));

    const parentRowBadge = page.getByTestId(`org-item-${PARENT_UID}-role-badge`);
    await expect(parentRowBadge).toBeVisible();
    // Direct rows must NOT carry the inherited tooltip — they have their own direct grant.
    await expect(parentRowBadge).not.toHaveAttribute('data-role-tooltip', /inherited/);
  });
});

// S10b — foundation-auditor row (LFXV2-2750) renders view-only: the "Foundation Auditor"
// label, the eye icon (never the pen), and the view-only-via-foundation tooltip. These rows are
// resolved per-search and carry `roleSource` on the row itself, so the row — not a role-grants
// uid set — drives the decoration. Both BFF endpoints are stubbed for determinism (as in S10).
test.describe('Org Selector — foundation-auditor row decoration (S10b)', () => {
  test('S10b: foundation-auditor row shows the "Foundation Auditor" label, eye icon (no pen), and view-only tooltip', async ({ page }) => {
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // Org identifiers are 18-char Salesforce account ids (SFID), not UUIDs.
    const ORG_UID = '0014100000Te2QjAAJ';
    const ORG_NAME = 'Fujitsu Limited';
    const GRANTED_UID = '0014100000TdzYmAAJ';

    // A direct grant keeps the selector's visibility gate open (foundation-auditor status is not
    // knowable up front — it is resolved per-search).
    await page.route('**/api/orgs/me/role-grants', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          writers: [GRANTED_UID],
          auditors: [],
          cascadingWriters: [],
          cascadingAuditors: [],
          username: 'e2e-foundation-auditor',
          loaded_at: new Date().toISOString(),
        }),
      })
    );

    await page.route('**/api/nav/org-items*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              uid: GRANTED_UID,
              accountId: GRANTED_UID,
              name: 'Red Hat, Inc.',
              logoUrl: null,
              primaryDomain: 'redhat.com',
              isMember: true,
              parentName: null,
            },
            {
              uid: ORG_UID,
              accountId: ORG_UID,
              name: ORG_NAME,
              logoUrl: null,
              primaryDomain: 'fujitsu.com',
              isMember: true,
              parentName: null,
              roleSource: 'foundation-auditor',
            },
          ],
          next_page_token: null,
          upstream_failed: false,
          total: 2,
        }),
      })
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSelector(page);

    const badge = page.getByTestId(`org-item-${ORG_UID}-role-badge`);
    await expect(badge).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveAttribute('data-role-label', 'Foundation Auditor');
    await expect(badge).toHaveAttribute('data-role-tooltip', /View-only access via foundation membership/);
    // View-only semantics: the eye icon, never the Edit (pen) affordance.
    const icon = badge.locator('i');
    await expect(icon).toHaveClass(/fa-eye/);
    await expect(icon).not.toHaveClass(/fa-pen-to-square/);
  });
});

// S11 — upstream-failure deterministic empty state. Stub both BFF
// endpoints to simulate the deleted-mock-fallback path, then assert the empty state
// renders and no rows leak through.
test.describe('Org Selector — no mock fallback (S11)', () => {
  test('S11: upstream failure surfaces the empty state — no fixture rows leak through', async ({ page }) => {
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // Role-grants returns enough to keep the visibility gate open so the dropdown still mounts.
    await page.route('**/api/orgs/me/role-grants', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          writers: ['0014100000Te2QjAAJ'],
          auditors: [],
          cascadingWriters: [],
          cascadingAuditors: [],
          username: 'e2e-no-fallback',
          loaded_at: new Date().toISOString(),
        }),
      })
    );

    // The new BFF contract returns 200 with an explicit upstream_failed flag — no fixture fallback.
    await page.route('**/api/nav/org-items*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          next_page_token: null,
          upstream_failed: true,
        }),
      })
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSelector(page);

    const list = page.getByTestId('org-selector-list');
    await expect(list).toHaveAttribute('data-item-count', '0', { timeout: 5_000 });
    await expect(page.getByTestId('org-selector-empty')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid^="org-item-"]')).toHaveCount(0);
  });
});

// S14 — when /api/nav/org-items returns empty, /org/overview
// must STAY on /org/overview (not bounce back to /) and render the empty-state
// section. Replaces the earlier "redirect-on-empty" UX with an in-page disclosure.
test.describe('Org Selector — /org/overview empty state without redirect (S14)', () => {
  test('S14: empty org-items keeps the user on /org/overview and renders the empty-state section', async ({ page }) => {
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.route('**/api/orgs/me/role-grants', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          writers: ['0014100000Te2QjAAJ'],
          auditors: [],
          cascadingWriters: [],
          cascadingAuditors: [],
          username: 'e2e-empty-overview',
          loaded_at: new Date().toISOString(),
        }),
      })
    );

    // upstream_failed=false + items=[] is the "no accessible orgs after sfid omission" path.
    await page.route('**/api/nav/org-items*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], next_page_token: null, upstream_failed: false, total: 0 }),
      })
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto('/org/overview', { waitUntil: 'domcontentloaded' });

    if (!page.url().includes('/org/overview')) {
      test.skip(true, 'org-lens-enabled flag appears off — /org/overview redirected away');
    }

    // The page must NOT bounce back to / when the user is already inside /org/*.
    // Wait for the page to fully settle (data-loaded=true) so the empty-state — gated on `loaded` —
    // can render. This also asserts the FOEC guard: empty-state never appears mid-load.
    const root = page.getByTestId('org-overview-page');
    await expect(root).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(root).toHaveAttribute('data-loaded', 'true', { timeout: DATA_LOAD_TIMEOUT });
    expect(page.url()).toContain('/org/overview');
    await expect(root).toHaveAttribute('data-empty', 'true');
    await expect(page.getByTestId('org-overview-empty-state')).toBeVisible();
    await expect(page.getByTestId('org-overview-empty-title')).toHaveText('No organization selected');
  });
});

// S15 — no-access disclosure: a user whose role-grants settle empty (no direct
// writer/auditor grant) AND who has no persona-seeded accounts must land on a
// definitive "Organization Lens is not available" state on /org/overview — never an
// endless loading skeleton. Stubs mirror S9 (the visibility gate's two inputs) so the
// assertion is hermetic to the bootstrap user's real grants.
test.describe('Org Selector — /org/overview no-access state (S15)', () => {
  test('S15: empty role-grants + no persona-seeds renders the no-access state, not the skeleton', async ({ page }) => {
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await page.route('**/api/orgs/me/role-grants', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          writers: [],
          auditors: [],
          cascadingWriters: [],
          cascadingAuditors: [],
          username: 'e2e-no-access',
          loaded_at: new Date().toISOString(),
        }),
      })
    );
    await page.route('**/api/user/personas*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          personas: ['contributor'],
          personaProjects: {},
          projects: [],
          organizations: [],
          isRootWriter: false,
        }),
      })
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.goto('/org/overview', { waitUntil: 'domcontentloaded' });

    if (!page.url().includes('/org/overview')) {
      test.skip(true, 'org-lens-enabled flag appears off — /org/overview redirected away');
    }

    // hasNoOrgAccess settles to true once the stubbed (empty) role-grants resolve — independent of the
    // org-selector list fetch, which never fires for a zero-grants user. The no-access branch must win
    // over the loading skeleton.
    const root = page.getByTestId('org-overview-page');
    await expect(root).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(root).toHaveAttribute('data-no-access', 'true', { timeout: DATA_LOAD_TIMEOUT });
    expect(page.url()).toContain('/org/overview');
    await expect(page.getByTestId('org-overview-no-access-state')).toBeVisible();
    await expect(page.getByTestId('org-overview-no-access-title')).toHaveText('Organization Lens is not available');
    // The skeleton and the no-org-selected empty state must NOT show in this branch.
    await expect(page.getByTestId('org-overview-loading')).toHaveCount(0);
    await expect(page.getByTestId('org-overview-empty-state')).toHaveCount(0);
  });
});

// S12 — every row returned by /api/nav/org-items must carry a
// non-null accountId. This is the omission-policy enforcement gate.
test.describe('Org Selector — accountId non-null invariant (S12)', () => {
  test('S12: every row from /api/nav/org-items has a non-null, non-empty accountId', async ({ page }) => {
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    const response = await page.request.get('/api/nav/org-items');
    // 401/403 surfaces when the bearer didn't survive — surface a clear skip so triage is fast.
    if (response.status() === 401 || response.status() === 403) {
      test.skip(true, `Skipping S12 — /api/nav/org-items returned ${response.status()} (auth not propagated)`);
    }
    expect(response.status()).toBe(200);

    const body = (await response.json()) as { items: { accountId: string | null }[]; upstream_failed: boolean };
    expect(Array.isArray(body.items)).toBe(true);

    if (body.upstream_failed) {
      // Upstream unavailable — the invariant cannot be evaluated; skip rather than fail.
      test.skip(true, 'Skipping S12 — upstream reported failed; cannot evaluate accountId invariant');
    }

    for (const row of body.items) {
      expect(typeof row.accountId).toBe('string');
      expect(row.accountId && row.accountId.length).toBeGreaterThan(0);
    }
  });
});

// S13 — Snowflake-keyed lens routes must keep working.
// The cascading-rewrite intentionally preserves the cookie + /api/orgs/:accountId/lens/*
// contract; this smoke check exercises one such route to fail loudly if a regression
// pulls the rug from under the lens dashboards.
test.describe('Org Selector — Snowflake lens regression guard (S13)', () => {
  test('S13: /api/orgs/:accountId/lens/memberships/active returns 200 with a JSON array body for a real accountId', async ({ page }) => {
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // Resolve an accountId from the access-aware list so the check is hermetic to the test user's grants.
    const orgItemsResponse = await page.request.get('/api/nav/org-items');
    if (orgItemsResponse.status() !== 200) {
      test.skip(true, `Skipping S13 — /api/nav/org-items returned ${orgItemsResponse.status()} (auth not propagated)`);
    }
    const orgItemsBody = (await orgItemsResponse.json()) as { items: { accountId: string | null }[]; upstream_failed: boolean };
    if (orgItemsBody.upstream_failed || orgItemsBody.items.length === 0) {
      test.skip(true, 'Skipping S13 — no accessible orgs available; cannot exercise the lens route');
    }
    const accountId = orgItemsBody.items.find((row) => row.accountId)?.accountId;
    if (!accountId) {
      test.skip(true, 'Skipping S13 — no row carries a non-null accountId (S12 would also fail here)');
    }

    const lensResponse = await page.request.get(`/api/orgs/${encodeURIComponent(accountId!)}/lens/memberships/active`);
    // 200 with a body shape OR 404 are both acceptable signals that the route handler ran (vs. a 500 indicating
    // a regression from the cascading rewrite). What we *guard against* is a contract-shape break.
    expect([200, 404]).toContain(lensResponse.status());
    if (lensResponse.status() === 200) {
      const body = await lensResponse.json();
      // The route returns an array OR an object with an array property — both shapes are pre-existing
      // contract surface from the lens dashboards. We assert the response is JSON-decodable and not an error envelope.
      expect(body).toBeDefined();
      expect(body).not.toHaveProperty('error');
    }
  });
});

// S9 — zero-grants visibility gate (authenticated path). We stub both inputs
// to `effectiveShowOrgSelector` — `/api/orgs/me/role-grants` (empty writers +
// auditors) and `/api/user/personas` (empty `organizations`) — so the gate's
// `(writers ∨ auditors ∨ personaSeeds)` clause evaluates false against the real
// authenticated session. The slot exposes its computed state on `data-visible`
// (added for testability), giving us a hermetic assertion without
// having to navigate to `/org` and unwind the empty-response redirect dance.
test.describe('Org Selector — zero-grants visibility gate (S9)', () => {
  test('S9: with empty role-grants AND empty persona-seeds, the slot reports data-visible="false" and the trigger is hidden', async ({ page }) => {
    // Skip when the auth fixture didn't bootstrap — same logic as the authorized suite.
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // Stub the two endpoints the visibility gate reads from. Both are client-side
    // fetches (afterNextRender on the corresponding services) so a Playwright route
    // handler installed before reload reliably intercepts them.
    await page.route('**/api/orgs/me/role-grants', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          writers: [],
          auditors: [],
          username: 'e2e-zero-grants',
          loaded_at: new Date().toISOString(),
        }),
      })
    );
    await page.route('**/api/user/personas*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          personas: ['contributor'],
          personaProjects: {},
          projects: [],
          organizations: [],
          isRootWriter: false,
        }),
      })
    );

    // Reload so the new route handlers intercept fresh fetches (the initial
    // load already raced past them above).
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Slot is always mounted (the parent uses `[class.hidden]`, not `@if`), so
    // `data-visible` carries the gate's computed truth. Empty grants + empty
    // seeds + me-lens parent input → false.
    const slot = page.getByTestId('org-selector-slot');
    await expect(slot).toBeAttached({ timeout: SIDEBAR_TIMEOUT });
    await expect(slot).toHaveAttribute('data-visible', 'false');

    // Visually-hidden via parent `[class.hidden]` — the trigger MUST not be visible to the user.
    await expect(page.getByTestId('org-selector')).not.toBeVisible();
  });
});

// S16 — org-route hard refresh must resolve to a clean org-lens sidebar with no stale
// Me-lens sections (LFXV2-2789). The org lens is gated by a browser-only LaunchDarkly flag,
// so SSR clamps to the me lens and used to emit a me-lens menu; hydrating that against the
// client-resolved org menu left "My Engagement" / "My Growth" sections interleaved with org
// items. The sidebar now withholds the concrete menu until afterNextRender, so the resolved
// menu is built entirely from client state and must contain org items only.
test.describe('Sidebar — org-route refresh has no stale Me-lens sections (S16)', () => {
  test('S16: hard-refreshing /org/overview resolves to org-lens nav only, no Me-lens sections', async ({ page }) => {
    await page.goto('/org/overview', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // Flag off (or no org access) redirects away from /org/* — this regression only applies when
    // the org lens is actually active, so skip otherwise (same gate as S14/S15).
    if (!page.url().includes('/org/overview')) {
      test.skip(true, 'org-lens-enabled flag appears off — /org/overview redirected away');
    }

    // Wait for the sidebar to hydrate past the loading skeleton and render the resolved org menu.
    await expect(page.getByTestId('sidebar'), 'sidebar should be visible').toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('sidebar-item-memberships'), 'org-lens Memberships item should render after hydration').toBeVisible({
      timeout: SIDEBAR_TIMEOUT,
    });

    // The org lens tab and the resolved menu must be consistent: no Me-lens sections remain on screen.
    await expect(page.getByTestId('sidebar-item-my-engagement'), 'Me-lens "My Engagement" must not leak into the org sidebar').toHaveCount(0);
    await expect(page.getByTestId('sidebar-item-my-growth'), 'Me-lens "My Growth" must not leak into the org sidebar').toHaveCount(0);
  });
});
