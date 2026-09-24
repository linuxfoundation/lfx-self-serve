// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The resolvers pull meeting.utils, which transitively imports @angular/common/http (HttpParams) —
// its declarations need the Angular JIT compiler when loaded outside an Angular bootstrap (as
// under Vitest). Importing the compiler first provides that facade.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { MeetingVisibility } from '../enums';
import type { ActionSlotInput, ActionSlotKind, Meeting, MeetingOccurrence, MeetingPrivacyState, MeetingTimeState, MeetingViewerRole } from '../interfaces';
import { resolveActionSlot, resolvePrivacy, resolveTimeState, resolveViewerRole, resolveVisibleSections } from './meeting-view-model.utils';

const START = '2026-06-01T10:00:00.000Z';

/** Minimal meeting: one hour, default 10-minute early join, no occurrences. */
function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    uid: 'm-1',
    start_time: START,
    duration: 60,
    ...overrides,
  } as Meeting;
}

function buildOccurrence(overrides: Partial<MeetingOccurrence> = {}): MeetingOccurrence {
  return {
    occurrence_id: '1780308000',
    start_time: START,
    duration: 60,
    ...overrides,
  } as MeetingOccurrence;
}

function at(iso: string): Date {
  return new Date(iso);
}

const PUBLIC_OPEN = resolvePrivacy(MeetingVisibility.PUBLIC, false);
const PUBLIC_RESTRICTED = resolvePrivacy(MeetingVisibility.PUBLIC, true);
const PRIVATE_OPEN = resolvePrivacy(MeetingVisibility.PRIVATE, false);
const PRIVATE_RESTRICTED = resolvePrivacy(MeetingVisibility.PRIVATE, true);
const ALL_PRIVACY = [PUBLIC_OPEN, PUBLIC_RESTRICTED, PRIVATE_OPEN, PRIVATE_RESTRICTED];

const TIME_STATES: MeetingTimeState[] = ['before', 'live', 'ended'];
const VIEWER_ROLES: MeetingViewerRole[] = ['visitor', 'outsider', 'registrant', 'organizer'];
const ALL_KINDS: ActionSlotKind[] = ['join', 'rsvp', 'register', 'invitation-required', 'guest-join', 'tools', 'no-access', 'rsvp-unavailable', 'none'];

function buildSlotInput(overrides: Partial<ActionSlotInput> = {}): ActionSlotInput {
  return {
    fullAccess: false,
    inviteResponsesEnabled: true,
    privacy: PUBLIC_OPEN,
    timeState: 'before',
    viewerRole: 'registrant',
    ...overrides,
  };
}

describe('resolveTimeState', () => {
  it('reports "before" earlier than the early-join window', () => {
    expect(resolveTimeState(buildMeeting(), null, at('2026-06-01T09:30:00.000Z'))).toBe('before');
  });

  it('reports "live" once the early-join window opens, ten minutes ahead of the start', () => {
    expect(resolveTimeState(buildMeeting(), null, at('2026-06-01T09:50:00.000Z'))).toBe('live');
  });

  it('still reports "before" one minute outside the early-join window', () => {
    expect(resolveTimeState(buildMeeting(), null, at('2026-06-01T09:49:00.000Z'))).toBe('before');
  });

  it('honours a meeting-specific early_join_time_minutes', () => {
    const meeting = buildMeeting({ early_join_time_minutes: 30 });
    expect(resolveTimeState(meeting, null, at('2026-06-01T09:40:00.000Z'))).toBe('live');
  });

  it('stays "live" through the 40-minute grace period after the scheduled end', () => {
    // Scheduled end 11:00, grace period runs to 11:40.
    expect(resolveTimeState(buildMeeting(), null, at('2026-06-01T11:39:00.000Z'))).toBe('live');
  });

  it('flips to "ended" once the grace period elapses', () => {
    expect(resolveTimeState(buildMeeting(), null, at('2026-06-01T11:41:00.000Z'))).toBe('ended');
  });

  it('prefers the occurrence timing over the meeting when one is supplied', () => {
    const occurrence = buildOccurrence({ start_time: '2026-06-08T10:00:00.000Z' });
    // Past the parent meeting's own grace period, but a week before the occurrence.
    expect(resolveTimeState(buildMeeting(), occurrence, at('2026-06-01T23:00:00.000Z'))).toBe('before');
  });

  it('returns "before" for a meeting with no start time rather than throwing', () => {
    const meeting = buildMeeting();
    delete (meeting as Partial<Meeting>).start_time;
    expect(resolveTimeState(meeting, null, at(START))).toBe('before');
  });

  // Pins the documented contract rather than endorsing it: a recurring series whose first
  // occurrence is long past reads as 'ended' when no occurrence is supplied, because both
  // delegates fall back to the series' own start_time. The caller owns occurrence selection, so
  // the V2 page must pass the occurrence it is showing — this test is what fails if a future
  // change starts resolving the occurrence internally and silently alters that contract.
  it('describes the series, not the next occurrence, when no occurrence is supplied', () => {
    const meeting = buildMeeting();
    const nextWeek = buildOccurrence({ start_time: '2026-06-08T10:00:00.000Z' });
    const duringTheFirstWeek = at('2026-06-05T10:00:00.000Z');

    expect(resolveTimeState(meeting, null, duringTheFirstWeek)).toBe('ended');
    expect(resolveTimeState(meeting, nextWeek, duringTheFirstWeek)).toBe('before');
    // And the same for the live window, which is resolved by a second delegate: half an hour into
    // the later occurrence is 'live' only because the occurrence — not the series — is consulted.
    expect(resolveTimeState(meeting, nextWeek, at('2026-06-08T10:30:00.000Z'))).toBe('live');
  });
});

