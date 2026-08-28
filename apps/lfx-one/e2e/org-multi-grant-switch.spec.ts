// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Multi-Organization Switching E2E — non-staff, two unrelated direct grants.
 *
 * Verifies that one person may hold explicit grants on multiple unrelated
 * organizations, switch between them, and have every subsequent Org Lens fetch
 * honor the newly selected organization — with no email-domain gating of any
 * kind, and no leakage from the staff catalogue for ordinary users.
 *
 * Test cases:
 * - M1: Both directly granted rows appear with correct role labels; selecting
 *       organization B scopes every subsequent Org Lens fetch to B's uid.
 * - M2: Selection persists across a page reload (cookie contract).
 * - M3: A third organization the user has no grant on is refused when its
 *       Org Lens URL is fetched directly.
 * - M4: A non-staff user does NOT see the staff catalogue search affordance,
 *       and the listbox contains exactly the seeded direct grants with no
 *       leakage from the staff catalogue path.
 * - M5: When the BFF role-grants call fails, the switcher renders the
 *       unavailable state and no lens fetch is issued for a previously selected
 *       organization while the failure is active. Fail-closed.
 * - M6: Grant B added does not modify A; grant B revoked leaves A unchanged.
 *       Verified via before/after stub-swap deep-equal on A's role label + name.
 * - M7: Email domain does not confer or block access — verified by construction
 *       (the seeded grants use domains unrelated to the caller's identity) plus
 *       a direct-fetch refusal on an ungranted org.
 * - M8: When the actively selected organization is revoked while others remain,
 *       the switcher auto-selects the first remaining valid organization on the
 *       next load and does NOT surface a "revoked" toast.
 *
 * All grants and rows in this file are stubbed via `page.route` so the test is
 * deterministic regardless of the bootstrap identity.
 */

import { expect, Page, Request, test } from '@playwright/test';

// The org-selector trigger only renders (data-visible=true) while the active lens is 'org'; on the
// default 'me' lens the sidebar keeps it in the DOM but CSS-hidden. Navigating to `/org` sets the
// active lens deterministically so these tests never depend on a per-user cookie preference.
const APP_HOME = '/org';
const SIDEBAR_TIMEOUT = 30_000;

test.setTimeout(120_000);

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

// Two unrelated organizations with intentionally distinct primary domains, so the
// domain-doesn't-gate assertions (M7) exercise the "different domain" case rather than a
// coincidence. SFIDs are exactly 18 chars (`001` prefix + 15 alphanumerics); anything else
// fails the `AccountContextService` regex and the selection cookie never persists across a
// reload.
const ORG_A_UID = '0014100000MgaAAAAA';
const ORG_B_UID = '0014100000MgbBBBBB';
const ORG_A_NAME = 'MultiGrant Alpha, Inc.';
const ORG_B_NAME = 'MultiGrant Bravo, LLC';
const ORG_UNGRANTED_UID = '0014100000MgcCCCCC';

// Cross-domain assertion: the caller's email domain does not match either org. The Auth0 test
// identity resolves to a domain unrelated to alpha.example / bravo.example.
const ROLE_GRANTS_BODY_ACTIVE = {
  writers: [ORG_A_UID, ORG_B_UID],
  auditors: [],
  cascadingWriters: [],
  cascadingAuditors: [],
  isStaff: false,
  username: 'e2e-multi-grant',
  loaded_at: new Date().toISOString(),
};

const ORG_ITEMS_BODY_ACTIVE = {
  items: [
    { uid: ORG_A_UID, accountId: ORG_A_UID, name: ORG_A_NAME, logoUrl: null, primaryDomain: 'alpha.example', isMember: true, parentName: null },
    { uid: ORG_B_UID, accountId: ORG_B_UID, name: ORG_B_NAME, logoUrl: null, primaryDomain: 'bravo.example', isMember: true, parentName: null },
  ],
  next_page_token: null,
  upstream_failed: false,
  total: 2,
};

async function stubActiveGrants(page: Page): Promise<void> {
  await page.route('**/api/orgs/me/role-grants', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROLE_GRANTS_BODY_ACTIVE) })
  );
  await page.route('**/api/nav/org-items*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORG_ITEMS_BODY_ACTIVE) })
  );
}

