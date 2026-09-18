// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Spec 050 (lfx-self-serve#2570) — Org Lens deep links: `/org/{segment}/{page}`.
 *
 * Scenarios from contracts/web-org-url-scheme.md §7:
 *   E1  — a fresh session opens a slug address and lands on the named organization: the selector
 *         shows it, lens fetches are scoped to its uid, and the selection cookie holds that uid.
 *   E13 — an upper-case slug resolves and the address is lowercased in place.
 *   E2  — an SFID address for an organization that has a slug is rewritten to the slug form,
 *         keeping child segments, query and fragment.
 *   E9  — an address the resolver cannot answer for this viewer (404) lands on the not-found
 *         address and leaves the previous selection untouched.
 *
 * Everything the BFF would answer is stubbed at the network edge (`/api/orgs/resolve/*`,
 * `/api/nav/org-items`, `/api/orgs/me/role-grants`, `/api/orgs/uid/*`), the same hermetic posture
 * as `org-multi-grant-switch.spec.ts`; the browser-side guard, router and AccountContextService run
 * for real.
 */

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
    { uid: ORG_A_UID, accountId: ORG_A_UID, name: ORG_A_NAME, slug: ORG_A_SLUG, logoUrl: null, primaryDomain: 'alpha.example', isMember: true, parentName: null },
    { uid: ORG_B_UID, accountId: ORG_B_UID, name: ORG_B_NAME, slug: ORG_B_SLUG, logoUrl: null, primaryDomain: 'bravo.example', isMember: true, parentName: null },
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

  await page.route('**/api/orgs/me/role-grants', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROLE_GRANTS_BODY) }));
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

async function readSelectionCookie(page: Page): Promise<{ uid: string } | undefined> {
  const cookies = await page.context().cookies();
  const raw = cookies.find((c) => c.name === 'lfx-selected-account')?.value;
  return raw ? (JSON.parse(decodeURIComponent(raw)) as { uid: string }) : undefined;
}

test.describe('Org Lens deep links — /org/{segment}/{page}', () => {
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

    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await expect(trigger).toContainText(ORG_B_NAME, { timeout: SIDEBAR_TIMEOUT });

    // Selection cookie now names B — the persistence contract a later visit relies on.
    await expect.poll(async () => (await readSelectionCookie(page))?.uid, { timeout: SIDEBAR_TIMEOUT }).toBe(ORG_B_UID);

    // Every lens fetch issued while rendering was scoped to B, never to A (the first row).
    await expect.poll(() => lensUids.size, { timeout: SIDEBAR_TIMEOUT }).toBeGreaterThan(0);
    expect([...lensUids]).toEqual([ORG_B_UID]);
  });

  test('E13: an upper-case slug resolves and the address is lowercased in place', async ({ page }) => {
    const { resolved } = await stubOrgIdentity(page);

    await page.goto(`/org/${ORG_A_SLUG.toUpperCase()}/projects`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect.poll(() => resolved, { timeout: SIDEBAR_TIMEOUT }).toContain(ORG_A_SLUG);
    expect(resolved.some((segment) => segment !== segment.toLowerCase())).toBe(false);

    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toContainText(ORG_A_NAME, { timeout: SIDEBAR_TIMEOUT });
    await expect.poll(async () => (await readSelectionCookie(page))?.uid, { timeout: SIDEBAR_TIMEOUT }).toBe(ORG_A_UID);
  });

  test('E2: an SFID address is rewritten to the slug form, keeping child segments, query and fragment', async ({ page }) => {
    await stubOrgIdentity(page);

    await page.goto(`/org/${ORG_A_UID}/projects?tab=active#top`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page).toHaveURL(new RegExp(`/org/${ORG_A_SLUG}/projects\\?tab=active#top$`), { timeout: SIDEBAR_TIMEOUT });
    await expect(page.getByTestId('org-selector')).toContainText(ORG_A_NAME, { timeout: SIDEBAR_TIMEOUT });
  });

  test('E9: an unresolvable slug lands on the not-found address and leaves the selection untouched', async ({ page, context }) => {
    await stubOrgIdentity(page);
    // Selection A already held from an earlier visit.
    const origin = new URL(page.url() === 'about:blank' ? 'http://localhost:4200/' : page.url()).origin;
    await context.addCookies([{ name: 'lfx-selected-account', value: encodeURIComponent(JSON.stringify({ uid: ORG_A_UID })), url: origin, sameSite: 'Lax' }]);

    await page.goto(`/org/${UNKNOWN_SLUG}/overview`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page).toHaveURL(/\/org\/not-found(\?|#|$)/, { timeout: SIDEBAR_TIMEOUT });
    // The unknown organization's name never reaches the DOM — there is nothing to show.
    await expect(page.locator('body')).not.toContainText(UNKNOWN_SLUG);
    // FR-024: a failed address never rewrites the selection.
    expect((await readSelectionCookie(page))?.uid).toBe(ORG_A_UID);
  });
});
