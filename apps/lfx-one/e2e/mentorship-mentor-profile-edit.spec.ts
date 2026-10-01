// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor Profile - persist edits (linuxfoundation/lfx-mentorship#210).
 *
 * Stubs `/api/mentorship/mentor/profile` via `page.route`, branching on the request method: GET serves
 * the synthetic profile and PATCH answers the save. That lets each test prove what the browser sent,
 * that the profile is shown in place without a second read, and that a failed save keeps the drawer
 * open. The drawer's program reads are stubbed too, so nothing reaches upstream for the signed-in user.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_MESSAGES, MENTORSHIP_MENTOR_PROFILE_SAVE_SUCCESS_SUMMARY } from '@lfx-one/shared/constants';
import { MentorshipMentorProfileDetails, MentorshipMentorProfileUpdateRequest } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const MENTOR_PROFILE_URL = '/mentorship/mentor/profile';

const STORED_PROFILE: MentorshipMentorProfileDetails = {
  aboutMe: '<p>Test User 1 mentor introduction.</p>',
  skills: ['Kubernetes'],
};

interface ProfileStub {
  getCalls: number;
  patchBodies: MentorshipMentorProfileUpdateRequest[];
}

/** Serves the stored profile on GET and answers every PATCH with `patchStatus` (200 echoes the profile with the sent fields). */
async function stubProfile(page: Page, patchStatus: number): Promise<ProfileStub> {
  const stub: ProfileStub = { getCalls: 0, patchBodies: [] };

  await page.route('**/api/mentorship/mentor/profile', (route) => {
    const request = route.request();

    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as MentorshipMentorProfileUpdateRequest;
      stub.patchBodies.push(body);
      if (patchStatus !== 200) {
        return route.fulfill({ status: patchStatus, contentType: 'application/json', body: JSON.stringify({ error: 'upstream text', code: 'CONFLICT' }) });
      }
      const profile: MentorshipMentorProfileDetails = {
        ...STORED_PROFILE,
        aboutMe: body.introduction ?? STORED_PROFILE.aboutMe,
        skills: body.skills ?? STORED_PROFILE.skills,
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile }) });
    }

    stub.getCalls += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: STORED_PROFILE, history: [] }) });
  });

  // The drawer reads the mentor's requests and the open programs on open; answer both with nothing.
  await page.route('**/api/mentorship/mentor/requests', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], invitedProgramIds: [] }) })
  );
  await page.route('**/api/mentorship/mentor/open-programs**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], total: 0 }) })
  );

  return stub;
}

async function openEditDrawer(page: Page): Promise<void> {
  await openMentorPage(page, MENTOR_PROFILE_URL);
  await page.getByTestId('mentorship-mentor-profile-details-edit').getByRole('button').click();
  await expect(page.getByTestId('mentor-profile-edit-drawer-body')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

async function addSkill(page: Page, skill: string): Promise<void> {
  await page.locator('[data-test="mentor-profile-edit-skill"]').click();
  await page.getByRole('option', { name: skill, exact: true }).click();
  await page.getByTestId('mentor-profile-edit-add-skill').click();
  await expect(page.getByTestId('mentor-profile-edit-skill-list')).toContainText(skill);
}

test.describe('Mentor Profile - persist edits', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('adding a skill sends only the skills and shows them without re-reading the profile', async ({ page }) => {
    const stub = await stubProfile(page, 200);
    await openEditDrawer(page);

    await addSkill(page, 'Angular');
    await page.getByTestId('mentor-profile-edit-drawer-save').click();

    await expect(page.getByTestId('mentor-profile-edit-drawer-body')).toBeHidden();
    await expect(page.getByText(MENTORSHIP_MENTOR_PROFILE_SAVE_SUCCESS_SUMMARY)).toBeVisible();
    await expect(page.getByTestId('mentorship-mentor-profile-details-skills-list')).toContainText('Angular');

    expect(stub.patchBodies).toEqual([{ skills: ['Kubernetes', 'Angular'] }]);
    expect(stub.getCalls).toBe(1);
  });

  test('removing the last skill shows the field error and sends nothing', async ({ page }) => {
    const stub = await stubProfile(page, 200);
    await openEditDrawer(page);

    await page.getByTestId('mentor-profile-edit-remove-skill-Kubernetes').click();
    await page.getByTestId('mentor-profile-edit-drawer-save').click();

    await expect(page.getByTestId('mentor-profile-edit-skill-error')).toBeVisible();
    await expect(page.getByTestId('mentor-profile-edit-drawer-body')).toBeVisible();
    expect(stub.patchBodies).toEqual([]);
  });

  test('a 409 keeps the drawer open with the error shown and the added skill', async ({ page }) => {
    const stub = await stubProfile(page, 409);
    await openEditDrawer(page);

    await addSkill(page, 'Angular');
    await page.getByTestId('mentor-profile-edit-drawer-save').click();

    await expect(page.getByTestId('mentor-profile-edit-drawer-error')).toHaveText(MENTORSHIP_MENTOR_PROFILE_SAVE_ERROR_MESSAGES[409]);
    await expect(page.getByTestId('mentor-profile-edit-drawer-body')).toBeVisible();
    await expect(page.getByTestId('mentor-profile-edit-skill-list')).toContainText('Angular');
    expect(stub.patchBodies).toHaveLength(1);
  });

  test('saving without a change closes the drawer and sends no request', async ({ page }) => {
    const stub = await stubProfile(page, 200);
    await openEditDrawer(page);

    await page.getByTestId('mentor-profile-edit-drawer-save').click();

    await expect(page.getByTestId('mentor-profile-edit-drawer-body')).toBeHidden();
    expect(stub.patchBodies).toEqual([]);
  });
});
