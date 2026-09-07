// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Pre-feature vs invite-response-enabled RSVP UI (GH-1951).
 *
 * Meetings that predate LFX invite-response tracking must not show RSVP buttons,
 * Yes/Maybe/No counts, or guest-drawer RSVP filter/chips. Meetings with the flag
 * explicitly true keep the full RSVP UI.
 */

import { expect, Page, Route, test } from '@playwright/test';

const MEETINGS_URL = '/meetings';
const LENS_COOKIE = 'lfx-active-lens';
const FUTURE_START = '2099-03-04T15:00:00Z';

test.setTimeout(120_000);

const GUEST = {
  uid: 'guest-rsvp-1',
  first_name: 'Pat',
  last_name: 'Guest',
  email: 'pat-guest@example.com',
  rsvp: { response_type: 'accepted', meeting_id: 'placeholder', registrant_id: 'guest-rsvp-1' },
};

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
    registrant_count: 1,
    ...extra,
  };
}

async function gotoMeetingsWithFixtures(page: Page, extras: { organizer: Record<string, unknown>; invited: Record<string, unknown> }): Promise<void> {
  await seedMeLensCookie(page);

  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, {
      personas: ['contributor'],
      personaProjects: {},
      projects: [],
      organizations: [],
      isRootWriter: false,
    })
  );
  await page.route('**/api/user/pending-actions*', (route) => fulfillJson(route, []));
  await page.route('**/api/meetings/*/attachments*', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/api/past-meetings/**', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.route('**/api/meetings/*/registrants*', (route) => fulfillJson(route, [{ ...GUEST, meeting_id: 'fixture' }]));
  await page.route('**/api/meetings/*/rsvp*', (route) => fulfillJson(route, []));

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  const viewerLfid = await readViewerLfid(page);
  if (!viewerLfid) {
    test.skip(true, 'Could not resolve the signed-in LFID from the SSR auth state');
    return;
  }

  const viewer = { name: 'E2E Viewer', username: viewerLfid, email: 'viewer-e2e@example.com' };

  await page.route('**/api/user/meetings*', (route) =>
    fulfillJson(route, [
      upcomingMeeting('rsvp-org-1', 'Organizer Fixture', viewer, { organizer: true, invited: true, ...extras.organizer }),
      upcomingMeeting('rsvp-inv-1', 'Invited Fixture', viewer, { organizer: false, invited: true, ...extras.invited }),
    ])
  );
  await page.route('**/api/user/past-meetings*', (route) => fulfillJson(route, []));

  await page.goto(MEETINGS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);
  if (!page.url().includes('/meetings')) {
    test.skip(true, 'Me lens is not available for this user — /meetings redirected away');
  }
}

const card = (page: Page, id: string) => page.locator(`#meeting-${id}`);

test.describe('Meeting RSVP UI — pre-feature vs invite-response enabled (GH-1951)', () => {
  test('absent/false flag hides RSVP card controls, guest-drawer filter, and chips', async ({ page }) => {
    await gotoMeetingsWithFixtures(page, {
      organizer: { is_invite_responses_enabled: false },
      invited: {},
    });

    const organizerCard = card(page, 'rsvp-org-1');
    const invitedCard = card(page, 'rsvp-inv-1');
    await expect(organizerCard).toBeVisible();
    await expect(invitedCard).toBeVisible();

    await organizerCard.getByTestId('rsvp-details-card').scrollIntoViewIfNeeded();
    await expect(organizerCard.getByTestId('rsvp-details-invitee-count')).toBeVisible();
    await expect(organizerCard.getByTestId('rsvp-details-breakdown')).toHaveCount(0);
    await expect(organizerCard.getByTestId('meeting-rsvp-button-yes')).toHaveCount(0);
    await expect(organizerCard.getByTestId('toggle-rsvp-view-button')).toHaveCount(0);

    await expect(invitedCard.getByTestId('meeting-rsvp-button-yes')).toHaveCount(0);

    await organizerCard.getByTestId('view-guests-button').click();
    const drawer = page.getByTestId('meeting-registrants-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('registrant-guest-rsvp-1')).toBeVisible();
    await expect(drawer.getByTestId('rsvp-filter-select')).toHaveCount(0);
    await expect(drawer.getByTestId('registrant-rsvp-status')).toHaveCount(0);
  });

  test('explicit true flag keeps RSVP card controls, guest-drawer filter, and chips', async ({ page }) => {
    await gotoMeetingsWithFixtures(page, {
      organizer: { is_invite_responses_enabled: true },
      invited: { is_invite_responses_enabled: true },
    });

    const organizerCard = card(page, 'rsvp-org-1');
    const invitedCard = card(page, 'rsvp-inv-1');
    await expect(organizerCard).toBeVisible();
    await expect(invitedCard).toBeVisible();

    await organizerCard.getByTestId('rsvp-details-card').scrollIntoViewIfNeeded();
    await expect(organizerCard.getByTestId('rsvp-details-card')).toBeVisible();
    await expect(organizerCard.getByTestId('rsvp-details-breakdown')).toBeVisible();
    await expect(organizerCard.getByTestId('rsvp-details-invitee-count')).toHaveCount(0);
    await expect(organizerCard.getByTestId('toggle-rsvp-view-button')).toBeVisible();

    await invitedCard.getByTestId('meeting-rsvp-button-yes').scrollIntoViewIfNeeded();
    await expect(invitedCard.getByTestId('meeting-rsvp-button-yes')).toBeVisible();
    await expect(invitedCard.getByTestId('meeting-rsvp-button-no')).toBeVisible();
    await expect(invitedCard.getByTestId('meeting-rsvp-button-maybe')).toBeVisible();

    await organizerCard.getByTestId('view-guests-button').click();
    const drawer = page.getByTestId('meeting-registrants-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByTestId('rsvp-filter-select')).toBeVisible();
    await expect(drawer.getByTestId('registrant-rsvp-status')).toBeVisible();
  });
});
