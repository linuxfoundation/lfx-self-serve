// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, Route, test } from '@playwright/test';

const MEETINGS_URL = '/meetings';
const LENS_COOKIE = 'lfx-active-lens';

// Deterministic, far-future start so `hasMeetingEnded` never drops the upcoming fixtures.
const FUTURE_START = '2099-03-04T15:00:00Z';
const PAST_START = '2020-03-04T15:00:00Z';

const OTHER_ORGANIZER = { name: 'Grace Hopper', username: 'ghopper-e2e', email: 'grace-e2e@example.com' };
const SERVICE_ACCOUNT = { name: 'Zoom Webhooks', username: 'zoom.webhooks', email: 'noreply@zoom.us' };

test.setTimeout(120_000);

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Let malformed URLs fail naturally.
  }
}

async function seedMeLensCookie(page: Page): Promise<void> {
  await page.context().addCookies([{ name: LENS_COOKIE, value: 'me', domain: 'localhost', path: '/' }]);
}

/**
 * The signed-in user's LFID comes from the SSR auth context (TransferState), not an API the test
 * can stub — so the fixtures have to be built around whoever is actually logged in. Reads it back
 * out of the serialized state the same way the app does (`username`, then the namespaced claim).
 */
async function readViewerLfid(page: Page): Promise<string | null> {
  const raw = await page.locator('#ng-state').textContent();
  if (!raw) {
    return null;
  }
  try {
    const state = JSON.parse(raw) as Record<string, { user?: Record<string, string> }>;
    const user = state['auth']?.user;
    return user?.['username'] || user?.['https://sso.linuxfoundation.org/claims/username'] || null;
  } catch {
    return null;
  }
}

