// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, Route, test } from '@playwright/test';

import { suppressCookieBanner } from './helpers/account-settings-email.helper';

const MEETINGS_URL = '/meetings';
const LENS_COOKIE = 'lfx-active-lens';

// Deterministic, far-future start so `hasMeetingEnded` never drops the upcoming fixtures.
const FUTURE_START = '2099-03-04T15:00:00Z';
const PAST_START = '2020-03-04T15:00:00Z';

const OTHER_ORGANIZER = { name: 'Grace Hopper', username: 'ghopper-e2e', email: 'grace-e2e@example.com' };
const SERVICE_ACCOUNT = { name: 'Zoom Webhooks', username: 'zoom.webhooks', email: 'noreply@zoom.us' };

test.setTimeout(120_000);
test.beforeEach(async ({ page }) => suppressCookieBanner(page));

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
 * out of serialized state with canonical LFID first, then the alias-only fallback.
 */
async function readViewerLfid(page: Page): Promise<string | null> {
  const raw = await page.locator('#ng-state').textContent();
  if (!raw) {
    return null;
  }
  try {
    const state = JSON.parse(raw) as Record<string, { user?: Record<string, string> }>;
    const user = state['auth']?.user;
    return user?.['https://sso.linuxfoundation.org/claims/username'] || user?.['username'] || null;
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

/** Isolated lists and RSVP writes; no synthetic request reaches the deployed meeting service. */
async function stubMeetingLists(page: Page, viewerLfid: string, failWrite: boolean): Promise<void> {
  const viewer = { name: 'E2E Viewer', username: viewerLfid, email: 'viewer-e2e@example.com' };
  const responses = new Map<string, Record<string, unknown>>();
  const answered = { response_type: 'accepted', scope: 'all' };
  await page.route('**/api/meetings/up-*/**', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/api/user/meetings*', (route) =>
    fulfillJson(route, [
      upcomingMeeting('up-mine', 'Upcoming Mine', viewer, { organizer: true, is_invite_responses_enabled: true, my_rsvp: answered }),
      upcomingMeeting('up-theirs', 'Upcoming Theirs', OTHER_ORGANIZER, {
        invited: true,
        is_invite_responses_enabled: true,
        my_rsvp: responses.get('up-theirs') ?? null,
        // Matches the write stub's registrant; the feed always pairs `my_rsvp` with active registrations.
        my_registrant_ids: ['guest-up-theirs'],
      }),
      upcomingMeeting('up-organizer-pending', 'Invited Organizer', viewer, {
        organizer: true,
        invited: true,
        is_invite_responses_enabled: true,
        my_rsvp: responses.get('up-organizer-pending') ?? null,
        my_registrant_ids: ['guest-up-organizer-pending'],
      }),
      upcomingMeeting('up-granted', 'Upcoming Granted', SERVICE_ACCOUNT, { organizer: true, is_invite_responses_enabled: false }),
      upcomingMeeting('up-alias', 'Alias Is Not Ownership', { ...OTHER_ORGANIZER, username: 'display-alias-e2e' }, { is_invite_responses_enabled: false }),
    ])
  );
  await page.route('**/api/user/past-meetings*', (route) =>
    fulfillJson(route, [
      pastMeeting('past-mine', 'Past Mine', viewer, { organizer: true }),
      pastMeeting('past-theirs', 'Past Theirs', OTHER_ORGANIZER),
      pastMeeting('past-granted', 'Past Granted', SERVICE_ACCOUNT, { organizer: true }),
    ])
  );
  await page.route('**/api/meetings/up-*/rsvp/me*', (route) =>
    fulfillJson(route, responses.get(new URL(route.request().url()).pathname.split('/')[3]) ?? null)
  );
  await page.route('**/api/meetings/up-*/rsvp', (route) => {
    if (failWrite) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic write rejected' }) });
    const id = new URL(route.request().url()).pathname.split('/')[3];
    const rsvp = {
      id: `rsvp-${id}`,
      meeting_id: id,
      registrant_id: `guest-${id}`,
      username: viewerLfid,
      email: viewer.email,
      response_type: route.request().postDataJSON().response,
      scope: 'all',
      created_at: '2099-01-01T00:00:00Z',
    };
    responses.set(id, rsvp);
    return fulfillJson(route, rsvp);
  });
}

/** Make a conflicting display claim before hydration; fixture ownership still uses canonical LFID. */
async function seedConflictingAlias(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === MEETINGS_URL,
    async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const body = html.replace(/(<script[^>]*id="ng-state"[^>]*>)([\s\S]*?)(<\/script>)/, (_match, open, raw, close) => {
        const state = JSON.parse(raw) as Record<string, { user?: Record<string, string> }>;
        if (!state['auth']?.user?.['https://sso.linuxfoundation.org/claims/username'])
          throw new Error('Canonical LFID is required for conflicting-claim coverage');
        state['auth'].user['username'] = 'display-alias-e2e';
        return open + JSON.stringify(state).replace(/</g, '\\u003c') + close;
      });
      await route.fulfill({ response, body });
    }
  );
}

