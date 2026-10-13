// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Meeting details V2 — structural E2E (#3262): the testid contract, `data-kind` / `data-state`
 * values and section presence for each preset in `specs/011-meeting-details-redesign/e2e-presets.md`,
 * and an axe scan (WCAG 2.2 AA) of each (#3260). The content twin is `meeting-details.spec.ts`.
 *
 * Not a CI merge gate: `quality-check.yml` has the E2E job commented out (H-08).
 */

import { expect, Page, test } from '@playwright/test';

import {
  axeViolations,
  buildMeeting,
  buildPastMeeting,
  ELEMENT_TIMEOUT,
  MeetingStubs,
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
    stubs: () => ({ meeting: buildMeeting('before', { restricted: true }) }),
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

async function assertPreset(page: Page, preset: Preset): Promise<void> {
  await expect(page.getByTestId('meeting-action-slot')).toHaveAttribute('data-kind', preset.kind, { timeout: ELEMENT_TIMEOUT });
  await expect(page.getByTestId('meeting-status-pill')).toHaveAttribute('data-state', preset.state);
  // The shell: one h1, the content column and the rail.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByTestId('meeting-content-column')).toBeVisible();
  await expect(page.getByTestId('meeting-rail')).toBeVisible();
  for (const testId of preset.present) {
    await expect(page.getByTestId(testId).first(), `${testId} should render`).toBeAttached({ timeout: ELEMENT_TIMEOUT });
  }
  for (const testId of preset.absent) {
    await expect(page.getByTestId(testId), `${testId} should not render`).toHaveCount(0);
  }
}

test.describe('Meeting details V2 — structure and accessibility', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => skipWithoutCredentials(test.skip));

  for (const preset of PRESETS) {
    test(`${preset.name}: contract and axe`, async ({ page }) => {
      await openMeetingSignedIn(page, preset.id, preset.stubs());
      await waitForMeeting(page);

      await assertPreset(page, preset);
      expect(await axeViolations(page)).toEqual([]);
    });
  }

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