test.describe('Multi-Organization Switching — non-staff, two unrelated direct grants', () => {
  test.beforeEach(async ({ page }) => {
    await stubActiveGrants(page);
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
  });

  test('M1: both rows appear with role labels; selecting B scopes subsequent lens fetches to B', async ({ page }) => {
    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const listbox = page.locator('#org-selector-listbox');
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    const rowA = page.getByTestId(`org-item-${ORG_A_UID}`);
    const rowB = page.getByTestId(`org-item-${ORG_B_UID}`);
    await expect(rowA).toBeVisible();
    await expect(rowB).toBeVisible();

    // Role labels: both are direct writer, so the badge reads 'Org Admin Editor' (non-inherited).
    await expect(page.getByTestId(`org-item-${ORG_A_UID}-role-badge`)).toHaveAttribute('data-role-label', 'Org Admin Editor');
    await expect(page.getByTestId(`org-item-${ORG_B_UID}-role-badge`)).toHaveAttribute('data-role-label', 'Org Admin Editor');

    // Capture every lens-scoped request fired AFTER the click. Filtering by B's uid alone (as
    // waitForRequest would) can't fail if A is fetched first and B later — the assertion must
    // instead prove (a) the first post-click lens fetch targets B, and (b) no A-scoped lens
    // fetch is issued after the switch.
    const lensRequestsPostClick: string[] = [];
    const captureLensRequest = (request: Request): void => {
      const url = request.url();
      if (/\/api\/orgs\/[^/]+\/lens\//.test(url)) {
        lensRequestsPostClick.push(url);
      }
    };
    page.on('request', captureLensRequest);
    // Register the waiter BEFORE the click so a lens request dispatched synchronously off the
    // click can't complete before the waiter exists (per the canonical-request pattern in
    // `org-selector.spec.ts:145-156`).
    const lensRequestForB = page.waitForRequest((request) => request.url().includes(`/api/orgs/${ORG_B_UID}/lens/`), { timeout: 15_000 });
    try {
      await rowB.click();
      // Panel closes on selection — active org is unambiguous immediately after switching.
      await expect(page.getByTestId('org-selector-list')).not.toBeVisible({ timeout: 5_000 });
      // Wait until at least one lens fetch for B lands, proving the selection actually propagated.
      await lensRequestForB;
      // Small buffer so any late A-scoped fetch (which would prove the switch didn't happen
      // atomically) shows up in the captured set instead of racing past the assertion below.
      await page.waitForTimeout(500);
    } finally {
      page.off('request', captureLensRequest);
    }

    expect(lensRequestsPostClick.length, 'at least one lens fetch should follow the switch').toBeGreaterThan(0);
    expect(lensRequestsPostClick[0], 'first post-click lens fetch must target B, not A').toContain(`/api/orgs/${ORG_B_UID}/lens/`);
    expect(
      lensRequestsPostClick.filter((url) => url.includes(`/api/orgs/${ORG_A_UID}/lens/`)),
      'no A-scoped lens fetch should be issued after selecting B'
    ).toEqual([]);
  });

  test('M2: selection persists across a page reload (cookie contract)', async ({ page, context }) => {
    // The persistence contract is the `lfx-selected-account` cookie: AccountContextService reads it
    // on every bootstrap (constructor + initializeUserOrganizations) and reselects the matching
    // seed. Asserting on the cookie post-click + post-reload verifies the contract hermetically.
    // The DOM re-hydration path (persona API → seed match → aria-selected) requires stubbing the
    // full persona payload, which is out of scope for a switching test.
    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const rowB = page.getByTestId(`org-item-${ORG_B_UID}`);
    await expect(rowB).toBeVisible();
    await rowB.click();
    await expect(page.getByTestId('org-selector-list')).not.toBeVisible({ timeout: 5_000 });

    const readCookie = async (): Promise<string | undefined> => {
      const cookies = await context.cookies();
      return cookies.find((c) => c.name === 'lfx-selected-account')?.value;
    };

    // Post-click: the cookie now encodes B.
    const afterClick = await readCookie();
    expect(afterClick, 'cookie should exist after clicking B').toBeDefined();
    // Cookies are URL-encoded by ngx-cookie-service; decode before JSON.parse.
    const parsedAfterClick = JSON.parse(decodeURIComponent(afterClick!));
    expect(parsedAfterClick).toEqual({ uid: ORG_B_UID });

    // Post-reload: the cookie STILL encodes B, and is what a fresh AccountContextService reads.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const afterReload = await readCookie();
    expect(afterReload, 'cookie should survive reload').toBeDefined();
    const parsedAfterReload = JSON.parse(decodeURIComponent(afterReload!));
    expect(parsedAfterReload).toEqual({ uid: ORG_B_UID });
  });

  test('M3: fetching an ungranted org is refused, regardless of email domain', async ({ page }) => {
    // Ordinary users never see an org they were not granted — even if it exists in the catalogue.
    // Direct fetch MUST be refused by the shared read-gate middleware (`requireOrgLensAccess`),
    // which throws a `MicroserviceError(403, 'FORBIDDEN')` for a caller with no grant on the
    // requested uid. Hitting a REGISTERED lens endpoint here is deliberate: an unmatched route
    // (e.g. `/lens/summary`) returns 404 whether or not the middleware exists, so a stale test
    // would not catch a regression that removed the gate.
    const response = await page.request.get(`/api/orgs/${ORG_UNGRANTED_UID}/lens/events/summary`, { failOnStatusCode: false });
    expect(response.status(), 'gate must reply 403 for an ungranted caller on a real lens endpoint').toBe(403);
  });

  test('M4: non-staff user sees NO staff catalogue affordance and exactly the seeded grants', async ({ page }) => {
    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const listbox = page.locator('#org-selector-listbox');
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // No staff catalogue search input — the entire affordance is gated behind isStaff().
    await expect(page.getByTestId('org-search-input')).toHaveCount(0);

    // The listbox contains EXACTLY the two seeded direct grants — nothing extra leaks from the staff
    // catalogue path. If a future regression accidentally widens ordinary-user discovery, this count
    // assertion fails.
    const options = listbox.locator('[role="option"]');
    await expect(options).toHaveCount(2);
    await expect(page.getByTestId(`org-item-${ORG_A_UID}`)).toBeVisible();
    await expect(page.getByTestId(`org-item-${ORG_B_UID}`)).toBeVisible();
  });

  test('M6: grant B added does not modify A; grant B revoked leaves A unchanged', async ({ page, context }) => {
    // Snapshot A's row from a "before B was added" state — the stub returns only A.
    await context.unroute('**/api/orgs/me/role-grants');
    await context.unroute('**/api/nav/org-items*');
    const roleGrantsOnlyA = {
      writers: [ORG_A_UID],
      auditors: [],
      cascadingWriters: [],
      cascadingAuditors: [],
      isStaff: false,
      username: 'e2e-multi-grant',
      loaded_at: new Date().toISOString(),
    };
    const orgItemsOnlyA = {
      items: [{ uid: ORG_A_UID, accountId: ORG_A_UID, name: ORG_A_NAME, logoUrl: null, primaryDomain: 'alpha.example', isMember: true, parentName: null }],
      next_page_token: null,
      upstream_failed: false,
      total: 1,
    };
    await page.route('**/api/orgs/me/role-grants', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roleGrantsOnlyA) })
    );
    await page.route('**/api/nav/org-items*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(orgItemsOnlyA) }));
    await page.reload({ waitUntil: 'domcontentloaded' });

    let trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const rowABefore = page.getByTestId(`org-item-${ORG_A_UID}`);
    await expect(rowABefore).toBeVisible({ timeout: 5_000 });
    const roleBefore = await page.getByTestId(`org-item-${ORG_A_UID}-role-badge`).getAttribute('data-role-label');
    const nameBefore = await page.getByTestId(`org-item-${ORG_A_UID}-name`).textContent();
    await page.keyboard.press('Escape');

    // Simulate "administrator granted B": swap stubs so both A and B are writers.
    await context.unroute('**/api/orgs/me/role-grants');
    await context.unroute('**/api/nav/org-items*');
    await stubActiveGrants(page);
    await page.reload({ waitUntil: 'domcontentloaded' });

    trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    // A's role label and displayed name are byte-for-byte identical after B is added.
    await expect(page.getByTestId(`org-item-${ORG_A_UID}-role-badge`)).toHaveAttribute('data-role-label', roleBefore ?? '');
    const nameAfter = await page.getByTestId(`org-item-${ORG_A_UID}-name`).textContent();
    expect(nameAfter).toBe(nameBefore);

    // Simulate "administrator revoked B": swap stubs back to only-A.
    await context.unroute('**/api/orgs/me/role-grants');
    await context.unroute('**/api/nav/org-items*');
    await page.route('**/api/orgs/me/role-grants', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roleGrantsOnlyA) })
    );
    await page.route('**/api/nav/org-items*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(orgItemsOnlyA) }));
    await page.reload({ waitUntil: 'domcontentloaded' });

    trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    // A's role label and name unchanged after B was revoked.
    await expect(page.getByTestId(`org-item-${ORG_A_UID}-role-badge`)).toHaveAttribute('data-role-label', roleBefore ?? '');
    const nameAfterRevoke = await page.getByTestId(`org-item-${ORG_A_UID}-name`).textContent();
    expect(nameAfterRevoke).toBe(nameBefore);
  });

  test('M7: domain match does not confer access; domain mismatch does not block a granted org', async ({ page }) => {
    // The active stub sets ORG_A and ORG_B with primary domains that intentionally do NOT match the
    // Auth0 test identity's email domain. If the caller can select B and the switcher renders it,
    // "differing domain must not block grant" is verified by construction.
    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const rowB = page.getByTestId(`org-item-${ORG_B_UID}`);
    await expect(rowB).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId(`org-item-${ORG_B_UID}-role-badge`)).toHaveAttribute('data-role-label', 'Org Admin Editor');

    // An ungranted org with any domain — matching or not — MUST NOT confer access via the API.
    // The direct fetch below carries no grant tuple for ORG_UNGRANTED_UID and must be refused by
    // `requireOrgLensAccess` with 403. Same rationale as M3: a REGISTERED lens endpoint is used
    // so a regression that dropped the gate can't hide behind a 404 from an unmatched route.
    const response = await page.request.get(`/api/orgs/${ORG_UNGRANTED_UID}/lens/events/summary`, { failOnStatusCode: false });
    expect(response.status(), 'gate must reply 403 for an ungranted caller on a real lens endpoint').toBe(403);
  });

  test('M8: selected-org revoked while others remain auto-selects the first remaining org', async ({ page, context }) => {
    // Select B first while both grants are active.
    let trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();
    await page.getByTestId(`org-item-${ORG_B_UID}`).click();
    await expect(page.getByTestId('org-selector-list')).not.toBeVisible({ timeout: 5_000 });

    // Simulate B being revoked: reset stubs so only A remains.
    await context.unroute('**/api/orgs/me/role-grants');
    await context.unroute('**/api/nav/org-items*');
    const roleGrantsOnlyA = {
      writers: [ORG_A_UID],
      auditors: [],
      cascadingWriters: [],
      cascadingAuditors: [],
      isStaff: false,
      username: 'e2e-multi-grant',
      loaded_at: new Date().toISOString(),
    };
    await page.route('**/api/orgs/me/role-grants', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(roleGrantsOnlyA) })
    );
    await page.route('**/api/nav/org-items*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{ uid: ORG_A_UID, accountId: ORG_A_UID, name: ORG_A_NAME, logoUrl: null, primaryDomain: 'alpha.example', isMember: true, parentName: null }],
          next_page_token: null,
          upstream_failed: false,
          total: 1,
        }),
      })
    );

    // Reload — the per-user cache is invalidated by the fresh session; the persisted selection points
    // at B (now revoked). Auto-select MUST land on A. No toast MUST appear.
    await page.reload({ waitUntil: 'domcontentloaded' });

    trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const listbox = page.locator('#org-selector-listbox');
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // Exactly one row (A) is present and it is the aria-selected one.
    const options = listbox.locator('[role="option"]');
    await expect(options).toHaveCount(1);
    await expect(page.getByTestId(`org-item-${ORG_A_UID}`)).toHaveAttribute('aria-selected', 'true');

    // No revocation-recovery toast is expected. If PrimeNG toasts exist in the DOM, none of them should
    // carry text about revoked access.
    const toasts = page.locator('.p-toast-message, [role="status"]');
    const toastTexts = await toasts.allTextContents();
    for (const text of toastTexts) {
      expect(text.toLowerCase()).not.toContain('revoked');
      expect(text.toLowerCase()).not.toContain('no longer');
    }
  });

  test('M5: fail-closed when the role-grants BFF call fails', async ({ page, context }) => {
    // Route override for THIS test only — clear the earlier active-grants route and install a failing one.
    await context.unroute('**/api/orgs/me/role-grants');
    await context.unroute('**/api/nav/org-items*');
    await page.route('**/api/orgs/me/role-grants', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{}' }));
    await page.route('**/api/nav/org-items*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], next_page_token: null, upstream_failed: true, total: 0 }),
      })
    );

    // Assert that no lens fetch is issued for the previously selected organization while the failure
    // is active. Any attempted /api/orgs/<uid>/lens/* request MUST NOT fire against ORG_A_UID or ORG_B_UID.
    const forbiddenLensRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes(`/api/orgs/${ORG_A_UID}/`) || url.includes(`/api/orgs/${ORG_B_UID}/`)) {
        forbiddenLensRequests.push(url);
      }
    });

    await page.reload({ waitUntil: 'domcontentloaded' });

    // Under failure, the switcher renders the unavailable / empty state instead of stale rows. The
    // trigger MAY still render (identity is available from the session cookie), but the panel body
    // MUST show the empty state when opened, not stale grants.
    const trigger = page.getByTestId('org-selector');
    if (await trigger.isVisible()) {
      await trigger.click();
      const empty = page.getByTestId('org-selector-empty');
      // Either the empty state renders, or the list is empty (zero role="option" rows). Both satisfy
      // fail-closed; either is acceptable across SSR/CSR timing.
      const listbox = page.locator('#org-selector-listbox');
      if (await listbox.isVisible()) {
        const options = listbox.locator('[role="option"]');
        expect(await options.count()).toBe(0);
      } else {
        await expect(empty).toBeVisible({ timeout: 5_000 });
      }
    }

    // No lens fetch fired for either previously known organization — proves stale grants were not used.
    expect(forbiddenLensRequests).toEqual([]);
  });
});
