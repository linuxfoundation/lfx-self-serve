// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared setup for the create-mode guest-invite specs (#1452).
 *
 * Companion specs: `meeting-composer-guests-create.spec.ts` (content) and
 * `meeting-composer-guests-create-robust.spec.ts` (structural).
 *
 * The point of the story these cover is that guests are editable BEFORE the meeting exists — the
 * old wizard gated the registrant surface behind "create the meeting first". Everything below
 * exists to get a signed-in organizer as far as the composer's Guests section in create mode
 * without a meeting, a project, or a committee ever being involved.
 */

import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import type { PersistedPersonaState, PersonaType, UserSearchResult } from '@lfx-one/shared/interfaces';
import { expect, Frame, Page, Route, test } from '@playwright/test';

/** Far enough out that `futureDateTime` can never fail, in the `mm/dd/yy` format `lfx-calendar` types in. */
export const FUTURE_DATE = '12/31/2099';

/** Already canonical, so `convertTimeFormat` is a no-op on blur and the typed value is what lands in the control. */
export const START_TIME = '10:00 AM';

export const MEETING_TITLE = 'Composer guest invite E2E';

/** The one directory hit `/api/search/users` returns. Synthetic domain — see development-rules.md. */
export const DIRECTORY_GUEST: UserSearchResult = {
  uid: 'guest-directory-e2e',
  email: 'ada.byron@acme.example',
  first_name: 'Ada',
  last_name: 'Byron',
  job_title: 'Principal Engineer',
  organization: { name: 'Acme Motors', website: null },
  type: 'meeting_registrant',
  username: 'abyron-e2e',
};

/** Typed into the "Add manually" dialog — deliberately NOT in the directory fixture. */
export const MANUAL_GUEST = {
  first_name: 'Grace',
  last_name: 'Hopper',
  email: 'grace.hopper@acme.example',
};

/**
 * Gated on the ENV VARS, not on where the browser ended up.
 *
 * URL sniffing cannot tell "no credentials configured" from "login is broken": both land on
 * Auth0, and both would then report a green skip. Matches the newer helpers in this repo
 * (campaign-planning, groups-view-toggle); the URL-based form is the older pattern.
 */
const AUTH_CREDS_PRESENT = !!process.env['TEST_USERNAME'] && !!process.env['TEST_PASSWORD'];

export function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * Seeds the Executive Director persona.
 *
 * `/meetings/create` is behind `writerGuard` with `writeFeature: 'meetings'`, and the guard has a
 * synchronous fast path that admits an ED outright — every other persona makes it probe project
 * write access, which this fixture set has no project for. Without this the route redirects
 * SILENTLY and every composer locator fails with "element not found" rather than anything that
 * names the real cause.
 *
 * Both halves are needed: the COOKIE is what SSR reads while rendering, and the route mock is
 * what the browser-side XHR reads afterwards. Seeding only one leaves the two disagreeing.
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
      // Derived from the same precedence playwright.config.ts uses, never hardcoded: a cookie
      // scoped to one host is simply not sent to the other, so a hardcoded 127.0.0.1 against a
      // localhost baseURL lands the persona on a host the browser never visits and the guard then
      // redirects away. Same source of truth, same default.
      domain: new URL(process.env['E2E_BASE_URL'] ?? `http://${process.env['E2E_HOST'] ?? 'localhost'}:${process.env['E2E_PORT'] ?? '4200'}`).hostname,
      path: '/',
      sameSite: 'Lax',
    },
  ]);

  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, {
      personas: ['executive-director'],
      personaProjects: {},
      projects: [],
      organizations: [],
      isRootWriter: false,
      isLFStaff: false,
    })
  );
}

/**
 * Resolves once the page has stopped re-navigating to itself.
 *
 * SSR hydration re-navigates to the same url more than once, and `MeetingComposerRouteComponent`
 * adds one more of its own — it opens the composer and then `replaceUrl`s back to the list route.
 * Every one of those destroys the component tree, so a test that fills the title before the last
 * one loses the value with no error anywhere, which reads as a form-binding bug rather than a
 * timing one. `networkidle` cannot be used to wait this out: the app keeps long-lived connections
 * open and never reaches idle.
 */
