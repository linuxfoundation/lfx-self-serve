// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Meeting details V2 — content E2E (#3262): copy, call-to-action labels, links and route transitions
 * for the presets in `specs/011-meeting-details-redesign/e2e-presets.md`. The structural twin, with
 * the testid / `data-*` contract and the axe scan, is `meeting-details-robust.spec.ts`.
 *
 * Prerequisites: the dev server at the Playwright baseURL, and TEST_USERNAME / TEST_PASSWORD for the
 * signed-in presets (global-setup.ts). The anonymous presets need no session.
 *
 * Not a CI merge gate: `quality-check.yml` has the E2E job commented out (H-08).
 */

import { expect, test } from '@playwright/test';

import {
  buildMeeting,
  buildPastMeeting,
  ELEMENT_TIMEOUT,
  openMeetingAnonymously,
  openMeetingSignedIn,
  PAGE_LOAD_TIMEOUT,
  PAST_ID,
  skipWithoutCredentials,
  UPCOMING_ID,
  waitForMeeting,
} from './helpers/meeting-details-v2.helper';

test.describe('Meeting details V2 — signed-in presets', () => {
  // The boot check reads the app shell's sidebar, which is hidden below lg (as in meetings-v2-flag-gate.spec.ts).
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials(test.skip));

  test('3 · a registrant before the meeting answers the RSVP card and sees the answer confirmed', async ({ page }) => {
    await openMeetingSignedIn(page, UPCOMING_ID, { meeting: buildMeeting('before', { invited: true, is_invite_responses_enabled: true }) });
    await waitForMeeting(page);

    await page.getByTestId('meeting-rsvp-card-accepted').click();

    await expect(page.getByTestId('meeting-rsvp-card-confirmation')).toContainText("Yes, I'll attend", { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('meeting-rsvp-card-change')).toBeVisible();
  });

  test('4 · a registrant during the meeting gets a Join link to the meeting', async ({ page }) => {
    await openMeetingSignedIn(page, UPCOMING_ID, { meeting: buildMeeting('live', { invited: true }) });
    await waitForMeeting(page);

    const join = page.getByTestId('meeting-action-join-button');
    await expect(join).toHaveAttribute('data-state', 'ready', { timeout: ELEMENT_TIMEOUT });
    await expect(join.locator('a')).toHaveAttribute('href', 'https://zoom.example/j/123');
  });

  test('5 · a signed-in outsider on a restricted meeting is told an invitation is required', async ({ page }) => {
    await openMeetingSignedIn(page, UPCOMING_ID, { meeting: buildMeeting('before', { restricted: true }) });
    await waitForMeeting(page);

    await expect(page.getByTestId('meeting-invitation-required-state')).toContainText('This meeting is limited to invited guests.');
  });

  test("6 · an ended meeting's organizer gets its recording, summary, who attended, and the admin page", async ({ page }) => {
    await openMeetingSignedIn(page, PAST_ID, { past: { meeting: buildPastMeeting({ organizer: true }), fullAccess: true } });
    await waitForMeeting(page);

    await expect(page.getByTestId('tools-recording-link').locator('a')).toHaveAttribute('href', 'https://zoom.example/rec/share/x');
    await expect(page.getByTestId('tools-summary-content')).toContainText('Agreed the roadmap');
    await expect(page.getByTestId('participant-row-p1')).toContainText('Ada Lovelace');

    await page.getByTestId('meeting-header-admin-link').locator('a').click();
    await expect(page).toHaveURL(new RegExp(`/meetings/${PAST_ID}/details\\?project=acme-project$`), { timeout: PAGE_LOAD_TIMEOUT });
  });

  test('8 · a signed-in viewer without access to an ended meeting is told its details are private', async ({ page }) => {
    await openMeetingSignedIn(page, PAST_ID, { past: { meeting: buildPastMeeting(), fullAccess: false } });
    await waitForMeeting(page);

    await expect(page.getByTestId('meeting-action-slot')).toContainText("This meeting's details are private");
    await expect(page.getByTestId('tools-section')).toHaveCount(0);
  });

  test('error · a failed lookup offers Try again, and says so when it fails again', async ({ page }) => {
    await openMeetingSignedIn(page, UPCOMING_ID, { lookupStatus: 500 });

    await expect(page.getByTestId('meeting-error-state')).toContainText('Something went wrong loading this meeting.', { timeout: PAGE_LOAD_TIMEOUT });
    await page.getByTestId('meeting-error-retry-button').locator('button').click();
    await expect(page.getByTestId('meeting-error-state')).toContainText("We still couldn't load this meeting.", { timeout: PAGE_LOAD_TIMEOUT });
  });
});

/**
 * The anonymous presets (1, 2, 7). The V2 gate gives every anonymous viewer V1 until rollout stage 5
 * (`rollout.md`), which is to be validated by these presets: they are written now and marked fixme
 * until that stage lands. Today's behaviour is pinned by the last test.
 */
test.describe('Meeting details V2 — anonymous presets', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.fixme('1 · a visitor before a public meeting is offered Register (stage 5)', async ({ page }) => {
    await openMeetingAnonymously(page, UPCOMING_ID, { meeting: buildMeeting('before') });
    await waitForMeeting(page);

    await expect(page.getByTestId('meeting-action-message')).toContainText('Register to add yourself to the guest list.');
    await expect(page.getByTestId('meeting-action-sign-in')).toBeVisible();
  });

  test.fixme('2 · a visitor during a public meeting gets the guest join form (stage 5)', async ({ page }) => {
    await openMeetingAnonymously(page, UPCOMING_ID, { meeting: buildMeeting('live') });
    await waitForMeeting(page);

    await expect(page.getByTestId('meeting-guest-join-form')).toBeVisible();
  });

  test.fixme('7 · a visitor to an ended public meeting reads its public summary (stage 5)', async ({ page }) => {
    await openMeetingAnonymously(page, PAST_ID, { past: { meeting: buildPastMeeting(), fullAccess: true } });
    await waitForMeeting(page);

    await expect(page.getByTestId('tools-section')).toBeVisible();
  });

  test('anonymous viewers get the pre-V2 page until rollout stage 5', async ({ page }) => {
    await openMeetingAnonymously(page, UPCOMING_ID, { meeting: buildMeeting('before') });

    await expect(page.getByTestId('meeting-details-gate-v1')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('meeting-details-gate-v2')).toHaveCount(0);
  });
});
