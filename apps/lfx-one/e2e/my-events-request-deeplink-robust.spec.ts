// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { skipWhenAuthMissing } from './helpers/auth.helper';
import { mockEventRoutes } from './helpers/events-mock.helper';
import { DEFAULT_LENS, LENS_COOKIE_KEY } from '@lfx-one/shared/constants';

test.beforeEach(() => skipWhenAuthMissing());

const MATCHED_EVENT = {
  id: 'evt-deep-link-robust-1',
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

test.describe('My Events — Visa/Travel-Fund Request Deep Link — Robust Structural Tests', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    // Ensure "me" lens is active so lensRedirectGuard doesn't redirect to /foundation/events.
    const domain = baseURL ? new URL(baseURL).hostname : 'localhost';
    await context.addCookies([{ name: LENS_COOKIE_KEY, value: DEFAULT_LENS, domain, path: '/' }]);
  });

  test.describe('Visa dialog — deep-linked structure', () => {
    test('dialog, step indicator, and terms container are all attached', async ({ page }) => {
      await mockEventRoutes(page, { matchedEvent: MATCHED_EVENT });
      await page.goto(`/events?tab=visa-letters&event=${MATCHED_EVENT.id}`, { waitUntil: 'domcontentloaded' });

      await expect(page.getByTestId('visa-request-application-dialog')).toBeVisible(DIALOG_TIMEOUT);
      await expect(page.getByTestId('visa-request-step-indicator')).toBeAttached();
      await expect(page.getByTestId('visa-request-terms')).toBeAttached();
    });

    test('step indicator renders exactly 3 step circles', async ({ page }) => {
      await mockEventRoutes(page, { matchedEvent: MATCHED_EVENT });
      await page.goto(`/events?tab=visa-letters&event=${MATCHED_EVENT.id}`, { waitUntil: 'domcontentloaded' });

      await expect(page.getByTestId('visa-request-application-dialog')).toBeVisible(DIALOG_TIMEOUT);
      await expect(page.locator('[data-testid^="visa-request-step-circle-"]')).toHaveCount(3);
    });
  });

  test.describe('Travel-funding dialog — deep-linked structure', () => {
    test('dialog, step indicator, and terms container are all attached', async ({ page }) => {
      await mockEventRoutes(page, { matchedEvent: MATCHED_EVENT });
      await page.goto(`/events?tab=travel-funding&event=${MATCHED_EVENT.id}`, { waitUntil: 'domcontentloaded' });

      await expect(page.getByTestId('travel-fund-application-dialog')).toBeVisible(DIALOG_TIMEOUT);
      await expect(page.getByTestId('travel-fund-step-indicator')).toBeAttached();
      await expect(page.getByTestId('travel-fund-terms')).toBeAttached();
    });

    test('step indicator renders exactly 4 step circles', async ({ page }) => {
      await mockEventRoutes(page, { matchedEvent: MATCHED_EVENT });
      await page.goto(`/events?tab=travel-funding&event=${MATCHED_EVENT.id}`, { waitUntil: 'domcontentloaded' });

      await expect(page.getByTestId('travel-fund-application-dialog')).toBeVisible(DIALOG_TIMEOUT);
      await expect(page.locator('[data-testid^="travel-fund-step-circle-"]')).toHaveCount(4);
    });
  });

  test.describe('No-match fallback — structure', () => {
    test('falls back to the event-selection grid instead of the terms container', async ({ page }) => {
      await mockEventRoutes(page); // no matchedEvent — the eventId lookup always returns empty
      await page.goto('/events?tab=visa-letters&event=unknown-event-id', { waitUntil: 'domcontentloaded' });

      await expect(page.getByTestId('visa-request-application-dialog')).toBeVisible(DIALOG_TIMEOUT);
      await expect(page.getByTestId('event-selection-grid')).toBeVisible(DIALOG_TIMEOUT);
      await expect(page.getByTestId('visa-request-terms')).not.toBeAttached();
    });
  });
});