/** Loads the Me-lens meetings page with fixtures keyed to the signed-in user. */
async function gotoMyMeetings(page: Page, failWrite = false): Promise<void> {
  await seedMeLensCookie(page);
  await stubMeLensContext(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  const viewerLfid = await readViewerLfid(page);
  if (!viewerLfid) {
    test.skip(true, 'Could not resolve the signed-in LFID from the SSR auth state');
    return;
  }

  await stubMeetingLists(page, viewerLfid, failWrite);
  await seedConflictingAlias(page);
  await page.goto(MEETINGS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);
  if (!page.url().includes('/meetings')) {
    test.skip(true, 'Me lens is not available for this user — /meetings redirected away');
  }
}

const viewPill = (page: Page, view: string) => page.getByTestId('meeting-view-pills').getByTestId(`filter-pill-${view}`);
const responsePill = (page: Page, response: string) => page.getByTestId('meeting-response-pills').getByTestId(`filter-pill-${response}`);
const organizerCheckbox = (page: Page) => page.getByTestId('organized-by-me-checkbox').getByRole('checkbox');
const card = (page: Page, id: string) => page.locator(`#meeting-${id}`);

/** Scroll normally so Angular's viewport-deferred cards mount before membership assertions. */
async function revealMeeting(page: Page, id: string): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const placeholders = page.locator('lfx-meetings-dashboard [class~="min-h-[200px]"]');
  while (await placeholders.count()) {
    const placeholder = await placeholders.first().elementHandle();
    if (!placeholder) continue;
    await placeholder.scrollIntoViewIfNeeded();
    await page.waitForFunction((element) => !element.isConnected, placeholder);
    await placeholder.dispose();
  }
  await card(page, id).waitFor({ state: 'attached' });
}

