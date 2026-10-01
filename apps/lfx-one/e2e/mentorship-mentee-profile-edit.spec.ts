// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee Profile - persist edits (linuxfoundation/lfx-mentorship#188).
 *
 * Stubs `/api/mentorship/mentee/profile` via `page.route`, branching on the request method: GET serves
 * the synthetic profile and PATCH answers the save. That lets each test prove what the browser sent,
 * that the profile is shown in place without a second read, and that a failed save keeps the drawer open.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import {
  MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL,
  MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_PROFILE_SAVE_SUCCESS_SUMMARY,
} from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTEE_PROFILE_LOAD_TIMEOUT, openMenteeProfile } from './helpers/mentee-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

const STORED_PROFILE = {
  aboutMe: '<p>Test User 1 introduction.</p>',
  skillsHave: ['Python', 'Go'],
  skillsWant: ['Observability'],
  additionalNotes: 'Comfortable working asynchronously.',
  resumeFileName: null,
  resumeUrl: null,
};

interface ProfileStub {
  getCalls: number;
  patchBodies: unknown[];
}

/** Serves the stored profile on GET and answers every PATCH with `patchStatus` (200 echoes the profile with the new notes). */
async function stubProfile(page: Page, patchStatus: number): Promise<ProfileStub> {
  const stub: ProfileStub = { getCalls: 0, patchBodies: [] };

  await page.route('**/api/mentorship/mentee/profile', (route) => {
    const request = route.request();

    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as { skillSet?: { additionalNotes?: string } };
      stub.patchBodies.push(body);
      if (patchStatus !== 200) {
        return route.fulfill({ status: patchStatus, contentType: 'application/json', body: JSON.stringify({ error: 'upstream text', code: 'CONFLICT' }) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: { ...STORED_PROFILE, additionalNotes: body.skillSet?.additionalNotes ?? STORED_PROFILE.additionalNotes } }),
      });
    }

    stub.getCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: STORED_PROFILE, history: [] }) });
  });

  return stub;
}

async function openEditDrawer(page: Page): Promise<void> {
  await openMenteeProfile(page);
  await expect(page.getByTestId('mentorship-mentee-profile-details')).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
  await page.getByTestId('mentorship-mentee-profile-details-edit').click();
  await expect(page.getByTestId('mentee-profile-edit-drawer-body')).toBeVisible();
}

test.describe('Mentee Profile - persist edits', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('editing additional notes sends only the skill set and shows the saved notes without re-reading the profile', async ({ page }) => {
    const stub = await stubProfile(page, 200);
    await openEditDrawer(page);

    await page.getByLabel(MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL).fill('Available on weekday evenings.');
    await page.getByTestId('mentee-profile-edit-drawer-save').click();

    await expect(page.getByTestId('mentee-profile-edit-drawer-body')).toBeHidden();
    await expect(page.getByText(MENTORSHIP_MENTEE_PROFILE_SAVE_SUCCESS_SUMMARY)).toBeVisible();
    await expect(page.getByTestId('mentorship-mentee-profile-details-notes-text')).toHaveText('Available on weekday evenings.');

    expect(stub.patchBodies).toEqual([
      { skillSet: { skillsHave: ['Python', 'Go'], skillsWant: ['Observability'], additionalNotes: 'Available on weekday evenings.' } },
    ]);
    expect(stub.getCalls).toBe(1);
  });

  test('a 409 keeps the drawer open with the error shown and the typed notes', async ({ page }) => {
    const stub = await stubProfile(page, 409);
    await openEditDrawer(page);

    await page.getByLabel(MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL).fill('Available on weekday evenings.');
    await page.getByTestId('mentee-profile-edit-drawer-save').click();

    await expect(page.getByTestId('mentee-profile-edit-drawer-error')).toHaveText(MENTORSHIP_MENTEE_PROFILE_SAVE_ERROR_MESSAGES[409]);
    await expect(page.getByTestId('mentee-profile-edit-drawer-body')).toBeVisible();
    await expect(page.getByLabel(MENTORSHIP_MENTEE_ADDITIONAL_NOTES_LABEL)).toHaveValue('Available on weekday evenings.');
    expect(stub.patchBodies).toHaveLength(1);
  });

  test('saving without a change closes the drawer and sends no request', async ({ page }) => {
    const stub = await stubProfile(page, 200);
    await openEditDrawer(page);

    await page.getByTestId('mentee-profile-edit-drawer-save').click();

    await expect(page.getByTestId('mentee-profile-edit-drawer-body')).toBeHidden();
    expect(stub.patchBodies).toEqual([]);
  });
});