export async function waitForHydration(page: Page, quietMs = 1200, timeoutMs = 20_000): Promise<void> {
  let last = Date.now();
  const onNav = (frame: Frame): void => {
    if (frame === page.mainFrame()) {
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
    // THROW at the deadline rather than returning. Falling out of the loop would resolve as
    // though hydration had settled, so the test would go on to interact with the very
    // teardown-prone component this exists to protect — and fail later, somewhere else, for a
    // reason that looked unrelated. A helper that cannot establish its postcondition must say so.
    throw new Error(
      `waitForHydration: main-frame navigation never went quiet for ${quietMs}ms within ${timeoutMs}ms. ` +
        'The page is still re-navigating, so composer state cannot survive the next interaction.'
    );
  } finally {
    page.off('framenavigated', onNav);
  }
}

/**
 * Stubs everything the composer and the dashboard behind it reach for.
 *
 * `/meetings/create` replaces its own url with `/meetings`, so the meetings dashboard renders
 * underneath the open drawer and its list calls go out too — leaving them live makes the specs
 * depend on whatever meetings the test account happens to own.
 */
export async function stubComposerBackend(page: Page): Promise<void> {
  await seedEdPersona(page);

  await page.route('**/api/user/meetings*', (route) => fulfillJson(route, []));
  await page.route('**/api/user/past-meetings*', (route) => fulfillJson(route, []));
  await page.route('**/api/user/pending-invitations*', (route) => fulfillJson(route, []));

  // The guest directory. Term-independent on purpose: the specs assert what happens to a hit, not
  // how the backend ranks one.
  await page.route('**/api/search/users*', (route) => fulfillJson(route, { results: [DIRECTORY_GUEST] }));

  // `*` does not cross a `/` in Playwright's glob, so `**/api/committees*` would miss
  // `/api/committees/<uid>/members`. An empty list keeps the group manager in its resolved
  // empty state instead of its loading or failed one.
  await page.route('**/api/committees**', (route) => fulfillJson(route, []));
  await page.route('**/api/projects/*/committees*', (route) => fulfillJson(route, []));

  // Per-card lookups the dashboard fans out; each component already degrades on error.
  await page.route('**/api/meetings/*/attachments*', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/api/past-meetings/**', (route) => route.fulfill({ status: 404, body: '{}' }));
}

const nextButton = (page: Page) => page.locator('[data-testid="meeting-composer-next"] button');

/** Fills Details & Access, the section create mode opens on. */
async function fillDetailsAccess(page: Page): Promise<void> {
  await page.locator('#composer-meeting-title').fill(MEETING_TITLE);

  // p-select's inputId lands on a span[role=combobox], and the option's accessible name is the
  // label followed by its description — hence the anchored pattern rather than an exact match.
  await page.locator('#composer-meeting-type').click();
  await page.getByRole('option', { name: /^Board/ }).click();
}

/**
 * Fills Date & Schedule.
 *
 * Only three controls are empty in create mode — duration, platform and early-join all arrive
 * defaulted — but `timezone` starts as `''` and is required, so it has to be picked even though
 * the UI reads as though it has a value.
 */
async function fillDateSchedule(page: Page): Promise<void> {
  await page.locator('#composer-start-date').fill(FUTURE_DATE);
  await page.keyboard.press('Escape');

  // `fill` writes through Angular's value accessor, and START_TIME is already canonical, so the
  // blur-time conversion is a no-op — no popover pick needed. Its options are `<a>` elements with
  // no href anyway, so they are not addressable by role `link`.
  await page.locator('#composer-start-time').fill(START_TIME);
  await page.keyboard.press('Escape');

  await page.locator('#composer-timezone').click();
  await page.getByRole('option', { name: /^UTC/ }).click();
}

/**
 * Opens create mode and stops at the section it lands on, with hydration settled.
 *
 * Separated from {@link openGuestsSection} so a spec can assert the rail's cold state — Guests
 * unreachable behind an empty Details & access — which walking to Guests necessarily destroys.
 */
export async function openComposerCreate(page: Page): Promise<void> {
  await stubComposerBackend(page);

  await page.goto('/meetings/create', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing();
  await expect(page).not.toHaveURL(/auth0\.com/);

  await expect(page.getByTestId('meeting-composer-header')).toBeVisible();
  await waitForHydration(page);

  await expect(page.getByTestId('composer-details-access')).toBeVisible();
}

/**
 * Walks create mode from a cold start to the Guests section.
 *
 * Deliberately three footer Next clicks rather than one rail jump: the rail's `reachable` gate is
 * `index <= sectionAdvanceLimit() && (visited || index <= frontier)`, and `frontier` is only ever
 * one past the furthest section visited. Guests sits at index 3, so it stays unreachable until
 * Platform & features has been visited — clicking its rail row before that is a no-op.
 */
export async function openGuestsSection(page: Page): Promise<void> {
  await openComposerCreate(page);
  await fillDetailsAccess(page);
  await nextButton(page).click();

  await expect(page.getByTestId('composer-date-schedule')).toBeVisible();
  await fillDateSchedule(page);
  await nextButton(page).click();

  // Platform & features needs nothing filled — its controls arrive defaulted — it just has to be
  // visited so the rail frontier reaches Guests.
  await expect(page.getByTestId('composer-platform-features')).toBeVisible();
  await nextButton(page).click();

  await expect(page.getByTestId('composer-guests')).toBeVisible();
}
