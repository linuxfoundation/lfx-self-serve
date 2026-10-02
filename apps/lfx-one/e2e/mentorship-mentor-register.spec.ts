// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor registration — guard, save and the profile-exists refusal (linuxfoundation/lfx-mentorship#208).
 *
 * Stubs the profile check and `POST /api/mentorship/mentor/profile` via `page.route`, so the save
 * runs against a synthetic answer rather than creating a profile for the signed-in user. The page
 * is reached by client-side navigation (`openMentorPage`), because a `page.goto()` runs the
 * register guard during SSR, where no stub is consulted.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import {
  MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE,
  MENTORSHIP_MENTOR_REGISTER_ERROR_PROFILE_EXISTS,
  MENTORSHIP_MENTOR_SUBMIT_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import {
  enableMentorshipFlag,
  MENTOR_PAGE_LOAD_TIMEOUT,
  MENTOR_PROGRAMS_URL,
  MENTOR_REGISTER_URL,
  openMentorPage,
  stubMentorHasProfile,
} from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

/**
 * Answers the program picker's read with no programs, so the form does not depend on what the
 * BFF returns, and the save with `saveStatus` (a 204 carries no body). Returns the bodies sent.
 */
async function stubRegisterSave(page: Page, options: { saveStatus?: number; saveBody?: unknown }): Promise<unknown[]> {
  const { saveStatus = 204, saveBody } = options;
  const saveBodies: unknown[] = [];

  await page.route('**/api/mentorship/mentor/open-programs**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) })
  );

  await page.route('**/api/mentorship/mentor/profile', (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    saveBodies.push(route.request().postDataJSON());
    if (saveStatus === 204) {
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: saveStatus, contentType: 'application/json', body: JSON.stringify(saveBody ?? {}) });
  });

  return saveBodies;
}

async function fillRegistrationForm(page: Page): Promise<void> {
  await expect(page.getByTestId('mentorship-mentor-register-title')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });

  const editor = page.locator('.lfx-rich-editor__host [contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  await editor.fill('Test introduction from Test User 1.');

  await page.locator('[data-test="mentorship-mentor-skill"]').click();
  await page.getByRole('option', { name: 'Kubernetes', exact: true }).click();
  await page.getByTestId('mentorship-mentor-add-skill').click();
  await expect(page.getByTestId('mentorship-mentor-skill-list')).toContainText('Kubernetes');

  await page.locator('#mentorship-mentor-compliance').check();
  await page.locator('#mentorship-mentor-terms').check();
}

test.describe('Mentor registration — guard', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('a mentor who already has a profile is sent to My Programs', async ({ page }) => {
    await stubMentorHasProfile(page, true);
    await openMentorPage(page, MENTOR_REGISTER_URL);

    await expect(page).toHaveURL((url) => url.pathname === MENTOR_PROGRAMS_URL, { timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('mentorship-mentor-register')).toHaveCount(0);
  });
});

test.describe('Mentor registration — save', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubMentorHasProfile(page, false);
  });

  test('a valid form saves the profile, toasts success and goes to My Programs', async ({ page }) => {
    const saveBodies = await stubRegisterSave(page, { saveStatus: 204 });
    await openMentorPage(page, MENTOR_REGISTER_URL);

    await fillRegistrationForm(page);
    await page.getByTestId('mentorship-mentor-submit').getByRole('button').click();

    await expect(page.locator('p-toast .p-toast-message-success')).toContainText(MENTORSHIP_MENTOR_SUBMIT_SUCCESS_SUMMARY);
    await expect(page).toHaveURL((url) => url.pathname === MENTOR_PROGRAMS_URL);

    expect(saveBodies).toHaveLength(1);
    const body = saveBodies[0] as Record<string, unknown>;
    expect(body).toMatchObject({ skills: ['Kubernetes'], complianceAccepted: true, termsAccepted: true });
    expect(String(body['introduction'])).toContain('Test introduction from Test User 1.');
    // Resume upload has no endpoint yet, and no program was picked, so the save carries neither.
    // `lfxProfile` holds whatever the signed-in profile gave the card, so only its shape is checked:
    // it never carries the email, which the BFF reads itself.
    expect(
      Object.keys(body)
        .filter((key) => key !== 'lfxProfile')
        .sort()
    ).toEqual(['complianceAccepted', 'introduction', 'skills', 'termsAccepted']);
    expect(body['lfxProfile'] ?? {}).not.toHaveProperty('email');
  });

  test('a profile that already exists shows the profile-exists banner and keeps Submit usable', async ({ page }) => {
    await stubRegisterSave(page, { saveStatus: 409, saveBody: { code: MENTORSHIP_MENTOR_PROFILE_EXISTS_ERROR_CODE } });
    await openMentorPage(page, MENTOR_REGISTER_URL);

    await fillRegistrationForm(page);
    await page.getByTestId('mentorship-mentor-submit').getByRole('button').click();

    const banner = page.getByTestId('mentorship-mentor-submit-error');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-kind', 'profile-exists');
    await expect(banner).toContainText(MENTORSHIP_MENTOR_REGISTER_ERROR_PROFILE_EXISTS);
    await expect(page.getByTestId('mentorship-mentor-submit').getByRole('button')).toBeEnabled();

    await page.getByTestId('mentorship-mentor-profile-exists-continue').getByRole('button').click();
    await expect(page).toHaveURL((url) => url.pathname === MENTOR_PROGRAMS_URL);
  });
});
