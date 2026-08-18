// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * ED Marketing Overview — a failed analytics read must never render as a measured zero.
 *
 * This closes the one gap the unit suite structurally cannot: the `[unavailable]` bindings in
 * `marketing-overview.component.html`. Deleting one of those bindings leaves every existing
 * spec green — the binding EXPRESSION is tested against an equivalent host component, and the
 * drawers are tested with their inputs set directly, so neither exercises the real template.
 *
 * The defect this guards against was reported on Agentic AI Foundation: /api/analytics/brand-reach
 * failed inside the dashboard's request burst and the Social card rendered "0 · 0 platforms" for a
 * foundation with 17,269 followers across 2 platforms. It has since been fixed at four layers
 * (BFF rethrow → client propagation → card guard → drawer suppression); this asserts the whole
 * chain end to end, through the real template, with a genuinely failing HTTP response.
 *
 * Coverage:
 *   E1  A 500 on one endpoint renders that card's unavailable state, not a zero
 *   E2  Its drawer suppresses the body and says the data could not be loaded
 *   E3  Cards whose endpoints succeeded still render their measured values
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 */

import { expect, Page, test } from '@playwright/test';

import type { LensItem, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';

import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';

const FOUNDATION_SLUG = 'test-foundation';
const LOAD_TIMEOUT = 30_000;

const FOUNDATION_ITEM: LensItem = {
  uid: 'f0000000-0000-0000-0000-000000000001',
  slug: FOUNDATION_SLUG,
  name: 'Test Foundation',
  logoUrl: null,
} as LensItem;

test.setTimeout(120_000);

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

/**
 * The ED dashboard is chosen at the component level from the persona, not by a route guard, so
 * the cookie has to be seeded before the SSR navigation — page.route() only intercepts
 * browser-side XHR and never reaches the Node SSR process.
 */
async function seedEdPersona(page: Page): Promise<void> {
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
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['executive-director'],
        personaProjects: {},
        projects: [],
        organizations: [],
        isRootWriter: false,
        isLFStaff: false,
      }),
    })
  );
  await page.route('**/api/nav/lens-items*', (route) => {
    const requestedLens = new URL(route.request().url()).searchParams.get('lens') ?? 'foundation';
    const items = requestedLens === 'foundation' ? [FOUNDATION_ITEM] : [];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, next_page_token: null, upstream_failed: false, lens: requestedLens }),
    });
  });
  await page.route(`**/api/projects/${FOUNDATION_SLUG}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ uid: FOUNDATION_ITEM.uid, slug: FOUNDATION_SLUG, name: 'Test Foundation', parent_uid: null }),
    })
  );
  await page.route('**/api/projects/*/sfid*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sfid: null }) }));
}

/**
 * A measured, non-zero Events response. Non-zero deliberately: the E3 assertion is that a
 * neighbour still renders its MEASUREMENT, and a zero-filled stub cannot tell a surviving
 * measurement from a suppressed one — the same blind spot that let two drawers ship their
 * stats above the "unavailable" banner in an earlier round of this PR.
 */
const MEASURED_EVENT_GROWTH = {
  totalAttendees: 8421,
  totalRegistrants: 12345,
  totalEvents: 17,
  totalRevenue: 250000,
  revenuePerAttendee: 29.7,
  attendeeYoyChange: 12.5,
  registrantYoyChange: 8.1,
  revenueYoyChange: 15.2,
  trend: 'up',
  monthlyData: [{ month: '2026-01', value: 12345 }],
  topEvents: [],
};

/**
 * Pin the neighbour endpoints this spec asserts against to deterministic 200s.
 *
 * Without this the spec fails ONE endpoint and lets the other ~22 in the dashboard's request
 * burst reach the configured environment. That burst is documented as intermittently 500-ing or
 * leaving requests undispatched, either of which can make a neighbour card report unavailable —
 * so E3 could fail while the code under test behaved correctly. A guard for exactly this failure
 * mode is the last test that can afford to flake.
 *
 * Only endpoints the assertions depend on are stubbed. `failEndpoint` is always registered
 * AFTER this, and Playwright matches the most recently added route first, so the 500 still wins
 * for its own URL even if the two patterns ever overlap.
 */
async function stubNeighborAnalytics(page: Page): Promise<void> {
  await page.route('**/api/analytics/event-growth*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MEASURED_EVENT_GROWTH) })
  );
}

/**
 * Fail exactly one analytics endpoint with a real 500.
 *
 * The 500 matters: the whole chain keys off an HTTP error reaching the client. A stub that
 * returned 200 with a zero-filled body would reproduce the original defect rather than test the
 * fix, which is precisely what made the BFF layer's zero-filled 200s so hard to spot.
 */
async function failEndpoint(page: Page, endpoint: string): Promise<void> {
  await page.route(`**/api/analytics/${endpoint}*`, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'upstream failed' }) })
  );
}

test.describe('ED Marketing Overview — failed reads render as unavailable, not zero', () => {
  test('E1/E2: a 500 on engaged-community renders the unavailable card and drawer', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await seedEdPersona(page);
    await stubNeighborAnalytics(page);
    await failEndpoint(page, 'engaged-community');

    await page.goto(`/foundation/overview?project=${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    // E1 — the card must say the data could not be loaded rather than print a count.
    const card = page.getByTestId('ed-evo-engaged-community');
    await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
    await expect(card).toContainText('Data unavailable', { timeout: LOAD_TIMEOUT });
    // The regression itself: a fabricated zero where a measurement never happened.
    await expect(card).not.toContainText('0 members');

    // E2 — the drawer behind it must agree. Before this fix the card said "unavailable" while
    // the drawer asserted "No community engagement activity detected" — a finding, not an outage.
    await card.click();
    const unavailable = page.getByTestId('engaged-community-drawer-unavailable');
    await expect(unavailable).toBeVisible({ timeout: LOAD_TIMEOUT });
    await expect(unavailable).toContainText('Data unavailable');
    await expect(page.getByTestId('engaged-community-drawer-stats')).toHaveCount(0);
    await expect(page.getByText('No community engagement activity detected')).toHaveCount(0);
  });

  test('E3: cards whose endpoints succeeded still render their measured values', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await seedEdPersona(page);
    await stubNeighborAnalytics(page);
    // Only this one fails — the guard must be scoped to its own response, not blank the section.
    await failEndpoint(page, 'engaged-community');

    await page.goto(`/foundation/overview?project=${FOUNDATION_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await expect(page.getByTestId('ed-evo-engaged-community')).toContainText('Data unavailable', { timeout: LOAD_TIMEOUT });
    // A neighbouring card that resolved normally must not inherit the failure. Asserting the
    // stubbed FIGURE, not just the absence of the banner: a card blanked to an em dash also
    // lacks the phrase "Data unavailable", so the negative assertion alone would pass against
    // a guard that over-suppressed the whole section.
    const events = page.getByTestId('ed-evo-event-growth');
    await expect(events).toBeVisible({ timeout: LOAD_TIMEOUT });
    await expect(events).not.toContainText('Data unavailable');
    await expect(events).toContainText('12.3K');
  });
});
