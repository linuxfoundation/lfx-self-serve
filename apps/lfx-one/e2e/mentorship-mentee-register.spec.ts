// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee registration — save and the profile-exists refusal (linuxfoundation/lfx-mentorship#187).
 *
 * Stubs the profile check and `POST /api/mentorship/mentee/profile` via `page.route`, so the save
 * runs against a synthetic answer rather than creating a profile for the signed-in user. The page
 * is reached by client-side navigation (`openMenteeTab`), because a `page.goto()` runs the
 * register guard during SSR, where no stub is consulted.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import {
  MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE,
  MENTORSHIP_MENTEE_REGISTER_ERROR_PROFILE_EXISTS,
  MENTORSHIP_MENTEE_SUBMIT_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTEE_OVERVIEW_URL, MENTEE_PROFILE_LOAD_TIMEOUT, openMenteeTab, stubMenteeApplications } from './helpers/mentee-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMenteeTab` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const REGISTER_URL = '/mentorship/mentee';

/** The four checks and the terms acknowledgement the registration form requires. */
const CONFIRMATION_INPUT_IDS = [
  'mentorship-mentee-age-eligible',
  'mentorship-mentee-work-authorized',
  'mentorship-mentee-no-duplicate-profile',
  'mentorship-mentee-compliance',
  'mentorship-mentee-terms',
];

/**
 * Answers the register guard's profile check with "no profile" and the save with `saveStatus`
 * (a 204 carries no body), returning the bodies the page sent.
 */
async function stubRegisterFlow(page: Page, options: { saveStatus?: number; saveBody?: unknown }): Promise<unknown[]> {
  const { saveStatus = 204, saveBody } = options;
  const saveBodies: unknown[] = [];

  await page.route('**/api/mentorship/mentee/has-profile', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hasProfile: false }) })
  );

  await page.route('**/api/mentorship/mentee/profile', (route) => {
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

async function addSkill(page: Page, idPrefix: string, skill: string): Promise<void> {
  await page.locator(`[data-test="${idPrefix}-skill"]`).click();
  await page.getByRole('option', { name: skill, exact: true }).click();
  await page.getByTestId(`${idPrefix}-add-skill`).click();
  await expect(page.getByTestId(`${idPrefix}-skill-list`)).toContainText(skill);
}

async function fillRegistrationForm(page: Page): Promise<void> {
  await expect(page.getByTestId('mentorship-mentee-register-title')).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });

  const editor = page.locator('.lfx-rich-editor__host [contenteditable="true"]');
  await expect(editor).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
  await editor.fill('Test introduction from Test User 1.');

  await addSkill(page, 'mentorship-mentee-have', 'Java');
  await addSkill(page, 'mentorship-mentee-want', 'Python');

  for (const id of CONFIRMATION_INPUT_IDS) {
    await page.locator(`#${id}`).check();
  }
}

test.describe('Mentee registration — save', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('a valid form saves the profile, toasts success and goes to the Overview', async ({ page }) => {
    await stubMenteeApplications(page, 200, JSON.stringify({ data: [], total: 0 }));
    const saveBodies = await stubRegisterFlow(page, { saveStatus: 204 });
    await openMenteeTab(page, REGISTER_URL);

    await fillRegistrationForm(page);
    await page.getByTestId('mentorship-mentee-submit').getByRole('button').click();

    await expect(page.locator('p-toast .p-toast-message-success')).toContainText(MENTORSHIP_MENTEE_SUBMIT_SUCCESS_SUMMARY);
    await expect(page).toHaveURL((url) => url.pathname === MENTEE_OVERVIEW_URL);

    expect(saveBodies).toHaveLength(1);
    const body = saveBodies[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      skillsHave: ['Java'],
      skillsWant: ['Python'],
      ageEligible: true,
      workAuthorized: true,
      noDuplicateProfile: true,
      complianceAccepted: true,
      termsAccepted: true,
    });
    expect(String(body['introduction'])).toContain('Test introduction from Test User 1.');
    // Resume upload is coming soon, so no file name or file leaves the browser.
    expect(Object.keys(body).filter((key) => key.toLowerCase().includes('resume'))).toEqual([]);
  });

  test('a profile that already exists shows the profile-exists banner and keeps Submit usable', async ({ page }) => {
    await stubRegisterFlow(page, { saveStatus: 409, saveBody: { code: MENTORSHIP_MENTEE_PROFILE_EXISTS_ERROR_CODE } });
    await openMenteeTab(page, REGISTER_URL);

    await fillRegistrationForm(page);
    await page.getByTestId('mentorship-mentee-submit').getByRole('button').click();

    const banner = page.getByTestId('mentorship-mentee-submit-error');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-kind', 'profile-exists');
    await expect(banner).toContainText(MENTORSHIP_MENTEE_REGISTER_ERROR_PROFILE_EXISTS);
    await expect(page.getByTestId('mentorship-mentee-profile-exists-continue')).toBeVisible();
    await expect(page.getByTestId('mentorship-mentee-submit').getByRole('button')).toBeEnabled();
  });
});