test.describe('My Meetings — separate response and organizer filters', () => {
  test('combines personal filters and clears them on time changes while using canonical ownership', async ({ page }) => {
    await gotoMyMeetings(page);
    await expect(card(page, 'up-mine')).toBeVisible();
    await revealMeeting(page, 'up-theirs');
    await expect(card(page, 'up-theirs')).toBeVisible();
    await organizerCheckbox(page).check();
    await expect(card(page, 'up-mine')).toBeVisible();
    await expect(card(page, 'up-theirs')).toHaveCount(0);
    await expect(card(page, 'up-granted')).toHaveCount(0);
    await expect(card(page, 'up-alias')).toHaveCount(0);
    await responsePill(page, 'pending').click();
    await revealMeeting(page, 'up-organizer-pending');
    await expect(card(page, 'up-organizer-pending')).toBeVisible();
    await expect(card(page, 'up-mine')).toHaveCount(0);
    await expect(card(page, 'up-theirs')).toHaveCount(0);
    await expect(organizerCheckbox(page)).toBeChecked();
    await expect(page.getByTestId('meeting-response-pills').locator('button[aria-pressed="true"]')).toHaveCount(1);
    await viewPill(page, 'past').click();
    await expect(page.getByTestId('personal-meeting-filters')).toHaveCount(0);
    for (const id of ['past-mine', 'past-theirs', 'past-granted']) {
      await revealMeeting(page, id);
      await expect(card(page, id)).toBeVisible();
    }
    await viewPill(page, 'upcoming').click();
    await expect(responsePill(page, 'all')).toHaveAttribute('aria-pressed', 'true');
    await expect(organizerCheckbox(page)).not.toBeChecked();
    for (const id of ['up-mine', 'up-theirs', 'up-granted', 'up-alias']) {
      await revealMeeting(page, id);
      await expect(card(page, id)).toBeVisible();
    }
  });

  test('Need Your RSVP selects Needs response idempotently and reset restores all meetings', async ({ page }) => {
    await gotoMyMeetings(page);
    await organizerCheckbox(page).check();
    const summary = page.getByTestId('meetings-me-stat-pending-rsvp');
    await summary.click();
    await summary.click();
    await expect(organizerCheckbox(page)).not.toBeChecked();
    await expect(responsePill(page, 'pending')).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, 'up-theirs')).toBeVisible();
    await expect(responsePill(page, 'pending')).toHaveText('Needs response (2)');
    await page.getByTestId('meeting-type-filter').getByRole('combobox').click();
    await page.getByRole('option', { name: 'Board', exact: true }).click();
    await page.getByTestId('meetings-search-input').getByRole('textbox').fill('zzz-no-such-meeting');
    const empty = page.getByTestId('meetings-empty-state-filtered');
    await expect(empty).toBeVisible();
    await expect(responsePill(page, 'pending')).toHaveText('Needs response (2)');
    await empty.getByRole('button', { name: 'Reset filters' }).click();
    await expect(viewPill(page, 'upcoming')).toHaveAttribute('aria-pressed', 'true');
    await expect(responsePill(page, 'all')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('meetings-search-input').getByRole('textbox')).toHaveValue('');
    await expect(page.getByTestId('meeting-type-filter')).toContainText('All Types');
    // Recovery crosses the debounced search boundary before lower cards can enter the viewport.
    await expect(card(page, 'up-mine')).toBeVisible();
    await revealMeeting(page, 'up-granted');
    await expect(card(page, 'up-granted')).toBeVisible();
  });

  for (const [id, organizer] of [
    ['up-theirs', false],
    ['up-organizer-pending', true],
  ] as const) {
    for (const answer of ['Yes', 'Maybe', 'No'] as const) {
      test(`${organizer ? 'invited organizer' : 'invitee'} ${answer} refreshes pending membership and totals without navigation`, async ({ page }) => {
        await gotoMyMeetings(page);
        await responsePill(page, 'pending').click();
        const meeting = card(page, id);
        await revealMeeting(page, id);
        await expect(meeting).toBeVisible();
        await meeting.getByRole('button', { name: answer, exact: true }).click();
        await expect(meeting).toHaveCount(0);
        await expect(responsePill(page, 'pending')).toHaveText('Needs response (1)');
        await expect(responsePill(page, 'pending')).toHaveAttribute('aria-pressed', 'true');
        await expect(page).toHaveURL(/\/meetings$/);
      });
    }
    test(`${organizer ? 'invited organizer' : 'invitee'} failed RSVP retains pending rows and count`, async ({ page }) => {
      await gotoMyMeetings(page, true);
      await responsePill(page, 'pending').click();
      const meeting = card(page, id);
      await revealMeeting(page, id);
      await expect(meeting).toBeVisible();
      await meeting.getByRole('button', { name: 'Yes', exact: true }).click();
      await expect(page.getByText('Synthetic write rejected', { exact: true })).toBeVisible();
      await expect(meeting).toBeVisible();
      await expect(responsePill(page, 'pending')).toHaveText('Needs response (2)');
    });
  }
});
