// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Page } from '@playwright/test';

const EMPTY_EVENTS_RESPONSE = { data: [], total: 0, pageSize: 10, offset: 0 };
const EMPTY_COUNTRIES_RESPONSE = { data: [] };

export interface MockEventRoutesOptions<T extends { id: string }> {
  /** Total returned by the pageSize=1 registered-events probe (default 0 = no registered events). */
  probeTotal?: number;
  /** HTTP status for the primary events query (default 200 = success with empty list). */
  mainStatus?: number;
  /** Event returned by the `eventId`-filtered deep-link resolver when its id matches. */
  matchedEvent?: T;
}

/**
 * Mocks all `/api/events*` calls shared by the events-list, event-selection, and deep-link
 * flows. Single source for this route shape so drift between specs (e.g. the `/organizations`
 * vs `search-organizations` endpoints) can't silently reappear.
 */
export async function mockEventRoutes<T extends { id: string }>(
  page: Page,
  { probeTotal = 0, mainStatus = 200, matchedEvent }: MockEventRoutesOptions<T> = {}
): Promise<void> {
  await page.route('**/api/events**', (route) => {
    const url = route.request().url();

    if (url.includes('/countries')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_COUNTRIES_RESPONSE) });
    }
    if (url.includes('/visa-requests') || url.includes('/travel-fund-requests') || url.includes('organizations') || url.includes('/all')) {
      return route.fulfill({ status: mainStatus !== 200 ? mainStatus : 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    }

    const parsedUrl = new URL(url);
    const eventId = parsedUrl.searchParams.get('eventId');
    if (eventId) {
      const data = matchedEvent && eventId === matchedEvent.id ? [matchedEvent] : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, total: data.length, pageSize: 1, offset: 0 }) });
    }

    // Distinguish the pageSize=1 probe from the main paginated query via URL params.
    if (parsedUrl.searchParams.get('pageSize') === '1') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], total: probeTotal, pageSize: 1, offset: 0 }),
      });
    }

    if (mainStatus !== 200) {
      return route.fulfill({ status: mainStatus, contentType: 'application/json', body: JSON.stringify({ error: 'Server error' }) });
    }

    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_EVENTS_RESPONSE) });
  });
}
