// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared mentee-profile e2e setup. Overview SSR does not fetch
 * `/api/mentorship/mentee/profile`; the Profile tab click is the browser GET
 * that `page.route` can mock.
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

export async function openMenteeProfile(page: Page): Promise<void> {
  await page.goto(MENTEE_OVERVIEW_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('mentee-page-tab-profile')).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
  await page.getByTestId('mentee-page-tab-profile').click();
  await expect(page).toHaveURL((url) => url.pathname === MENTEE_PROFILE_URL);
}
