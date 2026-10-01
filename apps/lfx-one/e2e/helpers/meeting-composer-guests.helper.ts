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
import type { CreatePickerProjectNode, PersistedPersonaState, PersonaType, UserSearchResult } from '@lfx-one/shared/interfaces';
import { expect, Frame, Page, Route, test } from '@playwright/test';

import { stubMeetingsV2Flag } from './meetings-v2-flag.helper';

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
  type: 'v1_meeting_registrant',
  username: 'abyron-e2e',
};

/** Typed into the "Add manually" dialog — deliberately NOT in the directory fixture. */
export const MANUAL_GUEST = {
  first_name: 'Grace',
  last_name: 'Hopper',
  email: 'grace.hopper@acme.example',
};

/** The id the stubbed `POST /api/meetings` hands back, and the one the guest POST must be addressed to. */
export const CREATED_MEETING_ID = 'meeting-composer-e2e-created';

/**
 * What a completed create actually sent, recorded by {@link stubMeetingWrites}.
 * @description Two requests, not one: the composer creates the meeting first and only then knows an id
 * to POST the queued guests against, so the guests never ride along in the create body. `registrants`
 * therefore stays `null` when the second request is never made — which is the failure this records.
 */
export interface RecordedMeetingWrites {
  /** Body of `POST /api/meetings`, or `null` if create was never submitted. */
  meeting: Record<string, unknown> | null;
  /** Body of `POST /api/meetings/<uid>/registrants`, or `null` if the queued guests were never sent. */
  registrants: Record<string, unknown>[] | null;
  /** The meeting uid the registrants POST was addressed to, so a guest sent to the wrong meeting fails loudly. */
  registrantsMeetingUid: string | null;
}

/**
 * Stubs the two writes a create performs and records what each one carried.
 * @description The rest of the backend is stubbed read-only, which is enough to walk the composer but
 * stops exactly where the interesting part starts: whether a guest queued against a meeting that did
 * not exist survives the save. Register this before walking the composer; the patterns below do not
 * overlap the read stubs in {@link stubComposerBackend}, so the order between them does not matter.
 */
export async function stubMeetingWrites(page: Page): Promise<RecordedMeetingWrites> {
  const recorded: RecordedMeetingWrites = { meeting: null, registrants: null, registrantsMeetingUid: null };

  await page.route('**/api/meetings', async (route) => {
    // The same path serves the meetings list on GET; only the create is ours to answer.
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }

    recorded.meeting = route.request().postDataJSON() as Record<string, unknown>;
    return fulfillJson(route, { id: CREATED_MEETING_ID, ...recorded.meeting });
  });

  await page.route('**/api/meetings/*/registrants', async (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }

    const body = route.request().postDataJSON() as Record<string, unknown>[];
    recorded.registrants = body;
    recorded.registrantsMeetingUid = new URL(route.request().url()).pathname.split('/').at(-2) ?? null;

    return fulfillJson(route, {
      successes: body,
      failures: [],
      summary: { total: body.length, successful: body.length, failed: 0 },
    });
  });

  return recorded;
}

/**
 * The one project row the create-target picker returns.
 *
 * The composer is reached through the rail's Create flow now (see {@link openComposerCreate}), and
 * that flow insists on an explicit target — so these specs need one selectable row even though the
 * story they cover is about guests, not projects. Stubbed rather than real so the suite still does
 * not depend on what the test account happens to own. Synthetic name/slug — see
 * development-rules.md.
 */