describe('resolveViewerRole', () => {
  it('calls an unauthenticated viewer a visitor', () => {
    expect(resolveViewerRole({ authenticated: false, invited: false, organizer: false })).toBe('visitor');
  });

  it('ignores invited/organizer flags when unauthenticated', () => {
    expect(resolveViewerRole({ authenticated: false, invited: true, organizer: true })).toBe('visitor');
  });

  it('ranks organizer above registrant when both flags are set', () => {
    expect(resolveViewerRole({ authenticated: true, invited: true, organizer: true })).toBe('organizer');
  });

  it('calls an invited signed-in viewer a registrant', () => {
    expect(resolveViewerRole({ authenticated: true, invited: true, organizer: false })).toBe('registrant');
  });

  it('calls a signed-in viewer with neither flag an outsider', () => {
    expect(resolveViewerRole({ authenticated: true, invited: false, organizer: false })).toBe('outsider');
  });
});

describe('resolvePrivacy', () => {
  it('reuses the shared label and icon helpers for private + restricted', () => {
    const privacy = resolvePrivacy(MeetingVisibility.PRIVATE, true);
    expect(privacy.label).toBe('Private (Restricted)');
    expect(privacy.icon).toBe('fa-light fa-lock');
  });

  it('marks a public unrestricted meeting open to the public', () => {
    expect(resolvePrivacy(MeetingVisibility.PUBLIC, false).openToPublic).toBe(true);
  });

  it('does not treat a public but restricted meeting as open to the public', () => {
    expect(resolvePrivacy(MeetingVisibility.PUBLIC, true).openToPublic).toBe(false);
  });

  it('does not treat a private unrestricted meeting as open to the public', () => {
    expect(resolvePrivacy(MeetingVisibility.PRIVATE, false).openToPublic).toBe(false);
  });

  it('normalizes a null/undefined restricted flag to false', () => {
    expect(resolvePrivacy(MeetingVisibility.PUBLIC, null).restricted).toBe(false);
    expect(resolvePrivacy(MeetingVisibility.PUBLIC, undefined).restricted).toBe(false);
  });

  // The chip and the rail read the same object, so an unknown visibility has to resolve to one
  // reading. Closed is the safe one: the alternative renders "Public" under a globe while the rail
  // tells the same viewer they need an invitation.
  it('reads an absent visibility as private across every field, not just openToPublic', () => {
    for (const absent of [null, undefined]) {
      const privacy = resolvePrivacy(absent, false);
      expect(privacy.visibility).toBe(MeetingVisibility.PRIVATE);
      expect(privacy.openToPublic).toBe(false);
      expect(privacy.label).toBe('Private');
      expect(privacy.icon).toBe('fa-light fa-shield');
    }
  });
});

