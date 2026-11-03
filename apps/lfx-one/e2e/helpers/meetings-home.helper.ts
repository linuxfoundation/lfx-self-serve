// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Navigation and BFF stubs for the Me lens meetings home page specs (#4883), flag on, synthetic feeds only. */

import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import type { CreateMeetingRsvpRequest, MeetingRsvp, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { expect, Locator, Page, Route, test } from '@playwright/test';

import { buildMeetingsHomePast, buildMeetingsHomeUpcoming, MEETINGS_HOME_NOW, MEETINGS_HOME_PROJECT, meetingsHomeRsvp } from '../fixtures/mock-data';
import { suppressCookieBanner } from './account-settings-email.helper';
import { stubMeetingsRedesignFlag } from './meetings-v2-flag.helper';

export const MEETINGS_HOME_LOAD_TIMEOUT = 30_000;

/** Desktop layout (right column beside the list) in a fixed zone, so day buckets and countdowns never drift. */
export const MEETINGS_HOME_TEST_OPTIONS = { timezoneId: 'UTC', locale: 'en-US', viewport: { width: 1440, height: 900 } };

export interface MeetingsHomeStubOptions {
  /** Serve an empty upcoming feed. */
  emptyUpcoming?: boolean;
  /** Meeting write access in the synthetic project context; gates Create Meeting. */
  canWrite?: boolean;
  /** Query string appended to `/meetings`, e.g. `?time=past`. */
  query?: string;
}

export interface MeetingsHomeMocks {
  /** RSVP writes the page sent, in order. */
  rsvpPosts: CreateMeetingRsvpRequest[];
}

function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Me lens, contributor persona and a synthetic project context, so the Create gate never depends on the test account. */
async function seedCookies(page: Page): Promise<void> {
  const url = new URL(test.info().project.use.baseURL ?? 'http://localhost:4200').origin;
  const persona: PersistedPersonaState = { primary: 'contributor' as PersonaType, all: ['contributor'] as PersonaType[] };
  await page.context().addCookies([
    { name: LENS_COOKIE_KEY, value: 'me', url, sameSite: 'Lax' },
    { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(persona)), url, sameSite: 'Lax' },
    { name: SELECTED_PROJECT_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(MEETINGS_HOME_PROJECT)), url, sameSite: 'Lax' },
  ]);
}

/** Feeds, RSVP writes and per-meeting lookups; no synthetic id reaches the deployed meeting services. */
async function stubMeetingsHome(page: Page, options: MeetingsHomeStubOptions): Promise<MeetingsHomeMocks> {
  const mocks: MeetingsHomeMocks = { rsvpPosts: [] };
  const answers = new Map<string, MeetingRsvp>();
  const past = buildMeetingsHomePast();

  // Registered first so the specific routes below take precedence (Playwright matches the newest route first).
  await page.route(/\/api\/(past-)?meetings\/home-e2e-[^/?]+([/?]|$)/, (route) => fulfillJson(route, {}, 404));

  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['contributor'], personaProjects: {}, projects: [], organizations: [], isRootWriter: false })
  );
  await page.route(`**/api/projects/${MEETINGS_HOME_PROJECT.slug}*`, (route) =>
    fulfillJson(route, { ...MEETINGS_HOME_PROJECT, parent_uid: '', writer: options.canWrite === true, meetingCoordinator: false })
  );
  await page.route('**/api/user/meetings*', (route) => fulfillJson(route, options.emptyUpcoming ? [] : buildMeetingsHomeUpcoming(answers)));
  await page.route('**/api/user/past-meetings*', (route) => fulfillJson(route, past));
  await page.route('**/api/user/latest-past-meetings*', (route) => fulfillJson(route, past.slice(0, 1)));
  await page.route('**/api/meetings/home-e2e-*/rsvp', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const request = route.request().postDataJSON() as CreateMeetingRsvpRequest;
    const meetingId = new URL(route.request().url()).pathname.split('/')[3];
    mocks.rsvpPosts.push(request);
    const rsvp = meetingsHomeRsvp(meetingId, request.response, request.scope);
    answers.set(meetingId, rsvp);
    return fulfillJson(route, rsvp);
  });

  return mocks;
}

/** Skips when global setup ran without credentials and the app bounced to Auth0. */
function skipWhenAuthMissing(page: Page): void {
  const { hostname } = new URL(page.url());
  if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

/** Opens the redesigned meetings page at a fixed clock with synthetic feeds. */
export async function gotoMeetingsHome(page: Page, options: MeetingsHomeStubOptions = {}): Promise<MeetingsHomeMocks> {
  await suppressCookieBanner(page);
  await stubMeetingsRedesignFlag(page, true);
  await page.clock.setFixedTime(MEETINGS_HOME_NOW);
  await seedCookies(page);
  const mocks = await stubMeetingsHome(page, options);

  await page.goto(`/meetings${options.query ?? ''}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page.getByTestId('meetings-redesign')).toBeVisible({ timeout: MEETINGS_HOME_LOAD_TIMEOUT });
  return mocks;
}

/** List rows (the Next card's meeting is not one of them). */
export function homeRows(page: Page): Locator {
  return page.getByTestId('meetings-home-row');
}

/** List rows whose title is `title`; a recurring series has one per date. */
export function homeRow(page: Page, title: string): Locator {
  return homeRows(page).filter({ has: page.getByTestId('meetings-home-row-title').getByText(title, { exact: true }) });
}

/** The desktop right column; the folded copy of its cards stays in the DOM, hidden. */
export function rightColumn(page: Page): Locator {
  return page.getByTestId('meetings-redesign-right-column');
}

export function homeToast(page: Page, message: string): Locator {
  return page.getByTestId('ui-toast').filter({ hasText: message });
}