export const PICKER_PROJECT: CreatePickerProjectNode = {
  kind: 'project',
  uid: 'project-composer-e2e',
  name: 'Acme Motors',
  slug: 'acme-motors-e2e',
  isFoundation: false,
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
 * Write surfaces across the app take a synchronous fast path that admits an ED outright — every
 * other persona makes them probe project write access, which this fixture set has no project for.
 * Without this the rail's create menu and the composer's own write-gated controls resolve to their
 * read-only state and every locator below fails with "element not found" rather than anything that
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
 * SSR hydration re-navigates to the same url more than once, and each of those destroys the
 * component tree — so a test that clicks or fills before the last one loses the interaction with
 * no error anywhere, which reads as a binding bug rather than a timing one. `networkidle` cannot
 * be used to wait this out: the app keeps long-lived connections open and never reaches idle.
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
 * Stubs everything the composer and the page behind it reach for.
 *
 * The composer is an overlay raised over whatever page the rail was on, so that page's own list
 * calls go out too — leaving them live makes the specs depend on whatever meetings the test
 * account happens to own.
 */
export async function stubComposerBackend(page: Page): Promise<void> {
  await seedEdPersona(page);

  // The composer only exists while the flag is on — its host is gated in `app.component.html` and
  // every entry point reads the same flag — so without this the rail's Create flow sends a meeting
  // pick to the pre-v2 wizard and no composer is ever mounted.
  await stubMeetingsV2Flag(page);

  // The create-target picker's three endpoints (tree, lazy children, search). Term-independent and
  // parent-independent on purpose: the picker is a means of reaching the composer here, not the
  // thing under test, so every request answers with the same single selectable project.
  await page.route('**/api/create-picker/**', (route) => fulfillJson(route, { projects: [PICKER_PROJECT], committees: [] }));

  await page.route('**/api/user/meetings*', (route) => fulfillJson(route, []));
  await page.route('**/api/user/past-meetings*', (route) => fulfillJson(route, []));
  await page.route('**/api/user/pending-invitations*', (route) => fulfillJson(route, []));

  // The guest directory, type-faithful: only `v1_meeting_registrant` answers the hit — a wrong type
  // gets zero rows, which is exactly how GH-2773 manifested. Term-independent on purpose.
  await page.route('**/api/search/users*', (route) => {
    const type = new URL(route.request().url()).searchParams.get('type');
    return fulfillJson(route, { results: type === 'v1_meeting_registrant' ? [DIRECTORY_GUEST] : [] });
  });

  // `*` does not cross a `/` in Playwright's glob, so `**/api/committees*` would miss
  // `/api/committees/<uid>/members`. An empty list keeps the group manager in its resolved
  // empty state instead of its loading or failed one.
  await page.route('**/api/committees**', (route) => fulfillJson(route, []));
  await page.route('**/api/projects/*/committees*', (route) => fulfillJson(route, []));

  // Per-card lookups the dashboard fans out; each component already degrades on error.
  await page.route('**/api/meetings/*/attachments*', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/api/past-meetings/**', (route) => route.fulfill({ status: 404, body: '{}' }));
}

/** The rail mounts behind the layout's own bootstrap, so it is the slowest locator in the walk. */
const RAIL_TIMEOUT = 30_000;

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
 *
 * Goes through the rail's Create flow rather than `/meetings/create`: while
 * `MEETING_V2_ENABLED_FLAG` gates v2, that URL is pointed at the pre-v2 wizard unconditionally
 * (see the comment in `meetings.routes.ts` for why a lazy route cannot read the flag), so it can
 * no longer reach the composer at all. The rail is the cheapest entry point that can — it renders
 * unconditionally, needs no project lens, and its target picker is stubbed above, so this still
 * runs without a real project or committee being involved.
 */
export async function openComposerCreate(page: Page): Promise<void> {
  await stubComposerBackend(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing();
  await expect(page).not.toHaveURL(/auth0\.com/);

  // Hydration first, not last: every step below is a click, and a click that lands on
  // server-rendered markup before hydration is a silent no-op. Nothing is left to settle
  // afterwards — the composer is raised in place and no longer redirects once open.
  await waitForHydration(page);

  const createTrigger = page.getByTestId('create-rail-button');
  await expect(createTrigger).toBeVisible({ timeout: RAIL_TIMEOUT });
  await createTrigger.click();
  await expect(page.getByTestId('create-menu')).toBeVisible();

  await page.getByTestId('create-menu-option-meeting').click();
  await expect(page.getByTestId('create-artifact-dialog')).toBeVisible();

  // The picker demands an explicit pick — it deliberately does not auto-select a sole eligible
  // target — so the stubbed project has to be clicked before Continue enables.
  await page.getByTestId(`create-target-node-${PICKER_PROJECT.uid}`).click();
  await page.getByTestId('create-artifact-continue-button').locator('button').click();

  await expect(page.getByTestId('meeting-composer-header')).toBeVisible();
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