describe('resolveActionSlot', () => {
  // The full matrix, one row per (time, viewer, privacy) tuple and one expected kind per
  // (fullAccess, inviteResponsesEnabled) pair, in the column order of ACCESS_RSVP_COLUMNS. Every
  // cell is written out rather than derived, so changing any single decision in the resolver fails
  // exactly the rows it touches. It is the runtime half of specs/010-meeting-details-redesign/state-matrix.md.
  const ACCESS_RSVP_COLUMNS: { fullAccess: boolean; inviteResponsesEnabled: boolean }[] = [
    { fullAccess: true, inviteResponsesEnabled: true },
    { fullAccess: true, inviteResponsesEnabled: false },
    { fullAccess: false, inviteResponsesEnabled: true },
    { fullAccess: false, inviteResponsesEnabled: false },
  ];

  const MATRIX: [MeetingTimeState, MeetingViewerRole, MeetingPrivacyState, ActionSlotKind[]][] = [
    ['before', 'visitor', PUBLIC_OPEN, ['register', 'register', 'register', 'register']],
    ['before', 'visitor', PUBLIC_RESTRICTED, ['none', 'none', 'none', 'none']],
    ['before', 'visitor', PRIVATE_OPEN, ['none', 'none', 'none', 'none']],
    ['before', 'visitor', PRIVATE_RESTRICTED, ['none', 'none', 'none', 'none']],
    ['before', 'outsider', PUBLIC_OPEN, ['register', 'register', 'register', 'register']],
    ['before', 'outsider', PUBLIC_RESTRICTED, ['invitation-required', 'invitation-required', 'invitation-required', 'invitation-required']],
    ['before', 'outsider', PRIVATE_OPEN, ['none', 'none', 'none', 'none']],
    ['before', 'outsider', PRIVATE_RESTRICTED, ['invitation-required', 'invitation-required', 'invitation-required', 'invitation-required']],
    ['before', 'registrant', PUBLIC_OPEN, ['rsvp', 'rsvp-unavailable', 'rsvp', 'rsvp-unavailable']],
    ['before', 'registrant', PUBLIC_RESTRICTED, ['rsvp', 'rsvp-unavailable', 'rsvp', 'rsvp-unavailable']],
    ['before', 'registrant', PRIVATE_OPEN, ['rsvp', 'rsvp-unavailable', 'rsvp', 'rsvp-unavailable']],
    ['before', 'registrant', PRIVATE_RESTRICTED, ['rsvp', 'rsvp-unavailable', 'rsvp', 'rsvp-unavailable']],
    ['before', 'organizer', PUBLIC_OPEN, ['rsvp', 'none', 'rsvp', 'none']],
    ['before', 'organizer', PUBLIC_RESTRICTED, ['rsvp', 'none', 'rsvp', 'none']],
    ['before', 'organizer', PRIVATE_OPEN, ['rsvp', 'none', 'rsvp', 'none']],
    ['before', 'organizer', PRIVATE_RESTRICTED, ['rsvp', 'none', 'rsvp', 'none']],
    ['live', 'visitor', PUBLIC_OPEN, ['guest-join', 'guest-join', 'guest-join', 'guest-join']],
    ['live', 'visitor', PUBLIC_RESTRICTED, ['guest-join', 'guest-join', 'guest-join', 'guest-join']],
    ['live', 'visitor', PRIVATE_OPEN, ['guest-join', 'guest-join', 'guest-join', 'guest-join']],
    ['live', 'visitor', PRIVATE_RESTRICTED, ['guest-join', 'guest-join', 'guest-join', 'guest-join']],
    ['live', 'outsider', PUBLIC_OPEN, ['join', 'join', 'join', 'join']],
    ['live', 'outsider', PUBLIC_RESTRICTED, ['invitation-required', 'invitation-required', 'invitation-required', 'invitation-required']],
    ['live', 'outsider', PRIVATE_OPEN, ['join', 'join', 'join', 'join']],
    ['live', 'outsider', PRIVATE_RESTRICTED, ['invitation-required', 'invitation-required', 'invitation-required', 'invitation-required']],
    ['live', 'registrant', PUBLIC_OPEN, ['join', 'join', 'join', 'join']],
    ['live', 'registrant', PUBLIC_RESTRICTED, ['join', 'join', 'join', 'join']],
    ['live', 'registrant', PRIVATE_OPEN, ['join', 'join', 'join', 'join']],
    ['live', 'registrant', PRIVATE_RESTRICTED, ['join', 'join', 'join', 'join']],
    ['live', 'organizer', PUBLIC_OPEN, ['join', 'join', 'join', 'join']],
    ['live', 'organizer', PUBLIC_RESTRICTED, ['join', 'join', 'join', 'join']],
    ['live', 'organizer', PRIVATE_OPEN, ['join', 'join', 'join', 'join']],
    ['live', 'organizer', PRIVATE_RESTRICTED, ['join', 'join', 'join', 'join']],
    ['ended', 'visitor', PUBLIC_OPEN, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'visitor', PUBLIC_RESTRICTED, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'visitor', PRIVATE_OPEN, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'visitor', PRIVATE_RESTRICTED, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'outsider', PUBLIC_OPEN, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'outsider', PUBLIC_RESTRICTED, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'outsider', PRIVATE_OPEN, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'outsider', PRIVATE_RESTRICTED, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'registrant', PUBLIC_OPEN, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'registrant', PUBLIC_RESTRICTED, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'registrant', PRIVATE_OPEN, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'registrant', PRIVATE_RESTRICTED, ['tools', 'tools', 'no-access', 'no-access']],
    ['ended', 'organizer', PUBLIC_OPEN, ['tools', 'tools', 'tools', 'tools']],
    ['ended', 'organizer', PUBLIC_RESTRICTED, ['tools', 'tools', 'tools', 'tools']],
    ['ended', 'organizer', PRIVATE_OPEN, ['tools', 'tools', 'tools', 'tools']],
    ['ended', 'organizer', PRIVATE_RESTRICTED, ['tools', 'tools', 'tools', 'tools']],
  ];

  it('lists every (time, viewer, privacy) tuple exactly once', () => {
    const keys = MATRIX.map(([timeState, viewerRole, privacy]) => `${timeState}|${viewerRole}|${privacy.visibility}|${privacy.restricted}`);
    expect(new Set(keys).size).toBe(TIME_STATES.length * VIEWER_ROLES.length * ALL_PRIVACY.length);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('reaches every ActionSlotKind somewhere in the matrix', () => {
    expect(new Set(MATRIX.flatMap(([, , , expected]) => expected))).toEqual(new Set(ALL_KINDS));
  });

  for (const [timeState, viewerRole, privacy, expected] of MATRIX) {
    it(`resolves ${timeState} / ${viewerRole} / ${privacy.label}`, () => {
      const actual = ACCESS_RSVP_COLUMNS.map((column) => resolveActionSlot({ timeState, viewerRole, privacy, ...column }));
      expect(actual).toEqual(expected);
    });
  }

  it('never returns "rsvp" while invite responses are disabled', () => {
    for (const timeState of TIME_STATES) {
      for (const viewerRole of VIEWER_ROLES) {
        for (const privacy of ALL_PRIVACY) {
          for (const fullAccess of [true, false]) {
            const kind = resolveActionSlot({ timeState, viewerRole, privacy, fullAccess, inviteResponsesEnabled: false });
            expect(kind).not.toBe('rsvp');
          }
        }
      }
    }
  });

  // One row per non-obvious cell. The obvious cells are covered by the totality sweep above; these
  // pin the decisions that a reader would otherwise have to infer from the template.
  const CASES: { name: string; input: Partial<ActionSlotInput>; expected: ActionSlotKind }[] = [
    { name: 'registrant before an RSVP-tracking meeting gets the RSVP card', input: { timeState: 'before', viewerRole: 'registrant' }, expected: 'rsvp' },
    {
      name: 'registrant before a pre-2024 meeting is told RSVP is unavailable, not shown an empty rail',
      input: { timeState: 'before', viewerRole: 'registrant', inviteResponsesEnabled: false },
      expected: 'rsvp-unavailable',
    },
    {
      name: 'organizer before a pre-2024 meeting has nothing to offer rather than an unavailable RSVP',
      input: { timeState: 'before', viewerRole: 'organizer', inviteResponsesEnabled: false },
      expected: 'none',
    },
    {
      name: 'signed-in outsider on a restricted meeting is told an invitation is required',
      input: { timeState: 'before', viewerRole: 'outsider', privacy: PUBLIC_RESTRICTED },
      expected: 'invitation-required',
    },
    {
      name: 'signed-in outsider on a private unrestricted meeting needs no invitation and waits for the window',
      input: { timeState: 'before', viewerRole: 'outsider', privacy: PRIVATE_OPEN },
      expected: 'none',
    },
    {
      name: 'signed-in outsider on a private restricted meeting is told an invitation is required',
      input: { timeState: 'before', viewerRole: 'outsider', privacy: PRIVATE_RESTRICTED },
      expected: 'invitation-required',
    },
    { name: 'signed-in outsider on an open meeting can self-register', input: { timeState: 'before', viewerRole: 'outsider' }, expected: 'register' },
    {
      name: 'signed-in outsider joins a live open meeting directly, as V1 allows, without registering first',
      input: { timeState: 'live', viewerRole: 'outsider' },
      expected: 'join',
    },
    {
      name: 'signed-in outsider holding the link joins a live private unrestricted meeting',
      input: { timeState: 'live', viewerRole: 'outsider', privacy: PRIVATE_OPEN },
      expected: 'join',
    },
    {
      name: 'signed-in outsider on a live restricted meeting still gets the invitation explanation',
      input: { timeState: 'live', viewerRole: 'outsider', privacy: PUBLIC_RESTRICTED },
      expected: 'invitation-required',
    },
    { name: 'visitor before an open meeting gets the register CTA', input: { timeState: 'before', viewerRole: 'visitor' }, expected: 'register' },
    {
      name: 'visitor before a restricted meeting gets nothing, because registration would be rejected',
      input: { timeState: 'before', viewerRole: 'visitor', privacy: PUBLIC_RESTRICTED },
      expected: 'none',
    },
    { name: 'visitor inside an open meeting join window gets the guest form', input: { timeState: 'live', viewerRole: 'visitor' }, expected: 'guest-join' },
    {
      name: 'anonymous invitee on a live restricted meeting gets the guest form; the server matches their email',
      input: { timeState: 'live', viewerRole: 'visitor', privacy: PUBLIC_RESTRICTED },
      expected: 'guest-join',
    },
    {
      name: 'visitor holding the link gets the guest form on a live private unrestricted meeting',
      input: { timeState: 'live', viewerRole: 'visitor', privacy: PRIVATE_OPEN },
      expected: 'guest-join',
    },
    { name: 'registrant inside the join window joins', input: { timeState: 'live', viewerRole: 'registrant' }, expected: 'join' },
    {
      name: 'registrant joins a live meeting even without invite responses',
      input: { timeState: 'live', viewerRole: 'registrant', inviteResponsesEnabled: false },
      expected: 'join',
    },
    { name: 'organizer keeps post-meeting tools without full access', input: { timeState: 'ended', viewerRole: 'organizer' }, expected: 'tools' },
    {
      name: 'registrant with past-meeting access gets tools',
      input: { timeState: 'ended', viewerRole: 'registrant', fullAccess: true },
      expected: 'tools',
    },
    {
      name: 'registrant without past-meeting access is told so rather than shown an empty page',
      input: { timeState: 'ended', viewerRole: 'registrant' },
      expected: 'no-access',
    },
    {
      name: 'visitor on an ended open meeting with public artifacts gets tools',
      input: { timeState: 'ended', viewerRole: 'visitor', fullAccess: true },
      expected: 'tools',
    },
    { name: 'visitor on an ended meeting without artifacts gets no-access', input: { timeState: 'ended', viewerRole: 'visitor' }, expected: 'no-access' },
    {
      name: 'privacy does not override the ended branch',
      input: { timeState: 'ended', viewerRole: 'outsider', privacy: PRIVATE_OPEN, fullAccess: true },
      expected: 'tools',
    },
  ];

  for (const testCase of CASES) {
    it(testCase.name, () => {
      expect(resolveActionSlot(buildSlotInput(testCase.input))).toBe(testCase.expected);
    });
  }
});

describe('resolveVisibleSections', () => {
  it('hides every RSVP surface when invite responses are disabled', () => {
    for (const viewerRole of VIEWER_ROLES) {
      for (const timeState of TIME_STATES) {
        const sections = resolveVisibleSections({ fullAccess: true, inviteResponsesEnabled: false, recurring: false, timeState, viewerRole });
        expect(sections.rsvpSummary).toBe(false);
        expect(sections.rsvpRosterFilter).toBe(false);
        expect(sections.rsvpAvatarBadges).toBe(false);
      }
    }
  });

  it('shows the RSVP surfaces to a registrant on an RSVP-tracking meeting', () => {
    const sections = resolveVisibleSections({
      fullAccess: false,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'before',
      viewerRole: 'registrant',
    });
    expect(sections.rsvpSummary).toBe(true);
    expect(sections.rsvpRosterFilter).toBe(true);
    expect(sections.rsvpAvatarBadges).toBe(true);
  });

  it('withholds the RSVP surfaces from an outsider even when tracking is on', () => {
    const sections = resolveVisibleSections({
      fullAccess: false,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'before',
      viewerRole: 'outsider',
    });
    expect(sections.rsvpSummary).toBe(false);
  });

  it('hides the roster from anyone who is not on the meeting, because they have no count source', () => {
    for (const viewerRole of ['visitor', 'outsider'] as MeetingViewerRole[]) {
      const sections = resolveVisibleSections({ fullAccess: true, inviteResponsesEnabled: true, recurring: false, timeState: 'before', viewerRole });
      expect(sections.people).toBe(false);
    }
  });

  it('shows the roster to registrants and organizers', () => {
    for (const viewerRole of ['registrant', 'organizer'] as MeetingViewerRole[]) {
      const sections = resolveVisibleSections({ fullAccess: false, inviteResponsesEnabled: true, recurring: false, timeState: 'before', viewerRole });
      expect(sections.people).toBe(true);
    }
  });

  it('gates the past roster on artifact access, like the rest of the past content', () => {
    const sections = resolveVisibleSections({
      fullAccess: false,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'ended',
      viewerRole: 'registrant',
    });
    expect(sections.people).toBe(false);
  });

  it('gates past agenda and materials on artifact access', () => {
    const withAccess = resolveVisibleSections({
      fullAccess: true,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'ended',
      viewerRole: 'registrant',
    });
    const withoutAccess = resolveVisibleSections({
      fullAccess: false,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'ended',
      viewerRole: 'registrant',
    });
    expect(withAccess.agenda).toBe(true);
    expect(withAccess.materials).toBe(true);
    expect(withoutAccess.agenda).toBe(false);
    expect(withoutAccess.materials).toBe(false);
  });

  it('does not gate upcoming agenda and materials on artifact access', () => {
    const sections = resolveVisibleSections({
      fullAccess: false,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'before',
      viewerRole: 'outsider',
    });
    expect(sections.agenda).toBe(true);
    expect(sections.materials).toBe(true);
  });

  it('shows post-meeting tools only once the meeting ended and access is granted', () => {
    const ended = resolveVisibleSections({ fullAccess: true, inviteResponsesEnabled: true, recurring: false, timeState: 'ended', viewerRole: 'organizer' });
    const live = resolveVisibleSections({ fullAccess: true, inviteResponsesEnabled: true, recurring: false, timeState: 'live', viewerRole: 'organizer' });
    const endedNoAccess = resolveVisibleSections({
      fullAccess: false,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'ended',
      viewerRole: 'registrant',
    });
    expect(ended.tools).toBe(true);
    expect(live.tools).toBe(false);
    expect(endedNoAccess.tools).toBe(false);
  });

  // The two resolvers have to agree or the page renders a rail pointing at hidden sections. An
  // organizer without `PublicPastMeetingResponse.full_access` is the cell where they previously
  // disagreed, so
  // it is asserted across both at once rather than in each resolver's own describe.
  it('keeps an organizer without full access on the same side of both resolvers', () => {
    const input = {
      fullAccess: false,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'ended' as MeetingTimeState,
      viewerRole: 'organizer' as MeetingViewerRole,
    };
    const sections = resolveVisibleSections(input);

    expect(resolveActionSlot({ ...input, privacy: PUBLIC_OPEN })).toBe('tools');
    expect(sections.tools).toBe(true);
    expect(sections.agenda).toBe(true);
    expect(sections.materials).toBe(true);
    expect(sections.people).toBe(true);
  });

  it('hides join details after the meeting ends', () => {
    const sections = resolveVisibleSections({
      fullAccess: true,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'ended',
      viewerRole: 'organizer',
    });
    expect(sections.joinDetails).toBe(false);
  });

  it('shows join details to people on an upcoming meeting and to nobody else', () => {
    const registrant = resolveVisibleSections({
      fullAccess: false,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'live',
      viewerRole: 'registrant',
    });
    const outsider = resolveVisibleSections({
      fullAccess: false,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'live',
      viewerRole: 'outsider',
    });
    expect(registrant.joinDetails).toBe(true);
    expect(outsider.joinDetails).toBe(false);
  });

  it('shows the occurrence strip only for recurring meetings', () => {
    const base = { fullAccess: false, inviteResponsesEnabled: true, timeState: 'before' as MeetingTimeState, viewerRole: 'registrant' as MeetingViewerRole };
    expect(resolveVisibleSections({ ...base, recurring: true }).occurrences).toBe(true);
    expect(resolveVisibleSections({ ...base, recurring: false }).occurrences).toBe(false);
  });

  it('returns a boolean for every section on every viewer/time combination', () => {
    for (const viewerRole of VIEWER_ROLES) {
      for (const timeState of TIME_STATES) {
        const sections = resolveVisibleSections({ fullAccess: false, inviteResponsesEnabled: true, recurring: false, timeState, viewerRole });
        for (const value of Object.values(sections)) {
          expect(typeof value).toBe('boolean');
        }
      }
    }
  });
});
