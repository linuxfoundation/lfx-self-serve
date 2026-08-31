// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared fixtures for the Campaigns Planning-tab specs (LFXV2-2641).
 *
 * These drive the HubSpot UTM surface, which is the one place in this feature where the UI's
 * answer decides whether a NON-IDEMPOTENT write happens: the operator creates a campaign when,
 * and only when, the panel says none was found. Every route below therefore exists to put the
 * panel into one specific state and assert what the user is then allowed to do.
 */

import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import type { PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { expect, Frame, Locator, Page, test } from '@playwright/test';

export const DATA_LOAD_TIMEOUT = 30_000;

/** The event URL the specs type, and the name the component derives from it. */
export const EVENT_URL = 'https://events.example.com/kubecon-na-2026';

/**
 * `extractEventName` title-cases each slug word, so the derived name is NOT the display spelling
 * of the event. The lookup is keyed on this value, so a fixture that used "KubeCon NA 2026"
 * would never match what the component asks for.
 */
export const EVENT_NAME = 'Kubecon Na 2026';

/**
 * Gated on the ENV VARS, not on where the browser ended up.
 *
 * URL sniffing cannot tell "no credentials configured" from "login is broken": both land on
 * Auth0, and both would then report a green skip. That matters most for these specs, which
 * exercise a create path — a suite that goes green because authentication regressed is worse
 * than one that fails, since nobody looks at a pass.
 *
 * Matches the newer helpers in this repo (groups-view-toggle, meeting-owner-organizer), which
 * carry the same reasoning; the URL-based form is the older pattern and is deliberately not
 * copied here.
 */
const AUTH_CREDS_PRESENT = !!process.env['TEST_USERNAME'] && !!process.env['TEST_PASSWORD'];

export function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

/** One `text/event-stream` body, in the shape `/api/campaigns/brief/generate` emits. */
/**
 * The PAID planning panel.
 *
 * The Campaigns page renders the planning tab TWICE — `campaigns-planning-panel` for paid and
 * `campaigns-email-planning-panel` for email — so every `planning-*` testid resolves to two
 * elements and an unscoped locator is a strict-mode violation. Scoping here rather than in each
 * spec means a test cannot accidentally assert against the email panel, which has its own
 * HubSpot surface and different rules.
 */
export function paidPanel(page: Page): Locator {
  return page.getByTestId('campaigns-planning-panel');
}

export function sseBody(events: { type: string; data: unknown }[]): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
}

export interface UtmLookupBody {
  found: boolean;
  hs_utm: string | null;
  campaign_name: string;
  all_matches: { name: string; hs_utm: string }[];
  capped: boolean;
  inconclusive: boolean;
}

/** A lookup answer that found nothing and SETTLED the question — the create is legitimate here. */
export function notFound(): UtmLookupBody {
  return { found: false, hs_utm: null, campaign_name: '', all_matches: [], capped: false, inconclusive: false };
}

/** A lookup that found nothing but could NOT settle it — absence is not proof, so no create. */
export function inconclusive(overrides: Partial<UtmLookupBody> = {}): UtmLookupBody {
  return { ...notFound(), capped: true, inconclusive: true, ...overrides };
}

export function found(hsUtm: string, campaignName = 'KubeCon NA 2026'): UtmLookupBody {
  return { found: true, hs_utm: hsUtm, campaign_name: campaignName, all_matches: [], capped: false, inconclusive: false };
}

export interface PlanningMockOptions {
  /** The UTM lookup answer. Omit to leave the route unmocked. */
  lookup?: UtmLookupBody;
  /** The create answer, or an HTTP status to fail it with. */
  create?: { created: boolean; hs_utm: string | null; campaign_name: string } | { status: number };
  /** Counters the caller can assert on — chiefly that a create did NOT happen. */
  counts?: { lookups: number; creates: number };
}

/**
 * Route every API the Planning tab touches on load, so a spec asserts the panel rather than the
 * network. Unmocked routes are left alone deliberately: an unexpected call then shows up as a
 * real failure instead of being silently absorbed by a catch-all.
 */
export async function mockPlanningApis(page: Page, opts: PlanningMockOptions = {}): Promise<void> {
  const counts = opts.counts ?? { lookups: 0, creates: 0 };

  // The saved-brief read-back, which the url field triggers on its own debounce.
  await page.route('**/api/campaigns/brief?**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'not_found' }) })
  );

  await page.route('**/api/campaigns/hubspot/utm/create**', (route) => {
    counts.creates += 1;
    const create = opts.create;
    if (!create) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    if ('status' in create) {
      return route.fulfill({ status: create.status, contentType: 'application/json', body: JSON.stringify({ message: 'refused' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(create) });
  });

  // The CREATE route is registered FIRST, and the lookup guards on the path, because
  // `**/api/campaigns/hubspot/utm?**` also matches `/utm/create?...` — Playwright runs the most
  // recently registered handler first, so an overlapping lookup pattern silently swallowed every
  // create and the panel never advanced.
  await page.route('**/api/campaigns/hubspot/utm?**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/create')) return route.fallback();
    if (route.request().method() !== 'GET') return route.fallback();
    counts.lookups += 1;
    if (!opts.lookup) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.lookup) });
  });
}

