// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Redesigned meeting not-found page E2E (#4883).
 *
 * With `meetings-redesign` on, a signed-in viewer who opens a meeting link that does not resolve lands on
 * `/meetings/not-found` in the meeting page's top bar and footer, with the legacy copy and reasons. The
 * failing URL stays in history, as on the legacy page.
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200), not production: the server
 *   reads the flag override from a cookie only outside production.
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 */

import { expect, test } from '@playwright/test';

import { stubMeetingPageRedesign } from './helpers/meetings-v2-flag.helper';

const PAGE_LOAD_TIMEOUT = 30_000;
// Eleven digits like a Zoom meeting id, so it reaches the meeting lookup and 404s there.
const UNKNOWN_MEETING_ID = '90000000000';

test.describe('Meeting not-found page (meetings-redesign on)', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await stubMeetingPageRedesign(page, baseURL);
  });

  test('keeps the not-found copy in the meeting page chrome and the failing URL in history', async ({ page }) => {
    await page.goto(`/meetings/${UNKNOWN_MEETING_ID}`);

    await expect(page).toHaveURL(/\/meetings\/not-found$/, { timeout: PAGE_LOAD_TIMEOUT });
    const notFound = page.getByTestId('meeting-page-not-found');
    await expect(notFound).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('meeting-page-top-bar')).toBeVisible();
    await expect(page.getByTestId('meeting-page-footer')).toBeVisible();
    await expect(page).toHaveTitle('Meeting Not Found · LFX');
    await expect(notFound.getByRole('heading', { level: 1, name: 'Meeting Not Found' })).toBeVisible();
    await expect(notFound.getByText("We couldn't find the meeting you're looking for. This might happen for several reasons.")).toBeVisible();
    for (const reason of [
      'The meeting link has expired or is no longer valid',
      'The meeting has been deleted or cancelled',
      'You may need the correct password to access this meeting',
      'The meeting URL may contain a typo',
    ]) {
      await expect(notFound.getByText(reason)).toBeVisible();
    }
    await expect(page.getByTestId('meeting-page-not-found-support')).toBeVisible();

    // The redirect does not replace the failing URL: Back returns to it, and it redirects again.
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/meetings/(${UNKNOWN_MEETING_ID}|not-found)$`), { timeout: PAGE_LOAD_TIMEOUT });
    await expect(notFound).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    await page.getByTestId('meeting-page-not-found-my-meetings').getByRole('button').click();
    await expect(page).toHaveURL(/\/meetings$/, { timeout: PAGE_LOAD_TIMEOUT });
  });
});
