// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { skipWhenAuthMissing } from './helpers/auth.helper';
import { mockEventRoutes } from './helpers/events-mock.helper';
import { DEFAULT_LENS, LENS_COOKIE_KEY } from '@lfx-one/shared/constants';

test.beforeEach(() => skipWhenAuthMissing());

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
    await expect(page.getByTestId('visa-request-terms')).toBeVisible();

    // The `event` param is stripped once consumed, so a refresh doesn't reopen the dialog.
    await expect(page).toHaveURL(/tab=visa-letters/);
    await expect(page).not.toHaveURL(/event=/);
  });

  test('opens the travel-funding dialog on the Terms step when the event matches', async ({ page }) => {
    await mockEventRoutes(page, { matchedEvent: MATCHED_EVENT });
    await page.goto(`/events?tab=travel-funding&event=${MATCHED_EVENT.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('travel-fund-application-dialog')).toBeVisible(DIALOG_TIMEOUT);
    await expect(page.getByTestId('travel-fund-terms')).toBeVisible();
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

test.describe('My Events — Visa/Travel-Fund Request Deep Link — non-"me" starting lens', () => {
  // Regression coverage for PR #2247 review (Copilot): MyEventsDashboardComponent only mounts
  // under the me/project lens, so a deep link opened while the persisted lens is foundation/org
  // must force the lens to `me` (myEventsRequestLensGuard) rather than silently never auto-opening.
  test('foundation lens: the guard forces me and the dialog still auto-opens', async ({ page, context, baseURL }) => {
    const domain = baseURL ? new URL(baseURL).hostname : 'localhost';
    await context.addCookies([{ name: LENS_COOKIE_KEY, value: 'foundation', domain, path: '/' }]);

    await mockEventRoutes(page, { matchedEvent: MATCHED_EVENT });
    await page.goto(`/events?tab=visa-letters&event=${MATCHED_EVENT.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page).not.toHaveURL(/\/foundation\/events/);

    await expect(page.getByTestId('visa-request-application-dialog')).toBeVisible(DIALOG_TIMEOUT);
    await expect(page.getByTestId('visa-request-terms')).toBeVisible();
  });
});
