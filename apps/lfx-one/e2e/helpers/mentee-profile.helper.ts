// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared mentee e2e setup. Overview SSR does not fetch
 * `/api/mentorship/mentee/profile`; the Profile tab click is the browser GET
 * that `page.route` can mock. Overview SSR does fetch
 * `/api/mentorship/mentee/applications`, so `openMenteeTab` reaches a tab by
 * client-side navigation instead.
 */

import { FEATURE_FLAG_OVERRIDE_STORAGE_KEY, MENTORSHIP_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { expect, Page } from '@playwright/test';

export const MENTEE_OVERVIEW_URL = '/mentorship/mentee/overview';
export const MENTEE_PROFILE_URL = '/mentorship/mentee/profile';
export const MENTEE_PROFILE_LOAD_TIMEOUT = 30_000;

export async function enableMentorshipFlag(page: Page): Promise<void> {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key as string, value as string), [
    FEATURE_FLAG_OVERRIDE_STORAGE_KEY,
    JSON.stringify({ [MENTORSHIP_ENABLED_FLAG]: true }),
  ] as const);
}

/** Answers every mentee applications read with the given status and body. */
export async function stubMenteeApplications(page: Page, status: number, body: string): Promise<void> {
  await page.route('**/api/mentorship/mentee/applications*', (route) => route.fulfill({ status, contentType: 'application/json', body }));
}

export async function openMenteeProfile(page: Page): Promise<void> {
  await page.goto(MENTEE_OVERVIEW_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('mentee-page-tab-profile')).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
  await page.getByTestId('mentee-page-tab-profile').click();
  await expect(page).toHaveURL((url) => url.pathname === MENTEE_PROFILE_URL);
}

/**
 * Lands on a mentee tab by client-side navigation from `/`. A `page.goto()` of a mentee URL SSRs
 * the page shell, whose applications read runs on the Express server and reaches the browser
 * through the HTTP transfer cache, so a `page.route` stub of the applications read would never be
 * consulted. The sidebar is `hidden lg:flex`, so callers pin a desktop viewport.
 */
export async function openMenteeTab(page: Page, path: string): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('sidebar')).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect(page).toHaveURL((url) => url.pathname === path);
}