async function stubMeLensContext(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, {
      personas: ['contributor'],
      personaProjects: {},
      projects: [],
      organizations: [],
      isRootWriter: false,
    })
  );

  // Per-card lookups (materials, recordings, summaries, transcripts) are irrelevant here and each
  // component already degrades on error — 404 keeps them off the real backend.
  await page.route('**/api/meetings/*/attachments*', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/api/past-meetings/**', (route) => route.fulfill({ status: 404, body: '{}' }));
}

function upcomingMeeting(id: string, title: string, createdBy: { name: string; username: string; email: string }, extra: Record<string, unknown> = {}) {
  return {
    id,
    uid: id,
    title,
    description: title,
    start_time: FUTURE_START,
    duration: 60,
    timezone: 'UTC',
    meeting_type: 'Board',
    visibility: 'public',
    restricted: false,
    project_uid: 'proj-e2e',
    project_name: 'E2E Project',
    is_foundation: false,
    committees: [],
    occurrences: [],
    recurrence: null,
    created_by: createdBy,
    ...extra,
  };
}

function pastMeeting(id: string, title: string, createdBy: { name: string; username: string; email: string }, extra: Record<string, unknown> = {}) {
  return {
    ...upcomingMeeting(id, title, createdBy, extra),
    start_time: PAST_START,
    scheduled_start_time: PAST_START,
    meeting_and_occurrence_id: id,
    meeting_id: `series-${id}`,
  };
}

/**
 * Stubs both Me-lens meeting lists. Each list gets one meeting created by the viewer, one created
 * by someone else, and one webhook-created meeting the viewer merely has an `organizer` (FGA
 * manage) grant on — the case that must NOT survive the "Organized by me" filter.
 */
async function stubMeetingLists(page: Page, viewerLfid: string): Promise<void> {
  const viewer = { name: 'E2E Viewer', username: viewerLfid, email: 'viewer-e2e@example.com' };

  await page.route('**/api/user/meetings*', (route) =>
    fulfillJson(route, [
      upcomingMeeting('up-mine', 'Upcoming Mine', viewer, { organizer: true }),
      upcomingMeeting('up-theirs', 'Upcoming Theirs', OTHER_ORGANIZER),
      upcomingMeeting('up-granted', 'Upcoming Granted', SERVICE_ACCOUNT, { organizer: true }),
    ])
  );

  await page.route('**/api/user/past-meetings*', (route) =>
    fulfillJson(route, [
      pastMeeting('past-mine', 'Past Mine', viewer, { organizer: true }),
      pastMeeting('past-theirs', 'Past Theirs', OTHER_ORGANIZER),
      pastMeeting('past-granted', 'Past Granted', SERVICE_ACCOUNT, { organizer: true }),
    ])
  );
}

/** Loads the Me-lens meetings page with fixtures keyed to the signed-in user. */
async function gotoMyMeetings(page: Page): Promise<void> {
  await seedMeLensCookie(page);
  await stubMeLensContext(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  const viewerLfid = await readViewerLfid(page);
  if (!viewerLfid) {
    test.skip(true, 'Could not resolve the signed-in LFID from the SSR auth state');
    return;
  }

  await stubMeetingLists(page, viewerLfid);
  await page.goto(MEETINGS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);
  if (!page.url().includes('/meetings')) {
    test.skip(true, 'Me lens is not available for this user — /meetings redirected away');
  }
}

const organizerPill = (page: Page) => page.getByTestId('organizer-filter-pills').getByTestId('filter-pill-organizer');
const pastTab = (page: Page) => page.getByTestId('time-filter-tabs').getByTestId('filter-pill-past');
const upcomingTab = (page: Page) => page.getByTestId('time-filter-tabs').getByTestId('filter-pill-upcoming');
const card = (page: Page, id: string) => page.locator(`#meeting-${id}`);

test.describe('My Meetings — "Organized by me" filter', () => {
  test('is offered on both time tabs, unlike the upcoming-only Pending RSVP pill', async ({ page }) => {
    await gotoMyMeetings(page);

    await expect(organizerPill(page)).toBeVisible();
    await expect(page.getByTestId('pending-rsvp-filter-pills')).toBeVisible();

    await pastTab(page).click();
    await expect(organizerPill(page)).toBeVisible();
    await expect(page.getByTestId('pending-rsvp-filter-pills')).toHaveCount(0);
  });

  test('keeps only meetings the viewer created — an inherited organizer grant is not enough', async ({ page }) => {
    await gotoMyMeetings(page);

    await expect(card(page, 'up-mine')).toBeVisible();
    await expect(card(page, 'up-theirs')).toBeVisible();
    await expect(card(page, 'up-granted')).toBeVisible();

    await organizerPill(page).click();

    await expect(card(page, 'up-mine')).toBeVisible();
    await expect(card(page, 'up-theirs')).toHaveCount(0);
    // `organizer: true` is an FGA manage grant, not authorship — it must not survive the filter.
    await expect(card(page, 'up-granted')).toHaveCount(0);
  });

  test('persists across Upcoming ↔ Past and filters the past list too', async ({ page }) => {
    await gotoMyMeetings(page);

    await organizerPill(page).click();
    await pastTab(page).click();

    // Still active after the tab switch — the filter is meaningful on both tabs.
    await expect(card(page, 'past-mine')).toBeVisible();
    await expect(card(page, 'past-theirs')).toHaveCount(0);
    await expect(card(page, 'past-granted')).toHaveCount(0);

    await upcomingTab(page).click();
    await expect(card(page, 'up-mine')).toBeVisible();
    await expect(card(page, 'up-theirs')).toHaveCount(0);
  });

  test('shows the filtered empty state with a working reset when nothing matches', async ({ page }) => {
    await gotoMyMeetings(page);

    // Search that matches nothing, combined with the pill, drives the list to zero.
    await page.getByTestId('meetings-search-input').getByRole('textbox').fill('zzz-no-such-meeting');
    await organizerPill(page).click();

    const emptyState = page.getByTestId('meetings-empty-state-filtered');
    await expect(emptyState).toBeVisible();
    await expect(page.getByTestId('meetings-empty-state')).toHaveCount(0);

    await emptyState.getByRole('button', { name: 'Reset filters' }).click();

    // Reset clears the pill along with the search — the full list is back.
    await expect(card(page, 'up-theirs')).toBeVisible();
    await expect(card(page, 'up-granted')).toBeVisible();
  });
});
