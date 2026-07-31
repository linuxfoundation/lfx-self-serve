// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, Route, test } from '@playwright/test';

const MEETINGS_URL = '/meetings';
const LENS_COOKIE = 'lfx-active-lens';

// Deterministic, far-future start so `hasMeetingEnded` never drops the upcoming fixture.
const FUTURE_START = '2099-03-04T15:00:00Z';
const PAST_START = '2020-03-04T15:00:00Z';

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

/** Loads the Me-lens meetings page with one upcoming and one past fixture owned by the signed-in user. */
async function gotoMyMeetings(page: Page): Promise<{ viewerLfid: string }> {
  await seedMeLensCookie(page);
  await stubMeLensContext(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  const viewerLfid = await readViewerLfid(page);
  if (!viewerLfid) {
    test.skip(true, 'Could not resolve the signed-in LFID from the SSR auth state');
    return { viewerLfid: '' };
  }

  const viewer = { name: 'E2E Viewer', username: viewerLfid, email: 'viewer-e2e@example.com' };

  await page.route('**/api/user/meetings*', (route) => fulfillJson(route, [upcomingMeeting('link-up-1', 'Clickable Upcoming', viewer, { organizer: true })]));
  await page.route('**/api/user/past-meetings*', (route) => fulfillJson(route, [pastMeeting('link-past-1', 'Clickable Past', viewer, { organizer: true })]));

  await page.goto(MEETINGS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);
  if (!page.url().includes('/meetings')) {
    test.skip(true, 'Me lens is not available for this user — /meetings redirected away');
  }

  return { viewerLfid };
}

const pastTab = (page: Page) => page.getByTestId('time-filter-tabs').getByTestId('filter-pill-past');
const card = (page: Page, id: string) => page.locator(`#meeting-${id}`);

test.describe('Meeting card — clickable title and date/time chip', () => {
  test('upcoming card: title and date chip are real anchors that open the meeting page in a new tab', async ({ page }) => {
    await gotoMyMeetings(page);

    const upcomingCard = card(page, 'link-up-1');
    await expect(upcomingCard).toBeVisible();

    const title = upcomingCard.getByTestId('meeting-title');
    const chip = upcomingCard.getByTestId('meeting-datetime');

    await expect(title).toHaveJSProperty('tagName', 'A');
    await expect(title).toHaveAttribute('href', '/meetings/link-up-1');
    await expect(title).toHaveAttribute('target', '_blank');

    await expect(chip).toHaveJSProperty('tagName', 'A');
    await expect(chip).toHaveAttribute('href', '/meetings/link-up-1');
    await expect(chip).toHaveAttribute('target', '_blank');
  });

  test('past card: title and date chip navigate in-app (routerLink), not a new tab', async ({ page }) => {
    await gotoMyMeetings(page);
    await pastTab(page).click();

    const pastCard = card(page, 'link-past-1');
    await expect(pastCard).toBeVisible();

    const title = pastCard.getByTestId('meeting-title');
    const chip = pastCard.getByTestId('meeting-datetime');

    await expect(title).toHaveJSProperty('tagName', 'A');
    await expect(title).toHaveAttribute('href', '/meetings/link-past-1');
    await expect(title).not.toHaveAttribute('target', '_blank');

    await expect(chip).toHaveJSProperty('tagName', 'A');
    await expect(chip).toHaveAttribute('href', '/meetings/link-past-1');
    await expect(chip).not.toHaveAttribute('target', '_blank');
  });

  test('clicking inner card actions does not trigger a details navigation', async ({ page }) => {
    await gotoMyMeetings(page);

    const upcomingCard = card(page, 'link-up-1');
    await expect(upcomingCard).toBeVisible();

    await upcomingCard.getByTestId('copy-meeting-button').click();
    await expect(page).toHaveURL(/\/meetings(\?.*)?$/);

    await upcomingCard.getByTestId('delete-meeting-button').click();
    await expect(page).toHaveURL(/\/meetings(\?.*)?$/);
  });
});
