// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Meeting details V2 — structural E2E (#3262): the testid contract, `data-kind` / `data-state`
 * values and section presence for each preset in `specs/011-meeting-details-redesign/e2e-presets.md`,
 * and an axe scan (WCAG 2.2 AA) of each (#3260). The anonymous presets are fixme until rollout stage 5. The content twin is `meeting-details.spec.ts`.
 *
 * Not a CI merge gate: `quality-check.yml` has the E2E job commented out (H-08).
 */

import { expect, Page, test } from '@playwright/test';

import {
  axeViolations,
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

interface Preset {
  name: string;
  id: string;
  stubs: () => MeetingStubs;
  /** The invite link's `?password=`, for a restricted meeting the viewer is not invited to. */
  password?: string;
  kind: string;
  state: 'before' | 'live' | 'ended';
  /** Sections that must render, and sections that must not. */
  present: string[];
  absent: string[];
}

const PRESETS: Preset[] = [
  {
    name: '3 · registrant, before, RSVP on',
    id: UPCOMING_ID,
    stubs: () => ({ meeting: buildMeeting('before', { invited: true, is_invite_responses_enabled: true }) }),
    kind: 'rsvp',
    state: 'before',
    present: ['meeting-rsvp-card', 'meeting-time-banner'],
    absent: ['tools-section', 'meeting-header-admin-link'],
  },
  {
    name: '4 · registrant, live',
    id: UPCOMING_ID,
    stubs: () => ({ meeting: buildMeeting('live', { invited: true }) }),
    kind: 'join',
    state: 'live',
    present: ['meeting-action-join-button', 'meeting-time-banner'],
    absent: ['meeting-rsvp-card', 'tools-section'],
  },
  {
    name: '5 · signed-in outsider, restricted, before',
    id: UPCOMING_ID,
    stubs: () => ({ meeting: buildMeeting('before', { restricted: true, password: INVITE_PASSWORD }), password: INVITE_PASSWORD }),
    password: INVITE_PASSWORD,
    kind: 'invitation-required',
    state: 'before',
    present: ['meeting-invitation-required-state'],
    absent: ['meeting-rsvp-card', 'meeting-action-join-button', 'people-section'],
  },
  {
    name: '6 · organizer, ended',
    id: PAST_ID,
    stubs: () => ({ past: { meeting: buildPastMeeting({ organizer: true }), fullAccess: true } }),
    kind: 'tools',
    state: 'ended',
    present: ['tools-section', 'tools-summary', 'people-section', 'people-past-attendance', 'meeting-header-admin-link'],
    absent: ['meeting-rsvp-card', 'meeting-action-join-button'],
  },
  {
    name: '8 · signed-in viewer, ended, no access',
    id: PAST_ID,
    stubs: () => ({ past: { meeting: buildPastMeeting(), fullAccess: false } }),
    kind: 'no-access',
    state: 'ended',
    present: [],
    absent: ['tools-section', 'people-section', 'meeting-header-admin-link'],
  },
];

/**
 * The anonymous presets. The V2 gate gives anonymous viewers V1 until rollout stage 5 (`rollout.md`),
 * so these are fixme until then, like their content twins; the scan is written now so stage 5 turns
 * on structure and axe together.
 */
const ANONYMOUS_PRESETS: Preset[] = [
  {
    name: '1 · visitor, public, before',
    id: UPCOMING_ID,
    stubs: () => ({ meeting: buildMeeting('before') }),
    kind: 'register',
    state: 'before',
    present: ['meeting-action-sign-in', 'meeting-time-banner'],
    absent: ['meeting-rsvp-card', 'tools-section', 'meeting-header-admin-link'],
  },
  {
    name: '2 · visitor, public, live',
    id: UPCOMING_ID,
    stubs: () => ({ meeting: buildMeeting('live') }),
    kind: 'guest-join',
    state: 'live',
    present: ['meeting-guest-join-form'],
    absent: ['meeting-rsvp-card', 'tools-section', 'meeting-header-admin-link'],
  },
  {
    name: '7 · visitor, ended public meeting with public artifacts',
    id: PAST_ID,
    stubs: () => ({
      past: { meeting: buildPastMeeting({ recording_access: 'public', transcript_access: 'public', ai_summary_access: 'public' }), fullAccess: true },
    }),
    kind: 'tools',
    state: 'ended',
    present: ['tools-section', 'tools-summary'],
    // The roster needs a session (E4-04), and a visitor is never the organizer.
    absent: ['people-section', 'meeting-header-admin-link'],
  },
];

/** The non-open privacy shapes, before and live: without the password, each is illegal for a visitor or outsider. */
const ILLEGAL_REACHABILITY: { time: 'before' | 'live'; privacy: string; overrides: Record<string, unknown> }[] = (['before', 'live'] as const).flatMap(
  (time) => [
    { time, privacy: 'public-restricted', overrides: { visibility: 'public', restricted: true } },
    { time, privacy: 'private-open', overrides: { visibility: 'private', restricted: false } },
    { time, privacy: 'private-restricted', overrides: { visibility: 'private', restricted: true } },
  ]
);

async function assertPreset(page: Page, preset: Preset): Promise<void> {
  await expect(page.getByTestId('meeting-action-slot')).toHaveAttribute('data-kind', preset.kind, { timeout: ELEMENT_TIMEOUT });
  await expect(page.getByTestId('meeting-status-pill')).toHaveAttribute('data-state', preset.state);
  // The shell: one h1, the content column and the rail.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByTestId('meeting-content-column')).toBeVisible();
  await expect(page.getByTestId('meeting-rail')).toBeVisible();
  // Each is one section or control: exactly one, so a duplicate fails the contract too.
  for (const testId of preset.present) {
    await expect(page.getByTestId(testId), `${testId} should render once`).toHaveCount(1, { timeout: ELEMENT_TIMEOUT });
  }
  for (const testId of preset.absent) {
    await expect(page.getByTestId(testId), `${testId} should not render`).toHaveCount(0);
  }
  // The Join button is attached while its URL loads too; wait for the ready link so axe scans it.
  if (preset.kind === 'join') {
    await expect(page.getByTestId('meeting-action-join-button')).toHaveAttribute('data-state', 'ready', { timeout: ELEMENT_TIMEOUT });
  }
}

test.describe('Meeting details V2 — structure and accessibility', () => {
  test.beforeEach(() => skipWithoutCredentials(test.skip));

  test.describe('preset contract and axe', () => {
    for (const preset of PRESETS) {
      test(`${preset.name}: contract and axe`, async ({ page }) => {
        await openMeetingSignedIn(page, preset.id, preset.stubs(), { password: preset.password });
        await waitForMeeting(page);

        await assertPreset(page, preset);
        expect(await axeViolations(page)).toEqual([]);
      });
    }
  });

  // SC-002: every illegal combination of the matrix (`state-matrix.md` § Reachability) — an outsider
  // on a non-open meeting, before or live, with no invite-link password — is routed to not-found and
  // never shown a page. The visitor rows are below, fixme until stage 5.
  test.describe('reachability', () => {
    for (const { time, privacy, overrides } of ILLEGAL_REACHABILITY) {
      test(`a signed-in outsider, ${privacy}, ${time}, no password lands on not-found`, async ({ page }) => {
        await openMeetingSignedIn(page, UPCOMING_ID, { meeting: buildMeeting(time, overrides), password: INVITE_PASSWORD }, { expectRedirect: true });

        await expect(page).toHaveURL(/\/meetings\/not-found$/, { timeout: PAGE_LOAD_TIMEOUT });
        await expect(page.getByTestId('meeting-not-found-card')).toBeVisible();
      });
    }
  });

  test.describe('roster and error states', () => {
    test('6 · the past roster row carries its attendance and invitation state', async ({ page }) => {
      await openMeetingSignedIn(page, PAST_ID, { past: { meeting: buildPastMeeting({ organizer: true }), fullAccess: true } });
      await waitForMeeting(page);

      const row = page.getByTestId('participant-row-p1');
      await expect(row).toHaveAttribute('data-attended', 'true', { timeout: ELEMENT_TIMEOUT });
      await expect(row).toHaveAttribute('data-invited', 'true');
      await expect(page.getByTestId('tools-summary-btn')).toHaveAttribute('data-approval', 'approved');
    });

    test('error · the error state is an alert with a retry, and passes axe', async ({ page }) => {
      await openMeetingSignedIn(page, UPCOMING_ID, { lookupStatus: 500 });

      const error = page.getByTestId('meeting-error-state');
      await expect(error).toHaveAttribute('role', 'alert', { timeout: PAGE_LOAD_TIMEOUT });
      await expect(page.getByTestId('meeting-error-retry-button')).toBeVisible();
      await expect(page.getByTestId('meeting-skeleton')).toHaveCount(0);
      expect(await axeViolations(page)).toEqual([]);
    });
  });
});

test.describe('Meeting details V2 — anonymous structure and accessibility', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const preset of ANONYMOUS_PRESETS) {
    test.fixme(`${preset.name}: contract and axe (stage 5)`, async ({ page }) => {
      await openMeetingAnonymously(page, preset.id, preset.stubs(), { password: preset.password });
      await waitForMeeting(page);

      await assertPreset(page, preset);
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  for (const { time, privacy, overrides } of ILLEGAL_REACHABILITY) {
    test.fixme(`SC-002 · a visitor, ${privacy}, ${time}, no password lands on not-found (stage 5)`, async ({ page }) => {
      await openMeetingAnonymously(page, UPCOMING_ID, { meeting: buildMeeting(time, overrides), password: INVITE_PASSWORD }, { expectRedirect: true });

      await expect(page).toHaveURL(/\/meetings\/not-found$/, { timeout: PAGE_LOAD_TIMEOUT });
      await expect(page.getByTestId('meeting-not-found-card')).toBeVisible();
    });
  }
});
