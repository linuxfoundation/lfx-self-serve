// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee apply page — blocked states and submit (linuxfoundation/lfx-mentorship#192).
 *
 * Stubs the profile check, the profile read, the apply-target read and the submit via
 * `page.route`, so each upstream answer runs against a synthetic term rather than whatever the
 * signed-in user can apply to. The page is reached by client-side navigation (`openMenteeTab`),
 * because a `page.goto()` would read the apply target during SSR, where no stub is consulted.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_MENTEE_APPLY_SUCCESS_SUMMARY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTEE_OVERVIEW_URL, MENTEE_PROFILE_LOAD_TIMEOUT, openMenteeTab, stubMenteeApplications } from './helpers/mentee-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMenteeTab` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const APPLY_IDS = { programId: '3b1f6c0e-2d4a-4e8b-9c1d-5f6a7b8c9d0e', programTermId: '8e2d4c6a-1b3f-4a5c-8d7e-9f0a1b2c3d4e' };
const APPLY_URL = `/mentorship/mentee/apply?programId=${APPLY_IDS.programId}&programTermId=${APPLY_IDS.programTermId}`;
const PROGRAM_NAME = 'Test Program One';

/** The five checks the submit button waits on: four on the page and the terms acknowledgement. */
const CONFIRMATION_INPUT_IDS = [
  'mentorship-mentee-apply-age-eligible',
  'mentorship-mentee-apply-work-authorized',
  'mentorship-mentee-apply-no-duplicate-profile',
  'mentorship-mentee-apply-compliance',
  'mentorship-mentee-terms',
];

interface ApplyStub {
  submitBodies: unknown[];
}

/**
 * Answers the apply-target read with `targetStatus` (a 200 carries `acceptingApplications`) and
 * the submit with `submitStatus`, recording each submit body.
 */
async function stubApplyFlow(page: Page, options: { targetStatus?: number; acceptingApplications?: boolean; submitStatus?: number }): Promise<ApplyStub> {
  const { targetStatus = 200, acceptingApplications = true, submitStatus = 201 } = options;
  const stub: ApplyStub = { submitBodies: [] };

  await page.route('**/api/mentorship/mentee/has-profile', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hasProfile: true }) })
  );

  await page.route('**/api/mentorship/mentee/profile', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ profile: { aboutMe: 'Test mentee introduction.', skillsHave: ['Go'], skillsWant: ['Code Review'] }, history: [] }),
    })
  );

  await page.route('**/api/mentorship/mentee/apply-target*', (route) => {
    if (targetStatus !== 200) {
      return route.fulfill({ status: targetStatus, contentType: 'application/json', body: JSON.stringify({ error: 'upstream text' }) });
    }
    const body = { programName: PROGRAM_NAME, projectName: 'Test Project', termName: 'Fall 2026', acceptingApplications };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route('**/api/mentorship/mentee/apply', (route) => {
    stub.submitBodies.push(route.request().postDataJSON());
    if (submitStatus === 201) {
      return route.fulfill({ status: 201, body: '' });
    }
    return route.fulfill({ status: submitStatus, contentType: 'application/json', body: JSON.stringify({ error: 'upstream text' }) });
  });

  return stub;
}

async function openApplyPage(page: Page): Promise<void> {
  await openMenteeTab(page, APPLY_URL);
}

async function expectBlocked(page: Page, reason: string): Promise<void> {
  const blocked = page.getByTestId('mentorship-mentee-apply-blocked');
  await expect(blocked).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
  await expect(blocked).toHaveAttribute('data-reason', reason);
  await expect(page.getByTestId('mentorship-mentee-apply-submit')).toHaveCount(0);
}

async function submitApplication(page: Page): Promise<void> {
  await expect(page.getByTestId('mentorship-mentee-apply-title')).toContainText(PROGRAM_NAME, { timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
  for (const id of CONFIRMATION_INPUT_IDS) {
    await page.locator(`#${id}`).check();
  }
  const submit = page.getByTestId('mentorship-mentee-apply-submit').getByRole('button');
  await expect(submit).toBeEnabled();
  await submit.click();
}

test.describe('Mentee apply — blocked states', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('a term that is not accepting applications shows the closed state', async ({ page }) => {
    await stubApplyFlow(page, { acceptingApplications: false });
    await openApplyPage(page);

    await expectBlocked(page, 'closed');
  });

  test('a term the apply target cannot find shows the not-found state', async ({ page }) => {
    await stubApplyFlow(page, { targetStatus: 404 });
    await openApplyPage(page);

    await expectBlocked(page, 'not-found');
  });
});

test.describe('Mentee apply — submit', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('a filed application toasts success and goes to the Overview', async ({ page }) => {
    await stubMenteeApplications(page, 200, JSON.stringify({ data: [], total: 0 }));
    const stub = await stubApplyFlow(page, { submitStatus: 201 });
    await openApplyPage(page);

    await submitApplication(page);

    await expect(page.locator('p-toast .p-toast-message-success')).toContainText(MENTORSHIP_MENTEE_APPLY_SUCCESS_SUMMARY);
    await expect(page).toHaveURL((url) => url.pathname === MENTEE_OVERVIEW_URL);
    expect(stub.submitBodies).toEqual([APPLY_IDS]);
  });

  test('a 409 on submit shows the already-applied state', async ({ page }) => {
    const stub = await stubApplyFlow(page, { submitStatus: 409 });
    await openApplyPage(page);

    await submitApplication(page);

    await expectBlocked(page, 'already-applied');
    expect(stub.submitBodies).toHaveLength(1);
  });

  test('a 422 on submit shows the closed state', async ({ page }) => {
    const stub = await stubApplyFlow(page, { submitStatus: 422 });
    await openApplyPage(page);

    await submitApplication(page);

    await expectBlocked(page, 'closed');
    expect(stub.submitBodies).toHaveLength(1);
  });
});
