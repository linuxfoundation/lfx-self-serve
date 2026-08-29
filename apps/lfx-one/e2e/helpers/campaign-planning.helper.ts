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

import { Page, test } from '@playwright/test';

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

  await page.route('**/api/campaigns/hubspot/utm?**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    counts.lookups += 1;
    if (!opts.lookup) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.lookup) });
  });

  await page.route('**/api/campaigns/hubspot/utm/create**', (route) => {
    counts.creates += 1;
    const create = opts.create;
    if (!create) return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    if ('status' in create) {
      return route.fulfill({ status: create.status, contentType: 'application/json', body: JSON.stringify({ message: 'refused' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(create) });
  });
}

/** Open the Campaigns page's Planning tab for a foundation. */
export async function gotoPlanningTab(page: Page, project = 'cncf'): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing();
  await page.goto(`/foundation/campaigns?project=${encodeURIComponent(project)}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing();
}

/**
 * Type the event url and wait for the debounced lookup to have run.
 *
 * The debounce is 500ms; waiting on the STATUS element rather than a fixed sleep is what keeps
 * this from being timing-dependent on a loaded CI machine.
 */
export async function typeEventUrl(page: Page, url = EVENT_URL): Promise<void> {
  // The url field has its OWN testid. `planning-url-section` contains two inputs, so a
  // `.locator('input').first()` would be one refactor away from silently typing into the wrong
  // one and asserting against a lookup that never happened.
  const input = page.getByTestId('planning-url-input');
  await input.fill(url);
  await input.blur();
}
