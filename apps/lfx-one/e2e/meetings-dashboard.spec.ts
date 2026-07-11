// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Foundation/Project-lens meetings dashboard stat-card subtext — LFXV2-1901.
 *
 * Locks in the "Next: <date>", "Across X projects", and "X% attendance rate" subtext
 * lines under the FP-lens summary cards at /foundation/meetings (and /project/meetings).
 */

// Deep import (not the '@lfx-one/shared/constants' barrel) so the suite can load this constant without
// bootstrapping Angular — the barrel transitively imports '@angular/forms' via form.utils.ts, which
// crashes the plain-Node Playwright runtime (no Angular JIT compiler loaded). See org-meetings-dashboard.spec.ts.
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants/persona.constants';
import type { PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;

const MOCK_FOUNDATION_SLUG = 'meetings-dash-foundation';
const MOCK_FOUNDATION_UID = 'f0000000-0000-0000-0000-00000000fd01';

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function buildProjectStub() {
  return {
    uid: MOCK_FOUNDATION_UID,
    slug: MOCK_FOUNDATION_SLUG,
    name: 'Meetings Dashboard Foundation',
    parent_uid: '',
    writer: true,
  };
}

function makeUpcomingMeeting(index: number) {
  return {
    id: `mtg-upcoming-${index}`,
    project_uid: MOCK_FOUNDATION_UID,
    project_name: 'Meetings Dashboard Foundation',
    title: `Governing Board Meeting ${index}`,
    start_time: '2099-08-14T17:00:00.000Z',
    duration: 60,
    timezone: 'America/Los_Angeles',
    recurrence: { type: 1, repeat_interval: 1 },
    meeting_type: 'board',
    occurrences: [],
  };
}

function makePastMeeting(index: number, attended: number, total: number) {
  const scheduledStart = new Date(Date.now() - index * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: `mtg-past-${index}`,
    project_uid: MOCK_FOUNDATION_UID,
    project_name: 'Meetings Dashboard Foundation',
    title: `Past Board Meeting ${index}`,
    start_time: scheduledStart,
    scheduled_start_time: scheduledStart,
    duration: 60,
    timezone: 'America/Los_Angeles',
    recurrence: null,
    meeting_type: 'board',
    occurrences: [],
    __attended: attended,
    __total: total,
  };
}

const PAST_MEETINGS = [makePastMeeting(2, 2, 3), makePastMeeting(5, 1, 1), makePastMeeting(9, 0, 2)];

function makeParticipants(attended: number, total: number) {
  return Array.from({ length: total }, (_, i) => ({
    uid: `participant-${i}`,
    meeting_id: 'mtg',
    meeting_and_occurrence_id: 'mtg',
    past_meeting_id: 'mtg',
    email: `attendee-${i}@example.com`,
    first_name: 'Test',
    last_name: `Attendee${i}`,
    host: false,
    is_attended: i < attended,
    is_invited: true,
    org_is_member: false,
    org_is_project_member: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
}

async function stubPersona(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, { personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true })
  );
}

async function stubNavLensItems(page: Page): Promise<void> {
  await page.route('**/api/nav/lens-items*', (route) =>
    fulfillJson(route, {
      items: [{ uid: MOCK_FOUNDATION_UID, slug: MOCK_FOUNDATION_SLUG, name: 'Meetings Dashboard Foundation', logoUrl: null, isFoundation: true }],
      next_page_token: null,
      upstream_failed: false,
      lens: 'foundation',
    })
  );
}

async function stubProjectApi(page: Page): Promise<void> {
  await page.route(`**/api/projects/${MOCK_FOUNDATION_SLUG}*`, (route) => fulfillJson(route, buildProjectStub()));
  await page.route('**/api/projects/*/sfid*', (route) => fulfillJson(route, { sfid: null }));
}

async function stubMeetingsApis(page: Page): Promise<void> {
  await page.route('**/api/meetings*', (route) => fulfillJson(route, { data: [makeUpcomingMeeting(1)], page_token: null }));
  await page.route('**/api/past-meetings*', (route) => {
    const data = PAST_MEETINGS.map(({ __attended, __total, ...meeting }) => meeting);
    return fulfillJson(route, { data, page_token: null });
  });
  // Registered after the generic route above, so Playwright tries these more specific per-meeting
  // routes first for /participants and /recording — the generic handler never sees those URLs.
  for (const meeting of PAST_MEETINGS) {
    await page.route(`**/api/past-meetings/${meeting.id}/participants`, (route) => fulfillJson(route, makeParticipants(meeting.__attended, meeting.__total)));
    await page.route(`**/api/past-meetings/${meeting.id}/recording`, (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));
  }
}

async function setPersonaCookie(page: Page): Promise<void> {
  const state: PersistedPersonaState = { primary: 'executive-director' as PersonaType, all: ['executive-director'] as PersonaType[] };
  await page
    .context()
    .addCookies([{ name: PERSONA_COOKIE_KEY, value: encodeURIComponent(JSON.stringify(state)), domain: 'localhost', path: '/', sameSite: 'Lax' }]);
}

// Gated on env vars rather than URL sniffing so genuine auth-flow regressions still fail loudly when creds ARE configured.
const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

// The app is SSR (Angular's dev-server runs the real Express auth/data middleware for the initial
// document request), so a hard page.goto() straight to a foundation-lens deep link hits real upstream
// data server-side — Playwright's page.route() stubs only intercept browser-side requests and can't
// touch that SSR fetch. Instead, load the (unguarded) Me-lens root via a single hard navigation, then
// drive the rest client-side (lens switch, then a routerLink click into Meetings) so every subsequent
// data fetch is a browser XHR the stubs above can actually catch.
async function gotoFoundationMeetings(page: Page, timeFilter?: 'past'): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);

  await page.getByTestId('lens-foundation-tab').click();
  await expect(page.getByTestId('project-selector')).toContainText('Meetings Dashboard Foundation', { timeout: PAGE_LOAD_TIMEOUT });

  await page.getByRole('link', { name: 'Meetings', exact: true }).click();
  await expect(page).toHaveURL(/\/foundation\/meetings/);

  if (timeFilter === 'past') {
    await page.getByTestId('filter-pill-past').click();
  }
}

test.describe('Meetings Dashboard — Foundation lens stat card subtext', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page);
    await stubPersona(page);
    await stubNavLensItems(page);
    await stubProjectApi(page);
    await stubMeetingsApis(page);
  });

  test('Upcoming Meetings card shows the next meeting date', async ({ page }) => {
    await gotoFoundationMeetings(page);

    const card = page.getByTestId('stat-card-Upcoming Meetings');
    await expect(card).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(card).toContainText('Next: Aug 14');
    await page.screenshot({ path: 'test-results/visual-check-fp-stat-cards-upcoming.png' });
  });

  test('Recurring Series card shows the across-projects subtext', async ({ page }) => {
    await gotoFoundationMeetings(page);

    const card = page.getByTestId('stat-card-Recurring Series');
    await expect(card).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(card).toContainText('Across 1 project');
  });

  test('Past Meetings card shows an attendance-rate subtext computed across past meetings', async ({ page }) => {
    await gotoFoundationMeetings(page, 'past');

    // attended = 2 + 1 + 0 = 3, total = 3 + 1 + 2 = 6 => 50%
    const card = page.getByTestId('stat-card-Past Meetings');
    await expect(card).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(card).toContainText('50% attendance rate');
    await page.screenshot({ path: 'test-results/visual-check-fp-stat-cards-past.png' });
  });
});
