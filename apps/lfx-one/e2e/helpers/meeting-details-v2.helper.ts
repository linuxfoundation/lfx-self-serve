// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Presets and stubs for the meeting details V2 E2E specs (#3262).
 *
 * Every BFF call the V2 page makes is answered by one predicate-based router, so a preset is just a
 * meeting payload plus the artifacts it needs. The page is reached by SPA navigation after the app
 * boots: a full `page.goto('/meetings/<id>')` SSRs the route, and server-side fetches bypass
 * `page.route` (see `meetings-v2-flag-gate.spec.ts`). The signed-in viewer is the test account; its
 * role on the meeting comes from the stubbed `organizer` / `invited` flags, as the BFF would set them.
 *
 * The presets are documented in `specs/011-meeting-details-redesign/e2e-presets.md`.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, Page, Route } from '@playwright/test';

import { stubMeetingDetailsV2Flag } from './meetings-v2-flag.helper';

export const PAGE_LOAD_TIMEOUT = 20_000;
export const ELEMENT_TIMEOUT = 10_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const UPCOMING_ID = 'm0000000-0000-0000-0000-00000000e2e1';
/** A composite past-meeting id: numeric meeting id, a hyphen, 13-digit start ms (`isPastMeetingCompositeId`). */
export const PAST_ID = '98765432101-1760000000000';
export const MEETING_TITLE = 'Acme Weekly Sync';

const PROJECT = { uid: 'p0000000-0000-0000-0000-00000000e2e1', name: 'Acme Project', slug: 'acme-project', logo_url: '', parent_uid: '', parent: null };

export type MeetingTime = 'before' | 'live' | 'ended';

/** A meeting payload as `/public/api/meetings/:id` returns it, at the given point in time. */
export function buildMeeting(time: MeetingTime, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const offset: Record<MeetingTime, number> = { before: 2 * HOUR, live: -5 * MINUTE, ended: -3 * DAY };
  return {
    id: UPCOMING_ID,
    uid: UPCOMING_ID,
    title: MEETING_TITLE,
    description: '',
    agenda: '',
    timezone: 'UTC',
    start_time: new Date(Date.now() + offset[time]).toISOString(),
    duration: 60,
    early_join_time_minutes: 10,
    visibility: 'public',
    restricted: false,
    organizer: false,
    invited: false,
    is_invite_responses_enabled: false,
    recurrence: null,
    occurrences: [],
    password: null,
    // Off, so a registrant's roster is not requested (presets 3 and 4 assert the action slot).
    show_meeting_attendees: false,
    committees: [],
    meeting_type: null,
    project_uid: PROJECT.uid,
    organizers: [],
    ...overrides,
  };
}

/** A past-meeting payload, opened by its composite id. */
export function buildPastMeeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return buildMeeting('ended', { id: PAST_ID, uid: PAST_ID, meeting_id: '98765432101', meeting_and_occurrence_id: PAST_ID, ...overrides });
}

export interface MeetingStubs {
  /** The upcoming lookup, `/public/api/meetings/:id`. */
  meeting?: Record<string, unknown>;
  /** The past lookup, `/public/api/meetings/past/:id`. */
  past?: { meeting: Record<string, unknown>; fullAccess: boolean };
  /** A status for the upcoming lookup instead of a meeting (the error path). */
  lookupStatus?: number;
  /**
   * The meeting's password. When set, the upcoming lookup and the join URL answer 400 unless the
   * request carries it in `x-meeting-password`, as the BFF does for a non-open meeting a visitor or
   * outsider opens (`state-matrix.md` § Reachability). Open such a meeting with the same password.
   */
  password?: string;
  /** Collects every join-URL request the page makes: its body and the password header it carried. */
  joinUrlCalls?: { body: Record<string, unknown> | null; password: string | undefined }[];
}

export interface OpenMeetingOptions {
  /** The invite link's `?password=`. */
  password?: string;
  /** The page is expected to route away (a reachability case): do not wait for the V2 tree. */
  expectRedirect?: boolean;
}

/** The invite-link password the restricted presets use. */
export const INVITE_PASSWORD = 'e2e-invite';

function json(route: Route, body: unknown, status = 200): Promise<void> {
  // A request the page already aborted (V1's lookup, destroyed by the gate's latch) rejects here.
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => undefined);
}

/**
 * Answers every meeting-details call. Registered after the app has booted, so the shell's own
 * requests reach the BFF as usual and only the page under test is stubbed; paths are matched
 * exactly, because a `**\/api/meetings/**` glob also matches `/public/api/meetings/...`. An unexpected
 * call answers 404 and is logged, so a gap in the stubs shows in the trace.
 */
