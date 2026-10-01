// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared mentor e2e setup, modeled on `mentee-profile.helper.ts`. A `page.goto()` of a mentor
 * URL runs `mentorRegisterGuard` and the page reads during SSR, on the Express server, where no
 * `page.route` stub is consulted. `openMentorPage` reaches a mentor page by client-side
 * navigation from `/` instead, so the browser makes those reads and the stubs answer them.
 */

import { expect, Page } from '@playwright/test';

export { enableMentorshipFlag } from './mentee-profile.helper';

export const MENTOR_REGISTER_URL = '/mentorship/mentor';
export const MENTOR_PROGRAMS_URL = '/mentorship/mentor/programs';
export const MENTOR_PAGE_LOAD_TIMEOUT = 30_000;

/** Answers the register guard's profile check. */
export async function stubMentorHasProfile(page: Page, hasProfile: boolean): Promise<void> {
  await page.route('**/api/mentorship/mentor/has-profile', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hasProfile }) })
  );
}

/**
 * Lands on a mentor page by client-side navigation from `/`. The sidebar is `hidden lg:flex`,
 * so callers pin a desktop viewport.
 */
export async function openMentorPage(page: Page, path: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}
