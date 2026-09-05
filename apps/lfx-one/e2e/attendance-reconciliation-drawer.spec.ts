// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Attendance reconciliation drawer — GH-1672 item 5.
 *
 * Coverage:
 *   - Opening the drawer from the past-meeting details page runs the reconcile call and renders
 *     the "Needs Review" tab's empty state when no results land in it.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import { LENS_COOKIE_KEY, PERSONA_COOKIE_KEY, SELECTED_PROJECT_COOKIE_KEY } from '@lfx-one/shared/constants';
import type { PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

test.setTimeout(120_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const PROJECT_UID = 'p0000000-0000-0000-0000-00000000e002';
const PROJECT_SLUG = 'reconcile-e2e-project';
const PROJECT_NAME = 'Reconcile E2E Project';
const MOCK_MEETING_UID = 'm0000000-0000-0000-0000-00000000e002';

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

async function setPersonaAndProjectCookies(page: Page): Promise<void> {
  const state: PersistedPersonaState = { primary: 'executive-director' as PersonaType, all: ['executive-director'] as PersonaType[] };
  await page.context().addCookies([
    { name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(state)), domain: 'localhost', path: '/', sameSite: 'Lax' },
    { name: LENS_COOKIE_KEY, value: 'project', domain: 'localhost', path: '/', sameSite: 'Lax' },
    {
      name: SELECTED_PROJECT_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify({ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME })),
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ]);
}

async function stubDetailsPageContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
  await page.route(`**/api/projects/${PROJECT_SLUG}*`, (route) =>
    fulfillJson(route, { uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, writer: true })
  );
  await page.route('**/api/nav/lens-items*', (route) =>
    fulfillJson(route, {
      items: [{ uid: PROJECT_UID, slug: PROJECT_SLUG, name: PROJECT_NAME, logoUrl: null, isFoundation: false }],
      next_page_token: null,
      upstream_failed: false,
      lens: 'project',
    })
  );
  await page.route('**/api/committees/my-committee-uids*', (route) => fulfillJson(route, []));
  await page.route('**/api/committees*', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/api/committees') return route.fallback();
    return fulfillJson(route, []);
  });

  function buildPastMeeting(): Record<string, unknown> {
    return {
      id: MOCK_MEETING_UID,
      meeting_id: MOCK_MEETING_UID,
      occurrence_id: 'occ-1',
      title: 'Reconcile E2E Meeting',
      description: 'Meeting stub for attendance-reconciliation-drawer specs',
      project_uid: PROJECT_UID,
      project_slug: PROJECT_SLUG,
      project_name: PROJECT_NAME,
      is_foundation: false,
      meeting_type: 'Board',
      visibility: 'public',
      restricted: false,
      start_time: '2026-01-01T15:00:00Z',
      scheduled_start_time: '2026-01-01T15:00:00Z',
      scheduled_end_time: '2026-01-01T16:00:00Z',
      duration: 60,
      timezone: 'UTC',
      committees: [],
      occurrences: [],
      recurrence: null,
      sessions: [],
      registrant_count: 0,
      writer: true,
      organizer: true,
    };
  }

  function buildParticipant(): Record<string, unknown> {
    return {
      uid: 'participant-1',
      meeting_id: MOCK_MEETING_UID,
      meeting_and_occurrence_id: MOCK_MEETING_UID,
      past_meeting_id: MOCK_MEETING_UID,
      email: 'attendee-e2e@example.com',
      first_name: 'Attendee',
      last_name: 'E2E',
      host: false,
      is_attended: true,
      is_invited: true,
      org_is_member: false,
      org_is_project_member: false,
      created_at: '2026-01-01T15:00:00Z',
      updated_at: '2026-01-01T15:00:00Z',
    };
  }

  await page.route(
    (url) => url.pathname === `/api/past-meetings/${MOCK_MEETING_UID}`,
    (route) => fulfillJson(route, buildPastMeeting())
  );
  await page.route(`**/api/past-meetings/${MOCK_MEETING_UID}/participants*`, (route) => fulfillJson(route, [buildParticipant()]));
  await page.route(`**/api/past-meetings/${MOCK_MEETING_UID}/attachments*`, (route) => fulfillJson(route, []));
  await page.route(`**/api/past-meetings/${MOCK_MEETING_UID}/recording*`, (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route(`**/api/past-meetings/${MOCK_MEETING_UID}/transcript*`, (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route(`**/api/past-meetings/${MOCK_MEETING_UID}/summary*`, (route) => route.fulfill({ status: 404, body: '{}' }));

  // Empty reconcile response — no results land in any of the three tabs.
  await page.route(`**/api/past-meetings/${MOCK_MEETING_UID}/reconcile`, (route) => fulfillJson(route, { results: [], pool_degraded: false }));
}

/**
 * Client-side (SPA) navigation to the past-meeting details page. A full `page.goto()` SSRs the
 * route on the Express server, so server-side fetches bypass `page.route` stubs and hit the real
 * BFF, where the stubbed meeting does not exist. Booting on `/` first and navigating via
 * pushState + popstate keeps every fetch stubbed (same pattern as meeting-owner-organizer.spec.ts).
 */
async function gotoPastMeetingDetails(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await setPersonaAndProjectCookies(page);
  await page.evaluate((url) => {
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/meetings/${MOCK_MEETING_UID}/details`);
}

test.describe('Attendance reconciliation drawer (GH-1672)', () => {
  test('shows the empty state when a tab has no reconciliation results', async ({ page }) => {
    await stubDetailsPageContext(page);
    await gotoPastMeetingDetails(page);

    const reconcileButton = page.getByTestId('reconcile-attendance-btn');
    await expect(reconcileButton).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await reconcileButton.click();

    const resultsList = page.getByTestId('reconciliation-results-list');
    await expect(resultsList).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(resultsList).toContainText('No attendees in this tab.');
  });
});
