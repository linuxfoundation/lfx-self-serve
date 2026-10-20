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
  INVITE_PASSWORD,
  MeetingStubs,
  openMeetingAnonymously,
  openMeetingSignedIn,
  PAGE_LOAD_TIMEOUT,
  PAST_ID,
  skipWithoutCredentials,
  UPCOMING_ID,
  waitForMeeting,
} from './helpers/meeting-details-v2.helper';

test.describe('Meeting details V2 — signed-in presets', () => {
  test.beforeEach(() => skipWithoutCredentials(test.skip));

  test('3 · a registrant before the meeting answers the RSVP card and sees the answer confirmed', async ({ page }) => {
    await openMeetingSignedIn(page, UPCOMING_ID, { meeting: buildMeeting('before', { invited: true, is_invite_responses_enabled: true }) });
    await waitForMeeting(page);

    await page.getByTestId('meeting-rsvp-card-accepted').click();

    await expect(page.getByTestId('meeting-rsvp-card-confirmation')).toContainText("You're going", { timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('meeting-rsvp-card')).toHaveAttribute('data-my-rsvp', 'accepted');
    await expect(page.getByTestId('meeting-rsvp-card-change')).toBeVisible();
  });

  test('4 · a registrant during the meeting gets a Join link to the meeting', async ({ page }) => {
    await openMeetingSignedIn(page, UPCOMING_ID, { meeting: buildMeeting('live', { invited: true }) });
    await waitForMeeting(page);

    const join = page.getByTestId('meeting-action-join-button');
    await expect(join).toHaveAttribute('data-state', 'ready', { timeout: ELEMENT_TIMEOUT });
    // The join link is the meeting's own URL plus the viewer's name for Zoom (buildJoinUrlWithParams):
    // `uname` is the display name and `un` its UTF-8 base64. A signed-in viewer always has one (name or email).
    const href = new URL((await join.locator('a').getAttribute('href')) ?? '');
    expect(`${href.origin}${href.pathname}`).toBe('https://zoom.example/j/123');
    const uname = href.searchParams.get('uname') ?? '';
    expect(uname).not.toBe('');
    expect(href.searchParams.get('un')).toBe(Buffer.from(uname, 'utf8').toString('base64'));
  });

  test("6 · an ended meeting's organizer opens the transcript and the full summary", async ({ page }) => {
    await openMeetingSignedIn(page, PAST_ID, { past: { meeting: buildPastMeeting({ organizer: true }), fullAccess: true } });
    await waitForMeeting(page);

    await page.getByTestId('tools-transcript-btn').click();
    const transcript = page.getByRole('dialog').filter({ has: page.getByTestId('transcript-modal-container') });
    await expect(transcript.getByTestId('transcript-content')).toContainText('Welcome to the roadmap review.', { timeout: ELEMENT_TIMEOUT });
    await expect(transcript.getByTestId('transcript-content')).toContainText('Ada Lovelace');
    await page.keyboard.press('Escape');
    await expect(transcript).toHaveCount(0);

    await page.getByTestId('tools-summary-btn').click();
    // The stubbed summary has a `## Notes` heading, so the modal renders its structured sections.
    const summary = page.getByRole('dialog').filter({ has: page.getByTestId('summary-structured') });
    const section = summary.getByTestId('summary-section-0');
    await expect(section).toContainText('Notes', { timeout: ELEMENT_TIMEOUT });
    await expect(section).toContainText('Agreed the roadmap');
    await page.keyboard.press('Escape');
    await expect(summary).toHaveCount(0);
  });

  test('5 · a signed-in outsider on a restricted meeting is told an invitation is required', async ({ page }) => {
    // Reachable only through the invite link: without `?password=` the lookup 400s (see the robust spec).
    await openMeetingSignedIn(
      page,
      UPCOMING_ID,
      { meeting: buildMeeting('before', { restricted: true, password: INVITE_PASSWORD }), password: INVITE_PASSWORD },
      { password: INVITE_PASSWORD }
    );
    await waitForMeeting(page);

    await expect(page.getByTestId('meeting-invitation-required-state')).toContainText('This meeting is limited to invited guests.');
  });

  test("6 · an ended meeting's organizer gets its recording, summary, who attended, and the admin page", async ({ page }) => {
    await openMeetingSignedIn(page, PAST_ID, { past: { meeting: buildPastMeeting({ organizer: true }), fullAccess: true } });
    await waitForMeeting(page);

    await expect(page.getByTestId('tools-recording-link').locator('a')).toHaveAttribute('href', 'https://zoom.example/rec/share/x');
    await expect(page.getByTestId('tools-summary-content')).toContainText('Agreed the roadmap');
    await expect(page.getByTestId('participant-row-p1')).toContainText('Ada Lovelace');

    // The link's target, not a click: the admin route's guards resolve the project against the real BFF.
    await expect(page.getByTestId('meeting-header-admin-link').locator('a')).toHaveAttribute('href', `/meetings/${PAST_ID}/details?project=acme-project`);
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

    await expect(page.getByTestId('meeting-action-slot')).toHaveAttribute('data-kind', 'register');
    // A visitor is asked to sign in first; "Register to add yourself…" is the signed-in copy.
    await expect(page.getByTestId('meeting-action-message')).toContainText('Sign in with your LFX account to register.');
    await expect(page.getByTestId('meeting-action-sign-in')).toBeVisible();
  });

  test.fixme('2 · a visitor during a public meeting gets the guest join form (stage 5)', async ({ page }) => {
    await openMeetingAnonymously(page, UPCOMING_ID, { meeting: buildMeeting('live') });
    await waitForMeeting(page);

    const form = page.getByTestId('meeting-guest-join-form');
    await expect(form.getByLabel('Full name')).toBeVisible();
    await expect(form.getByLabel('Email')).toBeVisible();
    await expect(form.getByLabel('Organization')).toBeVisible();
    await expect(page.getByTestId('meeting-guest-join-button')).toContainText('Join as guest');
  });

  test.fixme('SC-003 · an invitee with no session joins a restricted meeting through the guest form (stage 5)', async ({ page }) => {
    const joinUrlCalls: NonNullable<MeetingStubs['joinUrlCalls']> = [];
    await openMeetingAnonymously(
      page,
      UPCOMING_ID,
      { meeting: buildMeeting('live', { restricted: true, password: INVITE_PASSWORD }), password: INVITE_PASSWORD, joinUrlCalls },
      { password: INVITE_PASSWORD }
    );
    await waitForMeeting(page);

    const form = page.getByTestId('meeting-guest-join-form');
    await form.getByLabel('Full name').fill('Grace Hopper');
    await form.getByLabel('Email').fill('grace@invitee.example');

    const join = page.getByTestId('meeting-guest-join-button');
    await expect(join).toHaveAttribute('data-state', 'ready', { timeout: ELEMENT_TIMEOUT });
    const href = new URL((await join.locator('a').getAttribute('href')) ?? '');
    expect(`${href.origin}${href.pathname}`).toBe('https://zoom.example/j/123');
    expect(href.searchParams.get('uname')).toBe('Grace Hopper');
    // The link was fetched for the typed email, with the invite link's password.
    expect(joinUrlCalls.at(-1)).toMatchObject({ body: { email: 'grace@invitee.example' }, password: INVITE_PASSWORD });
  });

  test.fixme('7 · a visitor to an ended public meeting reads its public summary (stage 5)', async ({ page }) => {
    await openMeetingAnonymously(page, PAST_ID, {
      past: { meeting: buildPastMeeting({ recording_access: 'public', transcript_access: 'public', ai_summary_access: 'public' }), fullAccess: true },
    });
    await waitForMeeting(page);

    await expect(page.getByTestId('tools-recording-link').locator('a')).toHaveAttribute('href', 'https://zoom.example/rec/share/x');
    await expect(page.getByTestId('tools-summary-content')).toContainText('Agreed the roadmap');
  });

  test('anonymous viewers get the pre-V2 page until rollout stage 5', async ({ page }) => {
    await openMeetingAnonymously(page, UPCOMING_ID, { meeting: buildMeeting('before') });

    await expect(page.getByTestId('meeting-details-gate-v1')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('meeting-details-gate-v2')).toHaveCount(0);
  });
});
