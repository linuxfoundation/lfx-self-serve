// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, test } from '@playwright/test';
import { skipWhenAuthMissing } from './helpers/auth.helper';
import { DEFAULT_LENS, LENS_COOKIE_KEY } from '@lfx-one/shared/constants';

test.beforeEach(() => skipWhenAuthMissing());

const EMPTY_EVENTS_RESPONSE = { data: [], total: 0, pageSize: 10, offset: 0 };
const EMPTY_COUNTRIES_RESPONSE = { data: [] };

const DEEP_LINK_EVENT_ID = 'evt-deep-link-123';
const MATCHED_EVENT = {
  id: DEEP_LINK_EVENT_ID,
  name: 'Open Source Summit',
  url: 'https://events.linuxfoundation.org/open-source-summit',
  registrationUrl: null,
  foundation: 'Linux Foundation',
  startDate: '2026-06-30T00:00:00.000Z',
  date: 'Jun 30–Jul 2, 2026',
  location: 'Seattle, WA',
  role: 'Attendee',
  status: 'Registered',
};

const DIALOG_TIMEOUT = { timeout: 10000 };

/**
 * Mocks all /api/events* calls. The `eventId`-filtered call (the deep-link resolver, made
 * client-side once the dialog opens) returns `matchedEvent` when its id matches, otherwise empty.
 * Every other call this test actually exercises client-side (the event-selection grid's fetch,
 * countries, organizations) resolves empty so the dialog renders deterministically.
 */
async function mockEventRoutes(page: Page, { matchedEvent }: { matchedEvent?: typeof MATCHED_EVENT } = {}) {
  await page.route('**/api/events**', (route) => {
    const url = route.request().url();

    if (url.includes('/countries')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_COUNTRIES_RESPONSE) });
    }
    if (url.includes('/visa-requests') || url.includes('/travel-fund-requests') || url.includes('search-organizations') || url.includes('/all')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    }

    const parsedUrl = new URL(url);
    const eventId = parsedUrl.searchParams.get('eventId');
    if (eventId) {
      const data = matchedEvent && eventId === matchedEvent.id ? [matchedEvent] : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, total: data.length, pageSize: 1, offset: 0 }) });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_EVENTS_RESPONSE) });
  });
}

test.describe('My Events — Visa/Travel-Fund Request Deep Link', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    // Ensure "me" lens is active so lensRedirectGuard doesn't redirect to /foundation/events.
    const domain = baseURL ? new URL(baseURL).hostname : 'localhost';
    await context.addCookies([{ name: LENS_COOKIE_KEY, value: DEFAULT_LENS, domain, path: '/' }]);
  });

  test('opens the visa dialog on the Terms step and strips ?event= once matched', async ({ page }) => {
    await mockEventRoutes(page, { matchedEvent: MATCHED_EVENT });
    await page.goto(`/events?tab=visa-letters&event=${MATCHED_EVENT.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('visa-request-application-dialog')).toBeVisible(DIALOG_TIMEOUT);
    await expect(page.getByTestId('visa-request-step-circle-2')).toHaveClass(/bg-blue-600/);

    // The `event` param is stripped once consumed, so a refresh doesn't reopen the dialog.
    await expect(page).toHaveURL(/tab=visa-letters/);
    await expect(page).not.toHaveURL(/event=/);
  });

  test('opens the travel-funding dialog on the Terms step when the event matches', async ({ page }) => {
    await mockEventRoutes(page, { matchedEvent: MATCHED_EVENT });
    await page.goto(`/events?tab=travel-funding&event=${MATCHED_EVENT.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('travel-fund-application-dialog')).toBeVisible(DIALOG_TIMEOUT);
    await expect(page.getByTestId('travel-fund-step-circle-2')).toHaveClass(/bg-blue-600/);
    await expect(page).not.toHaveURL(/event=/);
  });

  test('falls back to Choose an Event with a toast when the event id has no match', async ({ page }) => {
    await mockEventRoutes(page); // no matchedEvent — the eventId lookup always returns empty
    await page.goto('/events?tab=visa-letters&event=unknown-event-id', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('visa-request-application-dialog')).toBeVisible(DIALOG_TIMEOUT);
    await expect(page.getByTestId('event-selection-grid')).toBeVisible(DIALOG_TIMEOUT);
    await expect(page.getByText("couldn't find that event")).toBeVisible();
  });
});