/**
 * Present the signed-in user as an executive director.
 *
 * `campaignAccessGuard` admits an ED outright and otherwise redirects to /foundation/overview —
 * a SILENT redirect, so without this the specs land on the Me lens and every locator fails with
 * "element not found" rather than anything that names the real cause.
 *
 * Both halves are needed: the COOKIE is what SSR reads while rendering, and the route mock is
 * what the browser-side XHR reads afterwards. Seeding only one leaves the two disagreeing.
 * Mirrors seedEdPersona in ed-dashboard-unavailable.spec.ts.
 */
export async function seedEdPersona(page: Page): Promise<void> {
  const state: PersistedPersonaState = {
    primary: 'executive-director' as PersonaType,
    all: ['executive-director'] as PersonaType[],
  };
  await page.context().addCookies([
    {
      name: PERSONA_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify(state)),
      // Must match the host baseURL actually uses, and the DEFAULT has to match too: a cookie
      // scoped to one host is simply not sent to the other, and the persona guard then redirects
      // away from the tab. This defaulted to 127.0.0.1 while playwright.config.ts defaults
      // E2E_HOST to localhost, so a run with no overrides set the cookie on a host the browser
      // never visited. Same default, same source of truth.
      domain: new URL(process.env['E2E_BASE_URL'] ?? `http://${process.env['E2E_HOST'] ?? 'localhost'}:${process.env['E2E_PORT'] ?? '4200'}`).hostname,
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
}

/** Open the Campaigns page's Planning tab for a foundation. */
/**
 * Open the Campaigns page's Planning tab for a foundation.
 *
 * Defaults to `tlf`, matching the other authenticated specs in this suite: the route is behind
 * campaignAccessGuard, which redirects to /foundation/overview unless the signed-in user is an
 * ED or campaign_manager on that project — so a slug the test account cannot access fails as a
 * silent redirect rather than an obvious error.
 */
/**
 * Resolves once the page has stopped re-navigating to itself.
 *
 * SSR hydration re-navigates to the same url more than once, and every one of those destroys the
 * component tree. A test that types before the last one loses the value with no error anywhere,
 * which reads as a form-binding bug rather than a timing one. networkidle cannot be used to wait
 * this out because the app keeps long-lived connections open and never reaches idle.
 */
async function waitForHydration(page: Page, quietMs = 1200, timeoutMs = 20000): Promise<void> {
  let last = Date.now();
  const onNav = (f: Frame): void => {
    if (f === page.mainFrame()) {
      last = Date.now();
    }
  };
  page.on('framenavigated', onNav);
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (Date.now() - last >= quietMs) {
        return;
      }
      await page.waitForTimeout(150);
    }
  } finally {
    page.off('framenavigated', onNav);
  }
}

export async function gotoPlanningTab(page: Page, project = 'aswf'): Promise<void> {
  await seedEdPersona(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing();
  await page.goto(`/foundation/campaigns?project=${encodeURIComponent(project)}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing();

  // Wait for hydration to settle before touching anything. The SSR page renders, then navigates
  // to its own url twice more as it hydrates, and each of those tears down the component tree —
  // anything typed before the last one is silently gone about half a second later. That looked
  // for a long time like a typing or form-binding bug; it is neither, the field is simply on a
  // component that got destroyed.
  //
  // Not networkidle: this app holds long-lived connections open, so the network never goes idle
  // and the wait just burns the whole timeout. Waiting for the re-navigations to STOP is the
  // actual signal — the url is stable, so count main-frame navigations and wait for a quiet gap.
  await waitForHydration(page);

  // The tab is 'Plan' and it IS the default selected tab, but the click is kept: it is what
  // guarantees the panel is mounted regardless of which tab a future default lands on, and
  // clicking an already-selected tab is a no-op.
  const planningTab = page.locator('#tab-planning');
  await planningTab.waitFor({ state: 'visible', timeout: DATA_LOAD_TIMEOUT });
  await planningTab.click();
  await paidPanel(page).getByTestId('planning-url-input').waitFor({ state: 'visible', timeout: DATA_LOAD_TIMEOUT });
}

/**
 * Type the event url and wait for the debounced lookup to have run.
 *
 * The debounce is 500ms; waiting on the STATUS element rather than a fixed sleep is what keeps
 * this from being timing-dependent on a loaded CI machine.
 */
export async function typeEventUrl(page: Page, url: string = EVENT_URL): Promise<void> {
  const input = paidPanel(page).getByTestId('planning-url-input');
  await input.waitFor({ state: 'visible' });

  // fill() goes through the ControlValueAccessor, which is the part that matters here. Writing
  // .value directly does update the DOM, but Angular's form model still holds '' and the next
  // change-detection pass writes that empty model straight back over the field — the value is
  // gone about a second later, with no error anywhere. Assert it survived rather than trusting
  // the write, because that reset is silent and made this look like a typing/encoding problem.
  await input.fill(url);
  await expect(input).toHaveValue(url);

  await paidPanel(page)
    .getByTestId('planning-hubspot-status')
    .waitFor({ state: 'visible', timeout: DATA_LOAD_TIMEOUT })
    .catch(() => {});
}
