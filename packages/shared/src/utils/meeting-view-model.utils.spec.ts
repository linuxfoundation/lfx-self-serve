// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The resolvers pull meeting.utils, which transitively imports @angular/common/http (HttpParams) —
// its declarations need the Angular JIT compiler when loaded outside an Angular bootstrap (as
// under Vitest). Importing the compiler first provides that facade.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { MeetingVisibility } from '../enums';
import type {
  ActionSlotInput,
  ActionSlotKind,
  Meeting,
  MeetingOccurrence,
  MeetingPrivacyState,
  MeetingSectionVisibility,
  MeetingTimeState,
  MeetingViewerRole,
  PublicCalendarMeeting,
} from '../interfaces';
import {
  listOtherGroupMeetings,
  resolveActionSlot,
  resolveMeetingStatus,
  resolvePrivacy,
  resolveTimeState,
  resolveViewerRole,
  resolveVisibleSections,
} from './meeting-view-model.utils';

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
  // exactly the rows it touches. This table is the executable source of truth; the written state
  // matrix (specs/011-meeting-details-redesign/state-matrix.md) mirrors it.
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

  it('hides every RSVP surface on an ended meeting without artifact access', () => {
    const sections = resolveVisibleSections({
      fullAccess: false,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'ended',
      viewerRole: 'registrant',
    });
    expect(sections.people).toBe(false);
    expect(sections.rsvpSummary).toBe(false);
    expect(sections.rsvpRosterFilter).toBe(false);
    expect(sections.rsvpAvatarBadges).toBe(false);
  });

  // Past rows are `PastMeetingParticipant` records with no RSVP answer, so the roster's RSVP filter
  // and badges stay off even where the past roster shows. The summary reads meeting-level counts.
  it.each(['organizer', 'registrant'] as MeetingViewerRole[])(
    'keeps only the RSVP summary on an ended meeting for an %s with artifact access',
    (viewerRole) => {
      const sections = resolveVisibleSections({
        fullAccess: true,
        inviteResponsesEnabled: true,
        recurring: false,
        timeState: 'ended',
        viewerRole,
      });
      expect(sections.people).toBe(true);
      expect(sections.rsvpSummary).toBe(true);
      expect(sections.rsvpRosterFilter).toBe(false);
      expect(sections.rsvpAvatarBadges).toBe(false);
    }
  );

  // A past registrant resolves as `outsider` (the past payload has no `invited`), and still gets the
  // summary with the roster; an anonymous viewer gets neither.
  it('gives the RSVP summary to a signed-in outsider with access on an ended meeting, but never to a visitor', () => {
    const base = { fullAccess: true, inviteResponsesEnabled: true, recurring: false, timeState: 'ended' as const };
    const outsider = resolveVisibleSections({ ...base, viewerRole: 'outsider' });
    expect(outsider.people).toBe(true);
    expect(outsider.rsvpSummary).toBe(true);
    expect(outsider.rsvpRosterFilter).toBe(false);
    expect(resolveVisibleSections({ ...base, viewerRole: 'visitor' }).rsvpSummary).toBe(false);
  });

  it('shows the RSVP surfaces to an organizer while the meeting is live', () => {
    const sections = resolveVisibleSections({
      fullAccess: false,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'live',
      viewerRole: 'organizer',
    });
    expect(sections.rsvpSummary).toBe(true);
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

  // The past payload never sets `invited`, so a past registrant arrives as an outsider. The roster
  // must still show for them when they have access, and never for an anonymous viewer.
  it('shows the past roster to any signed-in viewer with artifact access, whatever the role', () => {
    const outsiderWithAccess = resolveVisibleSections({
      fullAccess: true,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'ended',
      viewerRole: 'outsider',
    });
    const visitorWithAccess = resolveVisibleSections({
      fullAccess: true,
      inviteResponsesEnabled: true,
      recurring: false,
      timeState: 'ended',
      viewerRole: 'visitor',
    });
    expect(outsiderWithAccess.people).toBe(true);
    expect(visitorWithAccess.people).toBe(false);
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

describe('resolveMeetingStatus', () => {
  const before = { timeState: 'before' as const, hasStarted: false, invited: true, inviteResponsesEnabled: true };

  it.each([
    [{ ...before, timeState: 'ended' as const, myRsvp: 'accepted' as const }, 'ended'],
    [{ ...before, timeState: 'live' as const, hasStarted: true, myRsvp: 'declined' as const }, 'live'],
    // Inside the join window but before the scheduled start.
    [{ ...before, timeState: 'live' as const, hasStarted: false, myRsvp: null }, 'starting-soon'],
    [{ ...before, myRsvp: 'accepted' as const }, 'going'],
    [{ ...before, myRsvp: 'maybe' as const }, 'maybe'],
    [{ ...before, myRsvp: 'declined' as const }, 'cant-attend'],
    [{ ...before, myRsvp: null }, 'awaiting-rsvp'],
    // Not loaded yet: never claims the viewer has not answered.
    [{ ...before, myRsvp: undefined }, 'upcoming'],
    // Pre-2024 meetings never collected RSVPs: the time state only, never "Awaiting your RSVP".
    [{ ...before, inviteResponsesEnabled: false, myRsvp: null }, 'upcoming'],
    [{ ...before, inviteResponsesEnabled: false, myRsvp: 'accepted' as const }, 'upcoming'],
    // Not on the invite list: the time state.
    [{ ...before, invited: false, myRsvp: null }, 'upcoming'],
  ])('resolves %o to %s', (input, expected) => {
    expect(resolveMeetingStatus(input)).toBe(expected);
  });
});

/**
 * #3261: every legal (time, viewer, past access) cell of `resolveVisibleSections`, written from the
 * state matrix's § Section visibility table (its V2 column) rather than read back from the resolver. RSVP flags are the
 * F = on values; F = off and recurring are swept over every row below. Past access (D) is a real axis
 * only on an ended meeting; before and live carry one row each, and the sentinel block proves D is ignored there.
 */
describe('resolveVisibleSections: the section-visibility table', () => {
  type Cell = Omit<MeetingSectionVisibility, 'occurrences'>;
  const none: Cell = {
    agenda: false,
    joinDetails: false,
    materials: false,
    people: false,
    rsvpAvatarBadges: false,
    rsvpRosterFilter: false,
    rsvpSummary: false,
    tools: false,
  };
  // Upcoming and live: content is open to whoever loaded the page; roster, join details and RSVP are for those on the meeting.
  const open: Cell = { ...none, agenda: true, materials: true };
  const onTheMeeting: Cell = { ...open, joinDetails: true, people: true, rsvpAvatarBadges: true, rsvpRosterFilter: true, rsvpSummary: true };
  // Ended with access: content and tools; the past roster and its count strip for signed-in viewers (never anonymous);
  // no join details, and no roster filter or badges (past rows carry no RSVP).
  const endedVisitor: Cell = { ...open, tools: true }; // D-4
  const endedSignedIn: Cell = { ...open, people: true, rsvpSummary: true, tools: true };

  const TABLE: [MeetingTimeState, MeetingViewerRole, 'full' | 'none', Cell][] = [
    ['before', 'visitor', 'none', open],
    ['before', 'outsider', 'none', open],
    ['before', 'registrant', 'none', onTheMeeting],
    ['before', 'organizer', 'none', onTheMeeting],
    ['live', 'visitor', 'none', open],
    ['live', 'outsider', 'none', open],
    ['live', 'registrant', 'none', onTheMeeting],
    ['live', 'organizer', 'none', onTheMeeting],
    ['ended', 'visitor', 'full', endedVisitor],
    ['ended', 'visitor', 'none', none],
    ['ended', 'outsider', 'full', endedSignedIn],
    ['ended', 'outsider', 'none', none],
    ['ended', 'registrant', 'full', endedSignedIn],
    ['ended', 'registrant', 'none', none],
    // An organizer always has `full` (FGA); organizer + `none` is an illegal input, asserted in the sentinel block.
    ['ended', 'organizer', 'full', endedSignedIn],
  ];

  it('has exactly one row per legal cell', () => {
    const keys = TABLE.map(([time, role, access]) => `${time}/${role}/${access}`);
    const legal = [
      ...(['before', 'live'] as const).flatMap((time) => VIEWER_ROLES.map((role) => `${time}/${role}/none`)),
      ...VIEWER_ROLES.filter((role) => role !== 'organizer').flatMap((role) => [`ended/${role}/full`, `ended/${role}/none`]),
      'ended/organizer/full',
    ];
    expect(keys).toHaveLength(new Set(keys).size);
    expect(new Set(keys)).toEqual(new Set(legal));
  });

  it.each(TABLE)('%s · %s · %s access', (timeState, viewerRole, access, cell) => {
    for (const recurring of [false, true]) {
      const on = resolveVisibleSections({ fullAccess: access === 'full', inviteResponsesEnabled: true, recurring, timeState, viewerRole });
      expect(on).toEqual({ ...cell, occurrences: recurring });

      // F = off removes the RSVP dimension and changes nothing else.
      const off = resolveVisibleSections({ fullAccess: access === 'full', inviteResponsesEnabled: false, recurring, timeState, viewerRole });
      expect(off).toEqual({ ...cell, occurrences: recurring, rsvpAvatarBadges: false, rsvpRosterFilter: false, rsvpSummary: false });
    }
  });
});

/**
 * #3261: illegal inputs (state-matrix.md § Other illegal combinations) resolve to their legal neighbour,
 * the documented sentinel: the resolver ignores the axis that does not exist for that input.
 */
describe('illegal combinations resolve to their legal neighbour', () => {
  it('ignores past access (axis D) on a meeting that has not ended', () => {
    for (const timeState of ['before', 'live'] as const) {
      for (const viewerRole of VIEWER_ROLES) {
        for (const inviteResponsesEnabled of [true, false]) {
          for (const recurring of [false, true]) {
            const sections = (fullAccess: boolean) => resolveVisibleSections({ fullAccess, inviteResponsesEnabled, recurring, timeState, viewerRole });
            expect(sections(true)).toEqual(sections(false));
          }
          for (const privacy of ALL_PRIVACY) {
            const slot = (fullAccess: boolean) => resolveActionSlot({ fullAccess, inviteResponsesEnabled, privacy, timeState, viewerRole });
            expect(slot(true)).toBe(slot(false));
          }
        }
      }
    }
  });

  // The BFF always gives an organizer `full` (state-matrix.md, organizer rows); `none` resolves like `full`.
  it("ignores past access for an ended meeting's organizer", () => {
    for (const inviteResponsesEnabled of [true, false]) {
      for (const recurring of [false, true]) {
        const sections = (fullAccess: boolean) =>
          resolveVisibleSections({ fullAccess, inviteResponsesEnabled, recurring, timeState: 'ended', viewerRole: 'organizer' });
        expect(sections(false)).toEqual(sections(true));
      }
      for (const privacy of ALL_PRIVACY) {
        const slot = (fullAccess: boolean) => resolveActionSlot({ fullAccess, inviteResponsesEnabled, privacy, timeState: 'ended', viewerRole: 'organizer' });
        expect(slot(false)).toBe(slot(true));
      }
    }
  });

  it('ignores any RSVP answer (axis F x RSVP state) when RSVP tracking is off', () => {
    for (const myRsvp of ['accepted', 'maybe', 'declined', null, undefined] as const) {
      expect(resolveMeetingStatus({ timeState: 'before', hasStarted: false, invited: true, inviteResponsesEnabled: false, myRsvp })).toBe('upcoming');
    }
  });
});

describe('resolvers: remaining edges (#3261)', () => {
  it.each([
    [MeetingVisibility.PUBLIC, false, 'Public', 'fa-light fa-globe'],
    [MeetingVisibility.PUBLIC, true, 'Public (Restricted)', 'fa-light fa-lock'],
    [MeetingVisibility.PRIVATE, false, 'Private', 'fa-light fa-shield'],
    [MeetingVisibility.PRIVATE, true, 'Private (Restricted)', 'fa-light fa-lock'],
  ])('labels and marks %s / restricted=%s', (visibility, restricted, label, icon) => {
    expect(resolvePrivacy(visibility, restricted)).toMatchObject({ label, icon });
  });

  // hasMeetingEnded is strict (now > end + 40 min), so the grace period's last instant is still live.
  it('is still "live" at the exact end of the grace period', () => {
    expect(resolveTimeState(buildMeeting(), null, at('2026-06-01T11:40:00.000Z'))).toBe('live');
  });

  it("reads the occurrence it is handed, not the series' start", () => {
    const series = buildMeeting({ start_time: '2026-01-01T10:00:00.000Z' });
    expect(resolveTimeState(series, buildOccurrence(), at('2026-06-01T11:41:00.000Z'))).toBe('ended');
    expect(resolveTimeState(series, buildOccurrence(), at('2026-06-01T10:30:00.000Z'))).toBe('live');
  });

  it('makes an organizer who is not on the invite list an organizer', () => {
    expect(resolveViewerRole({ authenticated: true, organizer: true, invited: false })).toBe('organizer');
  });

  it.each([
    ['ended', false, false, true, 'ended'],
    ['ended', true, false, false, 'ended'],
    ['live', true, false, true, 'live'],
    ['live', false, true, false, 'starting-soon'],
  ] as const)(
    'resolves %s (started=%s, invited=%s, RSVP tracking=%s) to %s whatever the answer',
    (timeState, hasStarted, invited, inviteResponsesEnabled, status) => {
      for (const myRsvp of ['accepted', 'maybe', 'declined', null, undefined] as const) {
        expect(resolveMeetingStatus({ timeState, hasStarted, invited, inviteResponsesEnabled, myRsvp })).toBe(status);
      }
    }
  );
});

describe('listOtherGroupMeetings (E8-02)', () => {
  const now = new Date('2026-10-20T12:00:00Z');

  function feedRow(over: Partial<PublicCalendarMeeting> = {}): PublicCalendarMeeting {
    return {
      id: 'series-a',
      title: 'Technical Steering Committee',
      start_time: '2026-10-22T15:00:00Z',
      duration: 60,
      timezone: 'UTC',
      committee_uids: ['11111111-1111-4111-8111-111111111111'],
      ...over,
    };
  }

  it('lists one-off meetings that have not ended, soonest first', () => {
    const items = listOtherGroupMeetings(
      [feedRow({ id: 'later', start_time: '2026-10-30T15:00:00Z' }), feedRow({ id: 'sooner', start_time: '2026-10-21T15:00:00Z', timezone: 'Europe/Lisbon' })],
      'current',
      now
    );

    expect(items).toEqual([
      { meetingId: 'sooner', title: 'Technical Steering Committee', startTime: '2026-10-21T15:00:00Z', durationMinutes: 60, timezone: 'Europe/Lisbon' },
      { meetingId: 'later', title: 'Technical Steering Committee', startTime: '2026-10-30T15:00:00Z', durationMinutes: 60, timezone: 'UTC' },
    ]);
  });

  it('never lists the current meeting', () => {
    const items = listOtherGroupMeetings([feedRow({ id: 'current' }), feedRow({ id: 'other' })], 'current', now);

    expect(items.map((item) => item.meetingId)).toEqual(['other']);
  });

  it('drops ended one-offs and past-meeting rows, but keeps a meeting in progress', () => {
    const items = listOtherGroupMeetings(
      [
        feedRow({ id: 'ended', start_time: '2026-10-19T15:00:00Z' }),
        feedRow({ id: 'past-row', start_time: '2026-10-20T11:30:00Z', meeting_and_occurrence_id: 'past-row-1792501200000' }),
        feedRow({ id: 'live', start_time: '2026-10-20T11:30:00Z' }),
      ],
      'current',
      now
    );

    expect(items.map((item) => item.meetingId)).toEqual(['live']);
  });

  it('shows a series once, at its next occurrence that is neither cancelled nor ended', () => {
    const items = listOtherGroupMeetings(
      [
        feedRow({
          id: 'weekly',
          occurrences: [
            { occurrence_id: '1792407600', start_time: '2026-10-13T15:00:00Z', duration: 60, status: 'available' },
            { occurrence_id: '1793012400', start_time: '2026-10-27T15:00:00Z', duration: 45, status: 'available' },
            { occurrence_id: '1792731600', start_time: '2026-10-24T03:00:00Z', duration: 60, status: 'available' },
            { occurrence_id: '1792666800', start_time: '2026-10-23T09:00:00Z', duration: 60, status: 'cancel' },
          ] as PublicCalendarMeeting['occurrences'],
          cancelled_occurrences: ['1792731600'],
        }),
        feedRow({ id: 'weekly', start_time: '2026-10-21T15:00:00Z' }),
      ],
      'current',
      now
    );

    expect(items).toEqual([
      { meetingId: 'weekly', title: 'Technical Steering Committee', startTime: '2026-10-27T15:00:00Z', durationMinutes: 45, timezone: 'UTC' },
    ]);
  });

  it("falls back to the series' duration for an occurrence without its own", () => {
    const items = listOtherGroupMeetings(
      [
        feedRow({
          duration: 90,
          occurrences: [{ occurrence_id: '1792681200', start_time: '2026-10-23T13:00:00Z', status: 'available' }] as PublicCalendarMeeting['occurrences'],
        }),
      ],
      'current',
      now
    );

    expect(items[0].durationMinutes).toBe(90);
  });

  it('drops a series whose remaining occurrences are all cancelled or ended', () => {
    const items = listOtherGroupMeetings(
      [
        feedRow({
          occurrences: [
            { occurrence_id: '1792407600', start_time: '2026-10-13T15:00:00Z', duration: 60, status: 'available' },
            { occurrence_id: '1793012400', start_time: '2026-10-27T15:00:00Z', duration: 60, status: 'available' },
          ] as PublicCalendarMeeting['occurrences'],
          cancelled_occurrences: ['1793012400'],
        }),
      ],
      'current',
      now
    );

    expect(items).toEqual([]);
  });
});