export async function stubMeetingDetails(page: Page, stubs: MeetingStubs): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/public/api/meetings/') || url.pathname.startsWith('/api/meetings/') || url.pathname.startsWith('/api/past-meetings/'),
    async (route) => {
      const { pathname } = new URL(route.request().url());
      const method = route.request().method();
      const password = route.request().headers()['x-meeting-password'];
      const passwordRejected = !!stubs.password && password !== stubs.password;

      if (pathname === `/public/api/meetings/past/${PAST_ID}`) {
        return stubs.past ? json(route, { meeting: stubs.past.meeting, project: PROJECT, full_access: stubs.past.fullAccess }) : json(route, {}, 404);
      }
      if (pathname === `/public/api/meetings/${UPCOMING_ID}` && method === 'GET') {
        if (stubs.lookupStatus) {
          return json(route, { message: 'upstream failure' }, stubs.lookupStatus);
        }
        if (passwordRejected) {
          return json(route, { message: 'Invalid password' }, 400);
        }
        return stubs.meeting ? json(route, { meeting: stubs.meeting, project: PROJECT }) : json(route, {}, 404);
      }
      if (pathname.endsWith('/join-url')) {
        stubs.joinUrlCalls?.push({ body: (route.request().postDataJSON() as Record<string, unknown> | null) ?? null, password });
        return passwordRejected ? json(route, { message: 'Invalid password' }, 400) : json(route, { link: 'https://zoom.example/j/123' });
      }
      if (pathname.endsWith('/rsvp/me')) {
        return json(route, null);
      }
      if (pathname === `/api/meetings/${UPCOMING_ID}/rsvp` && method === 'POST') {
        const { response } = route.request().postDataJSON() as { response: string };
        return json(route, { id: 'rsvp-e2e', meeting_id: UPCOMING_ID, response_type: response });
      }
      if (pathname.endsWith('/attachments')) {
        return json(route, []);
      }
      // Signed in reads /api/past-meetings/:compositeId/*; anonymous (stage 5) reads the public routes.
      if (pathname === `/api/past-meetings/${PAST_ID}/recording` || pathname === `/public/api/meetings/past/${PAST_ID}/recording`) {
        return json(route, { sessions: [{ share_url: 'https://zoom.example/rec/share/x', total_size: 1 }], recording_files: [] });
      }
      if (pathname === `/api/past-meetings/${PAST_ID}/transcript` || pathname === `/public/api/meetings/past/${PAST_ID}/transcript`) {
        return json(route, { recording_files: [{ file_type: 'TRANSCRIPT', download_url: 'https://zoom.example/t.vtt' }] });
      }
      if (pathname === `/api/past-meetings/${PAST_ID}/transcript/content` || pathname === `/public/api/meetings/past/${PAST_ID}/transcript/content`) {
        return json(route, { content: 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nAda Lovelace: Welcome to the roadmap review.\n' });
      }
      if (pathname === `/api/past-meetings/${PAST_ID}/summary` || pathname === `/public/api/meetings/past/${PAST_ID}/summary`) {
        return json(route, { summary_data: { title: 'AI Summary', content: '## Notes\n\n- Agreed the roadmap' }, requires_approval: false, approved: true });
      }
      if (pathname === `/public/api/meetings/past/${PAST_ID}/participants`) {
        return json(route, {
          participants: [{ uid: 'p1', first_name: 'Ada', last_name: 'Lovelace', is_attended: true, is_invited: true }],
          unidentified_attendees: 0,
          attendance: { participant_count: 2, attended_count: 1, individual_registrants_count: 2 },
        });
      }
      console.warn(`[meeting-details-v2] unstubbed ${method} ${pathname}`);
      return json(route, { message: 'not stubbed' }, 404);
    }
  );
}

/**
 * Boots the app signed in with the V2 flag on and the stubs in place, then SPA-navigates to the
 * meeting. `zoom_redirect=false` keeps the join slot from auto-opening Zoom in a popup.
 */
export async function openMeetingSignedIn(page: Page, meetingId: string, stubs: MeetingStubs, options: OpenMeetingOptions = {}): Promise<void> {
  await stubMeetingDetailsV2Flag(page, true);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  // The shell's main column, not the sidebar: the sidebar is `hidden lg:flex`, so under mobile-chrome
  // (Pixel 5) it never shows, and these suites run at each project's own viewport.
  await expect(page.getByTestId('main-content')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await stubMeetingDetails(page, stubs);

  await page.evaluate(
    (url) => {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    meetingUrl(meetingId, { zoom_redirect: 'false', password: options.password })
  );

  if (!options.expectRedirect) {
    await expect(page.getByTestId('meeting-details-gate-v2')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
  }
}

/** The page has loaded its meeting: the header's h1 shows the title. */
export async function waitForMeeting(page: Page): Promise<void> {
  await expect(page.getByTestId('meeting-header-section').getByRole('heading', { level: 1 })).toHaveText(MEETING_TITLE, { timeout: PAGE_LOAD_TIMEOUT });
}

/**
 * Axe on the V2 page (WCAG 2.0, 2.1 and 2.2, A and AA), scoped to the page's own tree so the app shell
 * the test boots through is not under test. Returns the violations, summarised for a readable failure.
 */
export async function axeViolations(page: Page): Promise<{ id: string; impact: string | null | undefined; nodes: number }[]> {
  const results = await new AxeBuilder({ page })
    .include('[data-testid="meeting-details-gate-v2"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length }));
}

/** Skips a spec that needs the signed-in test account, from inside a hook (never at load time). */
export function skipWithoutCredentials(skip: (condition: boolean, reason: string) => void): void {
  skip(!process.env['TEST_USERNAME'] || !process.env['TEST_PASSWORD'], 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
}

/** Boots an anonymous browser on a public page (`/` would redirect to Auth0) and SPA-navigates to the meeting. */
export async function openMeetingAnonymously(page: Page, meetingId: string, stubs: MeetingStubs, options: OpenMeetingOptions = {}): Promise<void> {
  await stubMeetingDetailsV2Flag(page, true);

  await page.goto('/meetings/not-found', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('meeting-not-found-card')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await stubMeetingDetails(page, stubs);

  await page.evaluate(
    (url) => {
      window.history.pushState({}, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    meetingUrl(meetingId, { password: options.password })
  );
}

/** `/meetings/:id` with the given query params; an invite link carries `?password=`. */
function meetingUrl(meetingId: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => !!entry[1])).toString();
  return `/meetings/${meetingId}${query ? `?${query}` : ''}`;
}
