// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting.utils transitively imports @angular/common/http (HttpParams), whose declarations need the
// Angular JIT compiler when loaded outside an Angular bootstrap (as under Vitest). Importing the
// compiler first provides that facade so the module can be imported.
import '@angular/compiler';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PollStatus, RecurrenceType } from '../enums';
import {
  CANCELLED_COLOR,
  lfxColors,
  MEETING_TYPE_COLORS,
  PAST_MEETING_CALENDAR_COLOR,
  PAST_SURVEY_CALENDAR_COLOR,
  PAST_VOTE_CALENDAR_COLOR,
  SURVEY_COLOR,
  VOTE_COLOR,
} from '../constants';
import type {
  CustomRecurrencePattern,
  Meeting,
  MeetingCommittee,
  MeetingOccurrence,
  MeetingRecurrence,
  MeetingRegistrant,
  PastMeeting,
  PastMeetingSummary,
  PastOccurrenceSummary,
  QueryServiceItem,
  Vote,
} from '../interfaces';
import {
  buildCommitteeCadenceSummary,
  buildMeetingOccurrenceRoute,
  buildOccurrenceNavTimeline,
  getMeetingSeriesUid,
  buildMeetingOrganizerChip,
  buildMeetingOrganizerMailto,
  buildImportSummary,
  buildRecurrenceNeverEndDate,
  buildRecurrenceSummary,
  collectMeetingOrganizers,
  compareMeetingPeopleByHostThenName,
  convertRecurrenceToPattern,
  extractRegistrantEmails,
  filterUnlistedEmails,
  getMeetingOrganizerDisplayName,
  isCalendarDeadlinePast,
  isMeetingOccurrenceCancelled,
  isMeetingOrganizedByViewer,
  isOccurrencePast,
  isPastMeetingCompositeId,
  isUnresolvableParticipantName,
  isVoteCalendarEventPast,
  normalizeIndexedMeetingAiSummary,
  resolveMeetingOrganizer,
  resolveMeetingOwner,
  resolveMeetingCalendarColors,
  resolveOccurrenceRecurrence,
  resolveRsvpOccurrenceId,
  resolveSurveyCalendarColors,
  resolveVoteCalendarColors,
  sanitizeMeetingCommittees,
  sanitizeMeetingCommitteeUids,
  selectCommitteeCadenceMeeting,
  selectPrimaryPastMeetingSummary,
  sortPastMeetingsDescending,
} from './meeting.utils';

/**
 * Builds a minimal PastMeeting fixture. The sort only reads `scheduled_start_time`/`start_time`,
 * so only those plus an identifying `uid` are set; the rest is cast to satisfy the interface.
 */
function pastMeeting(partial: { uid: string; scheduled_start_time?: string; start_time?: string }): PastMeeting {
  return {
    uid: partial.uid,
    scheduled_start_time: partial.scheduled_start_time as string,
    start_time: partial.start_time as string,
  } as PastMeeting;
}

const uids = (meetings: PastMeeting[]): string[] => meetings.map((m) => m.uid);

describe('sortPastMeetingsDescending', () => {
  it('orders past meetings most-recent-first by scheduled_start_time', () => {
    const input = [
      pastMeeting({ uid: 'oldest', scheduled_start_time: '2026-01-01T10:00:00Z' }),
      pastMeeting({ uid: 'newest', scheduled_start_time: '2026-03-01T10:00:00Z' }),
      pastMeeting({ uid: 'middle', scheduled_start_time: '2026-02-01T10:00:00Z' }),
    ];

    expect(uids(sortPastMeetingsDescending(input))).toEqual(['newest', 'middle', 'oldest']);
  });

  it('falls back to start_time when scheduled_start_time is absent', () => {
    const input = [pastMeeting({ uid: 'a', start_time: '2026-01-01T10:00:00Z' }), pastMeeting({ uid: 'b', start_time: '2026-05-01T10:00:00Z' })];

    expect(uids(sortPastMeetingsDescending(input))).toEqual(['b', 'a']);
  });

  it('prefers scheduled_start_time over start_time when both are present', () => {
    const input = [
      // start_time would sort this first, but scheduled_start_time (the authoritative field) is older
      pastMeeting({ uid: 'scheduled-older', scheduled_start_time: '2026-01-01T10:00:00Z', start_time: '2026-09-01T10:00:00Z' }),
      pastMeeting({ uid: 'scheduled-newer', scheduled_start_time: '2026-06-01T10:00:00Z', start_time: '2026-02-01T10:00:00Z' }),
    ];

    expect(uids(sortPastMeetingsDescending(input))).toEqual(['scheduled-newer', 'scheduled-older']);
  });

  it('does not mutate the input array', () => {
    const input = [
      pastMeeting({ uid: 'oldest', scheduled_start_time: '2026-01-01T10:00:00Z' }),
      pastMeeting({ uid: 'newest', scheduled_start_time: '2026-03-01T10:00:00Z' }),
    ];
    const originalOrder = uids(input);

    sortPastMeetingsDescending(input);

    expect(uids(input)).toEqual(originalOrder);
  });

  it('returns an empty array unchanged', () => {
    expect(sortPastMeetingsDescending([])).toEqual([]);
  });

  it('keeps a globally descending order when pages are appended out of date order (paginated case)', () => {
    // Mirrors the dashboard scan: a name-cursor page may arrive with meetings more recent than
    // ones already loaded, so the merged accumulator must be re-sorted to stay most-recent-first.
    const page1 = [
      pastMeeting({ uid: 'p1-feb', scheduled_start_time: '2026-02-01T10:00:00Z' }),
      pastMeeting({ uid: 'p1-jan', scheduled_start_time: '2026-01-01T10:00:00Z' }),
    ];
    const page2 = [
      pastMeeting({ uid: 'p2-may', scheduled_start_time: '2026-05-01T10:00:00Z' }),
      pastMeeting({ uid: 'p2-mar', scheduled_start_time: '2026-03-01T10:00:00Z' }),
    ];

    const merged = sortPastMeetingsDescending([...page1, ...page2]);

    expect(uids(merged)).toEqual(['p2-may', 'p2-mar', 'p1-feb', 'p1-jan']);
  });
});

describe('resolveRsvpOccurrenceId', () => {
  const recurringMeeting = {
    recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2' },
    occurrences: [
      { occurrence_id: '1785247200', start_time: '2026-07-28T14:00:00Z', duration: 60 },
      { occurrence_id: '1785852000', start_time: '2026-08-04T14:00:00Z', duration: 60 },
    ],
    cancelled_occurrences: [],
  } as Meeting;

  const nonRecurringMeeting = { recurrence: null, occurrences: [] } as unknown as Meeting;

  it('returns undefined for non-recurring meetings', () => {
    expect(resolveRsvpOccurrenceId(nonRecurringMeeting, { occurrenceId: '1785247200' })).toBeUndefined();
  });

  it('prefers an explicit occurrence id string', () => {
    expect(resolveRsvpOccurrenceId(recurringMeeting, { occurrenceId: '1785852000' })).toBe('1785852000');
  });

  it('prefers an explicit occurrence object', () => {
    expect(
      resolveRsvpOccurrenceId(recurringMeeting, {
        occurrence: { occurrence_id: '1785852000', start_time: '2026-08-04T14:00:00Z', duration: 60 } as MeetingOccurrence,
      })
    ).toBe('1785852000');
  });

  it('falls through empty occurrenceId to occurrence object id', () => {
    expect(
      resolveRsvpOccurrenceId(recurringMeeting, {
        occurrenceId: '',
        occurrence: { occurrence_id: '1785852000', start_time: '2026-08-04T14:00:00Z', duration: 60 } as MeetingOccurrence,
      })
    ).toBe('1785852000');
  });

  it('falls back to getCurrentOrNextOccurrence when no occurrence context is supplied', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
    try {
      const firstStart = new Date('2026-01-20T14:00:00.000Z');
      const secondStart = new Date('2026-01-27T14:00:00.000Z');
      const firstOccurrenceId = String(Math.floor(firstStart.getTime() / 1000));
      const meeting = {
        recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2' },
        occurrences: [
          { occurrence_id: firstOccurrenceId, start_time: firstStart.toISOString(), duration: 60 },
          {
            occurrence_id: String(Math.floor(secondStart.getTime() / 1000)),
            start_time: secondStart.toISOString(),
            duration: 60,
          },
        ],
        cancelled_occurrences: [],
      } as Meeting;

      expect(resolveRsvpOccurrenceId(meeting)).toBe(firstOccurrenceId);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('resolveOccurrenceRecurrence', () => {
  // Top-level series rule: monthly on the 1st Thursday (the original, intentionally-stale cadence).
  const monthly: MeetingRecurrence = { type: RecurrenceType.MONTHLY, repeat_interval: 1, monthly_week: 1, monthly_week_day: 5 };
  // Per-occurrence override stamped after an all_following cadence change: quarterly on the 1st Thursday.
  const quarterly: MeetingRecurrence = { type: RecurrenceType.MONTHLY, repeat_interval: 3, monthly_week: 1, monthly_week_day: 5 };

  const occurrence = (recurrence?: MeetingRecurrence | null): MeetingOccurrence =>
    ({ occurrence_id: '1786039200', start_time: '2026-08-06T18:00:00Z', duration: 60, recurrence }) as MeetingOccurrence;

  const meeting = (recurrence: MeetingRecurrence | null): Pick<Meeting, 'recurrence'> => ({ recurrence });

  it('prefers the occurrence-level recurrence override when present', () => {
    expect(resolveOccurrenceRecurrence(meeting(monthly), occurrence(quarterly))).toBe(quarterly);
  });

  it('falls back to the top-level recurrence when the occurrence has none', () => {
    expect(resolveOccurrenceRecurrence(meeting(monthly), occurrence(null))).toBe(monthly);
    expect(resolveOccurrenceRecurrence(meeting(monthly), occurrence(undefined))).toBe(monthly);
  });

  it('falls back to the top-level recurrence when no occurrence is supplied', () => {
    expect(resolveOccurrenceRecurrence(meeting(monthly), null)).toBe(monthly);
    expect(resolveOccurrenceRecurrence(meeting(monthly))).toBe(monthly);
  });

  it('is null-safe when neither the occurrence nor the meeting carries a recurrence', () => {
    expect(resolveOccurrenceRecurrence(meeting(null), occurrence(null))).toBeNull();
    expect(resolveOccurrenceRecurrence(meeting(null), null)).toBeNull();
  });

  it('end-to-end label (meeting 92079944361): stale monthly top-level + quarterly occurrence override yields "Quarterly on the 1st Thursday"', () => {
    // Mirrors the pipe: the resolved recurrence is fed to buildRecurrenceSummary after the
    // monthly/day-of-week shape is applied. The override (repeat_interval=3) must win over the
    // stale top-level monthly rule so the label reads "Quarterly", not "Monthly".
    const resolved = resolveOccurrenceRecurrence(meeting(monthly), occurrence(quarterly));
    const pattern = { ...resolved, patternType: 'monthly', monthlyType: 'dayOfWeek', endType: 'never' } as CustomRecurrencePattern;

    expect(buildRecurrenceSummary(pattern).fullSummary).toBe('Quarterly on the 1st Thursday');
  });

  it('end-to-end label: with no occurrence override the same surfaces still render the stale top-level "Monthly on the 1st Thursday"', () => {
    // Documents current behaviour: without an override the label falls back to the series rule.
    const resolved = resolveOccurrenceRecurrence(meeting(monthly), occurrence(null));
    const pattern = { ...resolved, patternType: 'monthly', monthlyType: 'dayOfWeek', endType: 'never' } as CustomRecurrencePattern;

    expect(buildRecurrenceSummary(pattern).fullSummary).toBe('Monthly on the 1st Thursday');
  });
});

describe('convertRecurrenceToPattern', () => {
  it('maps a daily recurrence', () => {
    const pattern = convertRecurrenceToPattern({ type: RecurrenceType.DAILY, repeat_interval: 1 });
    expect(pattern.patternType).toBe('daily');
    expect(pattern.endType).toBe('never');
  });

  it('maps a weekly recurrence, converting 1-based weekly_days to a 0-based array', () => {
    const pattern = convertRecurrenceToPattern({ type: RecurrenceType.WEEKLY, repeat_interval: 2, weekly_days: '2,4' });
    expect(pattern.patternType).toBe('weekly');
    expect(pattern.weeklyDaysArray).toEqual([1, 3]);
  });

  it('maps a monthly/dayOfMonth recurrence', () => {
    const pattern = convertRecurrenceToPattern({ type: RecurrenceType.MONTHLY, repeat_interval: 1, monthly_day: 15 });
    expect(pattern.patternType).toBe('monthly');
    expect(pattern.monthlyType).toBe('dayOfMonth');
  });

  it('maps a monthly/dayOfWeek recurrence', () => {
    const pattern = convertRecurrenceToPattern({ type: RecurrenceType.MONTHLY, repeat_interval: 1, monthly_week: 1, monthly_week_day: 5 });
    expect(pattern.monthlyType).toBe('dayOfWeek');
  });

  it('derives endType "date" from a real end_date_time and "never" from the never-ends sentinel', () => {
    const dated = convertRecurrenceToPattern({ type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2', end_date_time: '2026-01-01T00:00:00Z' });
    expect(dated.endType).toBe('date');

    const neverEnds = convertRecurrenceToPattern({
      type: RecurrenceType.WEEKLY,
      repeat_interval: 1,
      weekly_days: '2',
      end_date_time: buildRecurrenceNeverEndDate(),
    });
    expect(neverEnds.endType).toBe('never');
  });

  it('derives endType "occurrences" from end_times', () => {
    const pattern = convertRecurrenceToPattern({ type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2', end_times: 5 });
    expect(pattern.endType).toBe('occurrences');
  });
});

describe('selectCommitteeCadenceMeeting', () => {
  const recurring = { uid: 'm1', recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2' } } as Meeting;
  const oneOff = { uid: 'm2', recurrence: null } as Meeting;

  it('returns null for an empty list', () => {
    expect(selectCommitteeCadenceMeeting([])).toBeNull();
  });

  it('returns the first meeting when none are recurring', () => {
    const oneOff2 = { uid: 'm3', recurrence: null } as Meeting;
    expect(selectCommitteeCadenceMeeting([oneOff, oneOff2])).toBe(oneOff);
  });

  it('returns the first recurring meeting even when it is not first in the list', () => {
    expect(selectCommitteeCadenceMeeting([oneOff, recurring])).toBe(recurring);
  });

  it('returns the single meeting when only one exists', () => {
    expect(selectCommitteeCadenceMeeting([oneOff])).toBe(oneOff);
  });

  it('treats a meeting with recurrence entirely absent the same as an explicit null (truthy check, not a strict null check)', () => {
    const noRecurrenceField = { uid: 'm4' } as Meeting;
    expect(selectCommitteeCadenceMeeting([noRecurrenceField, recurring])).toBe(recurring);
  });
});

describe('buildCommitteeCadenceSummary', () => {
  it('falls back to a static message when there are no meetings', () => {
    expect(buildCommitteeCadenceSummary([])).toBe('No recurring meetings scheduled');
  });

  it('composes a weekly cadence string with duration and platform', () => {
    const meeting = {
      recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2,4' },
      duration: 60,
      platform: 'Zoom',
    } as Meeting;
    expect(buildCommitteeCadenceSummary([meeting])).toBe('Weekly on Monday, Wednesday · 60 min · Zoom');
  });

  it('composes a bi-weekly cadence string', () => {
    const meeting = {
      recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 2, weekly_days: '5' },
      duration: 30,
      platform: 'Zoom',
    } as Meeting;
    expect(buildCommitteeCadenceSummary([meeting])).toBe('Every 2 weeks on Thursday · 30 min · Zoom');
  });

  it('composes a monthly cadence string', () => {
    const meeting = {
      recurrence: { type: RecurrenceType.MONTHLY, repeat_interval: 1, monthly_day: 15 },
      duration: 45,
      platform: 'Zoom',
    } as Meeting;
    expect(buildCommitteeCadenceSummary([meeting])).toBe('Monthly on day 15 · 45 min · Zoom');
  });

  it('labels a non-recurring meeting as "One-time meeting"', () => {
    const meeting = { recurrence: null, duration: 30, platform: 'Zoom' } as Meeting;
    expect(buildCommitteeCadenceSummary([meeting])).toBe('One-time meeting · 30 min · Zoom');
  });

  it('omits the platform segment when platform is absent', () => {
    const meeting = { recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2' }, duration: 60 } as Meeting;
    expect(buildCommitteeCadenceSummary([meeting])).toBe('Weekly on Monday · 60 min');
  });

  it('omits the duration segment when duration is falsy', () => {
    const meeting = { recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1, weekly_days: '2' }, duration: 0, platform: 'Zoom' } as Meeting;
    expect(buildCommitteeCadenceSummary([meeting])).toBe('Weekly on Monday · Zoom');
  });
});

describe('normalizeIndexedMeetingAiSummary', () => {
  it('derives ai_summary_enabled from zoom_config.ai_companion_enabled when top-level is absent', () => {
    const meeting = { zoom_config: { ai_companion_enabled: true } } as Meeting;

    expect(normalizeIndexedMeetingAiSummary(meeting).ai_summary_enabled).toBe(true);
  });

  it('derives ai_summary_enabled false from zoom_config.ai_companion_enabled false', () => {
    const meeting = { zoom_config: { ai_companion_enabled: false } } as Meeting;

    expect(normalizeIndexedMeetingAiSummary(meeting).ai_summary_enabled).toBe(false);
  });

  it('preserves explicit top-level ai_summary_enabled true over zoom_config false', () => {
    const meeting = { ai_summary_enabled: true, zoom_config: { ai_companion_enabled: false } } as Meeting;

    expect(normalizeIndexedMeetingAiSummary(meeting).ai_summary_enabled).toBe(true);
  });

  it('preserves explicit top-level ai_summary_enabled false over zoom_config true', () => {
    const meeting = { ai_summary_enabled: false, zoom_config: { ai_companion_enabled: true } } as Meeting;

    expect(normalizeIndexedMeetingAiSummary(meeting).ai_summary_enabled).toBe(false);
  });

  it('returns the same reference when zoom_config is absent', () => {
    const meeting = { ai_summary_enabled: true } as Meeting;

    expect(normalizeIndexedMeetingAiSummary(meeting)).toBe(meeting);
  });

  it('derives require_ai_summary_approval from zoom_config with the same precedence', () => {
    const fromZoom = { zoom_config: { ai_summary_require_approval: true } } as Meeting;
    expect(normalizeIndexedMeetingAiSummary(fromZoom).require_ai_summary_approval).toBe(true);

    const topLevelWins = {
      require_ai_summary_approval: false,
      zoom_config: { ai_summary_require_approval: true },
    } as Meeting;
    expect(normalizeIndexedMeetingAiSummary(topLevelWins).require_ai_summary_approval).toBe(false);
  });

  it('leaves ai_summary fields undefined when neither layer provides a value', () => {
    const meeting = { zoom_config: { meeting_id: '123' } } as Meeting;
    const result = normalizeIndexedMeetingAiSummary(meeting);
    expect(result.ai_summary_enabled).toBeUndefined();
    expect(result.require_ai_summary_approval).toBeUndefined();
  });
});

describe('resolveMeetingOwner', () => {
  it('normalizes a valid owner to the display shape, keeping profile_picture', () => {
    const meeting = {
      owner: { user_id: 'u-1', name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com', profile_picture: 'https://x/a.jpg' },
    } as Meeting;

    expect(resolveMeetingOwner(meeting)).toEqual({
      name: 'Ada Lovelace',
      username: 'alovelace',
      email: 'ada@example.com',
      profile_picture: 'https://x/a.jpg',
    });
  });

  it('omits profile_picture when the owner has none', () => {
    const meeting = { owner: { name: 'Ada', username: 'ada', email: 'ada@example.com' } } as Meeting;

    expect(resolveMeetingOwner(meeting)).toEqual({ name: 'Ada', username: 'ada', email: 'ada@example.com' });
  });

  it('returns null for a zero-valued owner (meeting predates the field)', () => {
    const meeting = { owner: { user_id: '', name: '', username: '', email: '', profile_picture: '' } } as Meeting;

    expect(resolveMeetingOwner(meeting)).toBeNull();
  });

  it('returns null for service-account owners — ITX defaults owner to the creator, so webhook meetings get zoom.webhooks', () => {
    expect(resolveMeetingOwner({ owner: { name: 'Zoom Webhooks', username: 'zoom.webhooks', email: 'noreply@zoom.us' } } as Meeting)).toBeNull();
    expect(resolveMeetingOwner({ owner: { name: '', username: '', email: 'zoom.events@zoom.us' } } as Meeting)).toBeNull();
  });

  it('returns null when the owner is missing entirely', () => {
    expect(resolveMeetingOwner({} as Meeting)).toBeNull();
    expect(resolveMeetingOwner(null)).toBeNull();
    expect(resolveMeetingOwner(undefined)).toBeNull();
  });
});

describe('resolveMeetingOrganizer', () => {
  it('prefers the owner over a human created_by', () => {
    const meeting = {
      owner: { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' },
      created_by: { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' },
    } as Meeting;

    expect(resolveMeetingOrganizer(meeting)?.name).toBe('Grace Hopper');
  });

  it('prefers the owner over the host fallback', () => {
    const meeting = { owner: { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' } } as Meeting;
    const hosts = [{ first_name: 'Alan', last_name: 'Turing', host: true }];

    expect(resolveMeetingOrganizer(meeting, hosts)?.name).toBe('Grace Hopper');
  });

  it('falls back to created_by when the owner is zero-valued or a service account', () => {
    const zeroValued = {
      owner: { user_id: '', name: '', username: '', email: '' },
      created_by: { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' },
    } as Meeting;
    const serviceOwner = {
      owner: { name: 'Zoom Webhooks', username: 'zoom.webhooks', email: '' },
      created_by: { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' },
    } as Meeting;

    expect(resolveMeetingOrganizer(zeroValued)?.name).toBe('Ada Lovelace');
    expect(resolveMeetingOrganizer(serviceOwner)?.name).toBe('Ada Lovelace');
  });

  it('returns created_by when it is a real human', () => {
    const meeting = { created_by: { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com', profile_picture: 'https://x/a.jpg' } } as Meeting;

    expect(resolveMeetingOrganizer(meeting)).toEqual({
      name: 'Ada Lovelace',
      username: 'alovelace',
      email: 'ada@example.com',
      profile_picture: 'https://x/a.jpg',
    });
  });

  it('omits profile_picture when created_by has none', () => {
    const meeting = { created_by: { name: 'Ada', username: 'ada', email: 'ada@example.com' } } as Meeting;

    expect(resolveMeetingOrganizer(meeting)).toEqual({ name: 'Ada', username: 'ada', email: 'ada@example.com' });
  });

  it('skips zoom.webhooks / zoom.events service-account usernames', () => {
    const webhooks = { created_by: { name: 'Zoom Webhooks', username: 'zoom.webhooks', email: 'noreply@zoom.us' } } as Meeting;
    const events = { created_by: { name: '', username: 'zoom.events', email: '' } } as Meeting;

    expect(resolveMeetingOrganizer(webhooks)).toBeNull();
    expect(resolveMeetingOrganizer(events)).toBeNull();
  });

  it('skips service accounts matched by email or email local-part', () => {
    const byEmail = { created_by: { name: '', username: '', email: 'zoom.webhooks@zoom.us' } } as Meeting;

    expect(resolveMeetingOrganizer(byEmail)).toBeNull();
  });

  it('returns null when created_by is empty and no hosts are given', () => {
    expect(resolveMeetingOrganizer({ created_by: { name: '', username: '', email: '' } } as Meeting)).toBeNull();
    expect(resolveMeetingOrganizer({} as Meeting)).toBeNull();
    expect(resolveMeetingOrganizer(null)).toBeNull();
  });

  it('falls back to the first host when created_by is not a human', () => {
    const meeting = { created_by: { name: 'Zoom Webhooks', username: 'zoom.webhooks', email: '' } } as Meeting;
    const hosts = [
      { first_name: 'Not', last_name: 'Host', host: false },
      { first_name: 'Grace', last_name: 'Hopper', username: 'ghopper', email: 'grace@example.com', avatar_url: 'https://x/g.jpg', host: true },
    ];

    expect(resolveMeetingOrganizer(meeting, hosts)).toEqual({
      name: 'Grace Hopper',
      username: 'ghopper',
      email: 'grace@example.com',
      profile_picture: 'https://x/g.jpg',
    });
  });

  it('prefers a human created_by over host fallback', () => {
    const meeting = { created_by: { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' } } as Meeting;
    const hosts = [{ first_name: 'Grace', last_name: 'Hopper', host: true }];

    expect(resolveMeetingOrganizer(meeting, hosts)?.name).toBe('Ada Lovelace');
  });

  it('returns null when hosts exist but none is flagged host', () => {
    expect(resolveMeetingOrganizer({} as Meeting, [{ first_name: 'A', last_name: 'B', host: false }])).toBeNull();
  });
});

describe('getMeetingOrganizerDisplayName', () => {
  it('prefers name, then username, then email', () => {
    expect(getMeetingOrganizerDisplayName({ name: 'Ada Lovelace', username: 'ada', email: 'ada@example.com' })).toBe('Ada Lovelace');
    expect(getMeetingOrganizerDisplayName({ name: '   ', username: 'ada', email: 'ada@example.com' })).toBe('ada');
    expect(getMeetingOrganizerDisplayName({ name: '', username: '', email: 'ada@example.com' })).toBe('ada@example.com');
  });

  it('returns an empty string for null or a fully empty organizer', () => {
    expect(getMeetingOrganizerDisplayName(null)).toBe('');
    expect(getMeetingOrganizerDisplayName({ name: '', username: '', email: '' })).toBe('');
  });
});

describe('collectMeetingOrganizers', () => {
  it('returns the human created_by as the sole organizer when no hosts are supplied', () => {
    const meeting = { created_by: { name: 'Ada Lovelace', username: 'ada', email: 'ada@example.com' } } as Meeting;

    expect(collectMeetingOrganizers(meeting)).toEqual([{ name: 'Ada Lovelace', username: 'ada', email: 'ada@example.com' }]);
  });

  it('uses the host set (sorted by name) as the authoritative organizers when hosts are present', () => {
    const meeting = { created_by: { name: 'Zoom Webhooks', username: 'zoom.webhooks', email: '' } } as Meeting;
    const hosts = [
      { first_name: 'Grace', last_name: 'Hopper', username: 'ghopper', email: 'grace@example.com', host: true },
      { first_name: 'Alan', last_name: 'Turing', username: 'aturing', email: 'alan@example.com', host: true },
      { first_name: 'Not', last_name: 'Host', host: false },
    ];

    const organizers = collectMeetingOrganizers(meeting, hosts);
    expect(organizers.map((o) => o.name)).toEqual(['Alan Turing', 'Grace Hopper']);
  });

  it('does NOT short-circuit on created_by — hosts drive the set so chip and modal agree', () => {
    // Regression: created_by (Christina) is one of two hosts; the chip must show BOTH, not just created_by.
    const meeting = { created_by: { name: 'Christina Harter', username: 'charter', email: 'christina@example.com' } } as Meeting;
    const hosts = [
      { first_name: 'Christina', last_name: 'Harter', username: 'charter', email: 'christina@example.com', host: true },
      { first_name: 'Grant', last_name: 'Miller', username: 'gmiller', email: 'grant@example.com', host: true },
    ];

    const organizers = collectMeetingOrganizers(meeting, hosts);
    expect(organizers.map((o) => o.name)).toEqual(['Christina Harter', 'Grant Miller']);
  });

  it('folds a human created_by in when it is not among the hosts', () => {
    const meeting = { created_by: { name: 'Ada Lovelace', username: 'ada', email: 'ada@example.com' } } as Meeting;
    const hosts = [{ first_name: 'Grant', last_name: 'Miller', username: 'gmiller', email: 'grant@example.com', host: true }];

    const organizers = collectMeetingOrganizers(meeting, hosts);
    expect(organizers.map((o) => o.name)).toEqual(['Ada Lovelace', 'Grant Miller']);
  });

  it('returns an empty array when nothing resolves', () => {
    expect(collectMeetingOrganizers({} as Meeting)).toEqual([]);
    expect(collectMeetingOrganizers({} as Meeting, [{ first_name: 'A', last_name: 'B', host: false }])).toEqual([]);
  });

  it('shows the owner as the sole organizer instead of created_by — ownership transfer replaces the creator slot', () => {
    const meeting = {
      owner: { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' },
      created_by: { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' },
    } as Meeting;

    expect(collectMeetingOrganizers(meeting)).toEqual([{ name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' }]);
  });

  it('folds the owner in before hosts when it is not among them', () => {
    const meeting = { owner: { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' } } as Meeting;
    const hosts = [{ first_name: 'Alan', last_name: 'Turing', username: 'aturing', email: 'alan@example.com', host: true }];

    expect(collectMeetingOrganizers(meeting, hosts).map((o) => o.name)).toEqual(['Grace Hopper', 'Alan Turing']);
  });

  it('keeps the owner first without duplicating them when they are also a host', () => {
    // Grace sorts after Alan alphabetically — the owner must still be index 0, because
    // buildMeetingOrganizerChip renders element 0 as the primary organizer.
    const meeting = { owner: { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' } } as Meeting;
    const hosts = [
      { first_name: 'Grace', last_name: 'Hopper', username: 'ghopper', email: 'grace@example.com', host: true },
      { first_name: 'Alan', last_name: 'Turing', username: 'aturing', email: 'alan@example.com', host: true },
    ];

    expect(collectMeetingOrganizers(meeting, hosts).map((o) => o.name)).toEqual(['Grace Hopper', 'Alan Turing']);
  });

  it('falls back to created_by as primary when the owner is zero-valued', () => {
    const meeting = {
      owner: { user_id: '', name: '', username: '', email: '' },
      created_by: { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' },
    } as Meeting;

    expect(collectMeetingOrganizers(meeting)).toEqual([{ name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' }]);
  });
});

describe('buildMeetingOrganizerMailto', () => {
  it('returns null when there is no email (caller renders plain text)', () => {
    expect(buildMeetingOrganizerMailto({ email: '', meetingTitle: 'Sync', detailUrl: 'https://x/m/1' })).toBeNull();
    expect(buildMeetingOrganizerMailto({ email: null })).toBeNull();
  });

  it('builds a mailto with a percent-encoded subject and body, address left bare', () => {
    const href = buildMeetingOrganizerMailto({
      email: 'ada@example.com',
      meetingTitle: 'Board & Strategy',
      meetingDate: 'Jul 22, 2026',
      detailUrl: 'https://lfx.dev/meetings/abc?x=1',
    });

    expect(href).toBe(
      'mailto:ada@example.com?subject=Board%20%26%20Strategy%20%E2%80%94%20Jul%2022%2C%202026&body=https%3A%2F%2Flfx.dev%2Fmeetings%2Fabc%3Fx%3D1'
    );
  });

  it('joins title and date with an em dash and omits empty parts', () => {
    expect(buildMeetingOrganizerMailto({ email: 'a@b.com', meetingTitle: 'Only Title' })).toBe('mailto:a@b.com?subject=Only%20Title');
    expect(buildMeetingOrganizerMailto({ email: 'a@b.com' })).toBe('mailto:a@b.com');
  });

  it('rejects addresses that could inject mailto headers', () => {
    expect(buildMeetingOrganizerMailto({ email: 'a?subject=evil@b.com', meetingTitle: 'T' })).toBeNull();
    expect(buildMeetingOrganizerMailto({ email: 'a&cc=x@b.com' })).toBeNull();
    expect(buildMeetingOrganizerMailto({ email: 'has space@b.com' })).toBeNull();
    expect(buildMeetingOrganizerMailto({ email: 'no-at-sign' })).toBeNull();
    // Percent-encoded CRLF + Bcc header-injection attempt must not survive the allowlist.
    expect(buildMeetingOrganizerMailto({ email: 'victim@example.com%0D%0ABcc:attacker@example.com' })).toBeNull();
    expect(buildMeetingOrganizerMailto({ email: 'two@at@example.com' })).toBeNull();
  });
});

describe('buildMeetingOrganizerChip', () => {
  const ada = { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' };
  const grace = { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' };
  const noEmail = { name: 'No Email', username: 'noemail', email: '' };
  const ctx = { meetingTitle: 'Sync', meetingDate: 'Jul 22, 2026', detailUrl: 'https://x/m/1' };

  it('returns null when there are no organizers', () => {
    expect(buildMeetingOrganizerChip([])).toBeNull();
  });

  it('builds a single-organizer chip with a mailto link and a stable track key on the name', () => {
    const chip = buildMeetingOrganizerChip([ada], null, ctx);
    expect(chip?.count).toBe(1);
    expect(chip?.primary.name).toBe('Ada Lovelace');
    expect(chip?.primary.key).toBe('alovelace#0');
    expect(chip?.primary.mailto).toContain('mailto:ada@example.com?subject=Sync');
    expect(chip?.overflow).toEqual([]);
  });

  it('gives same-named organizers distinct track keys even with no username/email', () => {
    // Two host-only organizers with identical display names and no username/email must not collide.
    const nameOnlyA = { name: 'Alex Kim', username: '', email: '' };
    const nameOnlyB = { name: 'Alex Kim', username: '', email: '' };
    const chip = buildMeetingOrganizerChip([nameOnlyA, nameOnlyB]);
    expect(chip?.primary.key).toBe('Alex Kim#0');
    expect(chip?.overflow[0].key).toBe('Alex Kim#1');
    expect(chip?.primary.key).not.toBe(chip?.overflow[0].key);
  });

  it('marks the viewer as "you" and never links their name', () => {
    const chip = buildMeetingOrganizerChip([ada], 'auth0|alovelace', ctx);
    expect(chip?.primary.isYou).toBe(true);
    expect(chip?.primary.mailto).toBeNull();
  });

  it('exposes overflow organizers for the "+N" popover, each with its own mailto', () => {
    const chip = buildMeetingOrganizerChip([grace, ada, noEmail], null, ctx);
    expect(chip?.count).toBe(3);
    expect(chip?.primary.name).toBe('Grace Hopper');
    expect(chip?.overflow.map((o) => o.name)).toEqual(['Ada Lovelace', 'No Email']);
    expect(chip?.overflow[0].mailto).toContain('mailto:ada@example.com');
    // No-email organizer → plain text (null mailto).
    expect(chip?.overflow[1].mailto).toBeNull();
  });
});

describe('isMeetingOrganizedByViewer', () => {
  const meetingBy = (createdBy: { name: string; username: string; email: string }, extra: Partial<Meeting> = {}): Meeting =>
    ({ created_by: createdBy, ...extra }) as Meeting;

  const ada = { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' };
  const grace = { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' };

  it('matches when created_by is the viewer', () => {
    expect(isMeetingOrganizedByViewer(meetingBy(ada), 'alovelace')).toBe(true);
  });

  it('ignores case and any auth-provider prefix on the viewer username', () => {
    expect(isMeetingOrganizedByViewer(meetingBy(ada), 'auth0|ALovelace')).toBe(true);
  });

  it('does not match a meeting created by someone else', () => {
    expect(isMeetingOrganizedByViewer(meetingBy(grace), 'alovelace')).toBe(false);
  });

  it('ignores the organizer FGA flag — inherited manage grants must not widen the filter', () => {
    // Staff regression: `organizer: true` means "can manage", not "created". Matching on it would
    // surface every meeting a staff member has an inherited grant on.
    expect(isMeetingOrganizedByViewer(meetingBy(grace, { organizer: true }), 'alovelace')).toBe(false);
  });

  it('does not match service-account or empty created_by', () => {
    expect(isMeetingOrganizedByViewer(meetingBy({ name: 'Zoom Webhooks', username: 'zoom.webhooks', email: '' }), 'zoom.webhooks')).toBe(false);
    expect(isMeetingOrganizedByViewer(meetingBy({ name: '', username: '', email: '' }), 'alovelace')).toBe(false);
    expect(isMeetingOrganizedByViewer({} as Meeting, 'alovelace')).toBe(false);
    expect(isMeetingOrganizedByViewer(null, 'alovelace')).toBe(false);
  });

  it('never matches when the viewer is unresolved — an empty viewer must not select every meeting', () => {
    expect(isMeetingOrganizedByViewer(meetingBy(ada), null)).toBe(false);
    expect(isMeetingOrganizedByViewer(meetingBy(ada), '')).toBe(false);
    expect(isMeetingOrganizedByViewer(meetingBy({ name: 'No Username', username: '', email: 'x@example.com' }), '')).toBe(false);
  });

  it('matches a host-flagged viewer when the surface supplies hosts', () => {
    const hosts = [{ first_name: 'Grace', last_name: 'Hopper', username: 'ghopper', email: 'grace@example.com', host: true }];
    expect(isMeetingOrganizedByViewer(meetingBy(ada), 'ghopper', hosts)).toBe(true);
    expect(isMeetingOrganizedByViewer(meetingBy(ada), 'alovelace', hosts)).toBe(true);
  });

  it('matches the owner, and a transferred meeting no longer matches its original creator', () => {
    const transferred = meetingBy(ada, { owner: grace });

    expect(isMeetingOrganizedByViewer(transferred, 'ghopper')).toBe(true);
    // Owner replaces the creator slot — after transfer the original creator drops out of the filter.
    expect(isMeetingOrganizedByViewer(transferred, 'alovelace')).toBe(false);
  });

  it('does not match a service-account owner and falls back to created_by matching', () => {
    const webhookOwned = meetingBy(ada, { owner: { name: 'Zoom Webhooks', username: 'zoom.webhooks', email: '' } });

    expect(isMeetingOrganizedByViewer(webhookOwned, 'zoom.webhooks')).toBe(false);
    expect(isMeetingOrganizedByViewer(webhookOwned, 'alovelace')).toBe(true);
  });

  it('agrees with the chip: the filter matches exactly when the chip renders an "Organized by you" entry', () => {
    const cases: { meeting: Meeting; viewer: string | null }[] = [
      { meeting: meetingBy(ada), viewer: 'alovelace' },
      { meeting: meetingBy(ada), viewer: 'auth0|alovelace' },
      { meeting: meetingBy(grace), viewer: 'alovelace' },
      { meeting: meetingBy(grace, { organizer: true }), viewer: 'alovelace' },
      { meeting: meetingBy({ name: 'Zoom Webhooks', username: 'zoom.webhooks', email: '' }), viewer: 'zoom.webhooks' },
      { meeting: meetingBy(ada), viewer: null },
    ];

    for (const { meeting, viewer } of cases) {
      const chip = buildMeetingOrganizerChip(collectMeetingOrganizers(meeting), viewer);
      const chipSaysYou = !!chip && [chip.primary, ...chip.overflow].some((link) => link.isYou);
      expect(isMeetingOrganizedByViewer(meeting, viewer)).toBe(chipSaysYou);
    }
  });
});

describe('isUnresolvableParticipantName', () => {
  it('is true for empty or placeholder names', () => {
    expect(isUnresolvableParticipantName('', '')).toBe(true);
    expect(isUnresolvableParticipantName(null, undefined)).toBe(true);
    expect(isUnresolvableParticipantName('unknown', 'unknown')).toBe(true);
    expect(isUnresolvableParticipantName('[unknown]', '[unknown]')).toBe(true);
    expect(isUnresolvableParticipantName('  Unknown  ', '')).toBe(true);
  });

  it('is false when at least one part is a real name', () => {
    expect(isUnresolvableParticipantName('Ada', '')).toBe(false);
    expect(isUnresolvableParticipantName('', 'Lovelace')).toBe(false);
    expect(isUnresolvableParticipantName('unknown', 'Lovelace')).toBe(false);
  });
});

describe('compareMeetingPeopleByHostThenName', () => {
  it('floats hosts to the top, sinks unresolvable rows to the bottom, sorts by first name within a tier', () => {
    const people = [
      { first_name: 'Zed', last_name: 'Zephyr', host: false },
      { first_name: '', last_name: '', host: false }, // unresolvable → bottom
      { first_name: 'Grace', last_name: 'Hopper', host: true }, // host → top
      { first_name: 'Ada', last_name: 'Lovelace', host: false },
      { first_name: 'Alan', last_name: 'Turing', host: true }, // host → top
      { first_name: 'unknown', last_name: '[unknown]', host: false }, // unresolvable → bottom
    ];

    const ordered = [...people].sort(compareMeetingPeopleByHostThenName).map((p) => `${p.first_name} ${p.last_name}`.trim());

    expect(ordered).toEqual(['Alan Turing', 'Grace Hopper', 'Ada Lovelace', 'Zed Zephyr', '', 'unknown [unknown]']);
  });

  it('keeps an unnamed host at the top, not the bottom', () => {
    const people = [
      { first_name: 'Ada', last_name: 'Lovelace', host: false },
      { first_name: '', last_name: '', host: true }, // unnamed host → still top
      { first_name: 'unknown', last_name: '[unknown]', host: false }, // unresolvable non-host → bottom
    ];

    const ordered = [...people].sort(compareMeetingPeopleByHostThenName);
    expect(ordered[0].host).toBe(true);
    expect(`${ordered[2].first_name} ${ordered[2].last_name}`.trim()).toBe('unknown [unknown]');
  });
});

function summaryResource(id: string, data: Partial<PastMeetingSummary> & { content?: string; edited_content?: string }): QueryServiceItem<PastMeetingSummary> {
  return {
    id,
    type: 'v1_past_meeting_summary',
    data: data as PastMeetingSummary,
  };
}

describe('selectPrimaryPastMeetingSummary', () => {
  it('returns null for empty or undefined input', () => {
    expect(selectPrimaryPastMeetingSummary([])).toBeNull();
    expect(selectPrimaryPastMeetingSummary(undefined)).toBeNull();
  });

  it('returns a single empty-content record unchanged', () => {
    const resources = [summaryResource('empty-1', { uid: 'empty-1', content: '' })];

    expect(selectPrimaryPastMeetingSummary(resources)?.uid).toBe('empty-1');
  });

  it('prefers a content-bearing record when an empty one sorts first (LFXV2-2222)', () => {
    const resources = [
      summaryResource('empty-first', { uid: 'empty-first', content: '' }),
      summaryResource('content-second', { uid: 'content-second', content: 'AI generated summary text' }),
    ];

    expect(selectPrimaryPastMeetingSummary(resources)?.uid).toBe('content-second');
  });

  it('returns the newest summary when multiple records have content', () => {
    const resources = [
      summaryResource('older', {
        uid: 'older',
        content: 'Older summary',
        updated_at: '2026-01-01T10:00:00Z',
      }),
      summaryResource('newer', {
        uid: 'newer',
        content: 'Newer summary',
        updated_at: '2026-03-01T10:00:00Z',
      }),
    ];

    expect(selectPrimaryPastMeetingSummary(resources)?.uid).toBe('newer');
  });

  it('falls back to the first record when all summaries are empty, even with differing timestamps', () => {
    const resources = [
      summaryResource('first', { uid: 'first', content: '', updated_at: '2026-01-01T10:00:00Z' }),
      summaryResource('second', { uid: 'second', content: '', updated_at: '2026-06-01T10:00:00Z' }),
    ];

    expect(selectPrimaryPastMeetingSummary(resources)?.uid).toBe('first');
  });

  it('selects content over empty even when the content record lacks timestamps', () => {
    const resources = [
      summaryResource('empty-with-ts', {
        uid: 'empty-with-ts',
        content: '',
        updated_at: '2026-06-01T10:00:00Z',
      }),
      summaryResource('content-no-ts', { uid: 'content-no-ts', content: 'Summary without timestamps' }),
    ];

    expect(selectPrimaryPastMeetingSummary(resources)?.uid).toBe('content-no-ts');
  });

  it('treats whitespace-only content as empty and prefers a genuinely content-bearing record', () => {
    const resources = [
      summaryResource('whitespace-first', { uid: 'whitespace-first', content: '   ' }),
      summaryResource('real-content', { uid: 'real-content', content: 'Actual summary text' }),
    ];

    expect(selectPrimaryPastMeetingSummary(resources)?.uid).toBe('real-content');
  });

  it('falls back to created_at for recency when updated_at is absent', () => {
    const resources = [
      summaryResource('older-created', {
        uid: 'older-created',
        content: 'Older summary',
        created_at: '2026-01-01T10:00:00Z',
      }),
      summaryResource('newer-created', {
        uid: 'newer-created',
        content: 'Newer summary',
        created_at: '2026-03-01T10:00:00Z',
      }),
    ];

    expect(selectPrimaryPastMeetingSummary(resources)?.uid).toBe('newer-created');
  });
});

describe('resolveMeetingCalendarColors', () => {
  it('returns default blue for active meetings', () => {
    expect(resolveMeetingCalendarColors(false)).toEqual({ ...MEETING_TYPE_COLORS['default'], text: lfxColors.white });
  });

  it('returns lighter blue for past meetings', () => {
    expect(resolveMeetingCalendarColors(false, true)).toEqual(PAST_MEETING_CALENDAR_COLOR);
  });

  it('returns cancelled grey regardless of past flag', () => {
    expect(resolveMeetingCalendarColors(true, true)).toEqual(CANCELLED_COLOR);
  });
});

describe('resolveVoteCalendarColors', () => {
  it('returns amber for active vote deadlines', () => {
    expect(resolveVoteCalendarColors(false)).toEqual(VOTE_COLOR);
  });

  it('returns lighter amber for past vote deadlines', () => {
    expect(resolveVoteCalendarColors(true)).toEqual(PAST_VOTE_CALENDAR_COLOR);
  });
});

describe('resolveSurveyCalendarColors', () => {
  it('returns violet for active survey cutoffs', () => {
    expect(resolveSurveyCalendarColors(false)).toEqual(SURVEY_COLOR);
  });

  it('returns lighter violet for past survey cutoffs', () => {
    expect(resolveSurveyCalendarColors(true)).toEqual(PAST_SURVEY_CALENDAR_COLOR);
  });
});

describe('isCalendarDeadlinePast', () => {
  it('returns false for a future deadline', () => {
    expect(isCalendarDeadlinePast('2099-01-01T00:00:00Z', new Date('2026-01-01T00:00:00Z'))).toBe(false);
  });

  it('returns true when the deadline has passed', () => {
    expect(isCalendarDeadlinePast('2026-01-01T00:00:00Z', new Date('2026-01-02T00:00:00Z'))).toBe(true);
  });
});

describe('isVoteCalendarEventPast', () => {
  it('returns true for ended votes', () => {
    expect(isVoteCalendarEventPast({ end_time: '2099-01-01T00:00:00Z', status: PollStatus.ENDED } as Vote)).toBe(true);
  });

  it('returns true when the close time has passed', () => {
    expect(isVoteCalendarEventPast({ end_time: '2026-01-01T00:00:00Z', status: PollStatus.ACTIVE } as Vote, new Date('2026-01-02T00:00:00Z'))).toBe(true);
  });
});

describe('isMeetingOccurrenceCancelled', () => {
  const occurrence = { occurrence_id: '123', start_time: '2026-07-01T15:00:00Z', duration: 60, status: 'active' } as MeetingOccurrence;

  it('returns true when occurrence status is cancel', () => {
    expect(isMeetingOccurrenceCancelled({ ...occurrence, status: 'cancel' }, [])).toBe(true);
  });

  it('returns true when occurrence id is in cancelled_occurrences', () => {
    expect(isMeetingOccurrenceCancelled(occurrence, ['123'])).toBe(true);
  });

  it('returns false for active occurrences with no cancelled ids', () => {
    expect(isMeetingOccurrenceCancelled(occurrence, ['999'])).toBe(false);
  });
});

describe('isPastMeetingCompositeId', () => {
  it('matches composite past-meeting ids', () => {
    expect(isPastMeetingCompositeId('99152950841-1630560600000')).toBe(true);
  });

  it('rejects plain meeting ids and malformed composites', () => {
    expect(isPastMeetingCompositeId('99152950841')).toBe(false);
    expect(isPastMeetingCompositeId('99152950841-1630560600000-extra')).toBe(false);
  });
});

describe('isOccurrencePast', () => {
  it('uses the same 40-minute post-end buffer as buildMeetingOccurrenceRoute', () => {
    vi.useFakeTimers();
    const start = '2026-07-01T15:00:00Z';
    vi.setSystemTime(new Date(new Date(start).getTime() + 60 * 60_000 + 30 * 60_000));
    expect(isOccurrencePast(start, 60)).toBe(false);
    vi.useRealTimers();
  });
});

describe('buildMeetingOccurrenceRoute', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes upcoming occurrences with ?occurrence=', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));

    const route = buildMeetingOccurrenceRoute('99152950841', '2026-07-15T15:00:00Z', 60);

    expect(route).toEqual({
      path: ['/meetings', '99152950841'],
      queryParams: { occurrence: new Date('2026-07-15T15:00:00Z').getTime().toString() },
    });
  });

  it('routes ended occurrences to the composite past URL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T12:00:00Z'));

    const start = '2026-07-01T15:00:00Z';
    const route = buildMeetingOccurrenceRoute('99152950841', start, 60);

    expect(route).toEqual({
      path: ['/meetings', `99152950841-${new Date(start).getTime()}`],
      queryParams: undefined,
    });
  });

  it('treats the meeting as upcoming inside the 40-minute post-end buffer', () => {
    vi.useFakeTimers();
    const start = '2026-07-01T15:00:00Z';
    vi.setSystemTime(new Date(new Date(start).getTime() + 60 * 60_000 + 30 * 60_000));

    const route = buildMeetingOccurrenceRoute('99152950841', start, 60);

    expect(route.path).toEqual(['/meetings', '99152950841']);
    expect(route.queryParams?.['occurrence']).toBe(new Date(start).getTime().toString());
  });

  it('preserves password query params', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));

    const route = buildMeetingOccurrenceRoute('99152950841', '2026-07-15T15:00:00Z', 60, { password: 'secret' });

    expect(route.queryParams).toEqual({
      password: 'secret',
      occurrence: new Date('2026-07-15T15:00:00Z').getTime().toString(),
    });
  });

  it('uses the canonical past-meeting resource id without double-encoding', () => {
    const route = buildMeetingOccurrenceRoute('99152950841', '2026-07-01T15:00:00Z', 60, {
      pastMeetingResourceId: '99152950841-1630560600000',
      password: 'secret',
    });

    expect(route).toEqual({
      path: ['/meetings', '99152950841-1630560600000'],
      queryParams: { password: 'secret' },
    });
  });

  it('detects an already-composite meeting id', () => {
    const route = buildMeetingOccurrenceRoute('99152950841-1630560600000', '2026-07-01T15:00:00Z', 60);

    expect(route).toEqual({
      path: ['/meetings', '99152950841-1630560600000'],
      queryParams: undefined,
    });
  });
});

describe('getMeetingSeriesUid', () => {
  it('returns meeting_id for past-meeting payloads whose id is the composite occurrence id', () => {
    const past = { id: 'series-1-1789551000000', meeting_id: 'series-1' } as PastMeeting;

    expect(getMeetingSeriesUid(past)).toBe('series-1');
  });

  it('returns id for live meeting payloads without meeting_id', () => {
    const meeting = { id: 'series-1' } as Meeting;

    expect(getMeetingSeriesUid(meeting)).toBe('series-1');
  });

  it('falls back to id when meeting_id is present but empty', () => {
    const past = { id: 'series-1', meeting_id: '' } as PastMeeting;

    expect(getMeetingSeriesUid(past)).toBe('series-1');
  });
});

describe('buildOccurrenceNavTimeline', () => {
  const T1 = Date.UTC(2026, 6, 16, 9, 30); // Jul 16
  const T2 = Date.UTC(2026, 6, 23, 9, 30); // Jul 23
  const T3 = Date.UTC(2026, 6, 30, 9, 30); // Jul 30 (current)
  const T4 = Date.UTC(2026, 7, 6, 9, 30); // Aug 6

  const live = (instant: number, overrides: Partial<MeetingOccurrence> = {}): MeetingOccurrence => ({
    occurrence_id: String(Math.floor(instant / 1000)),
    start_time: new Date(instant).toISOString(),
    duration: 30,
    ...overrides,
  });

  const pastRecord = (instant: number, overrides: Partial<PastOccurrenceSummary> = {}): PastOccurrenceSummary => ({
    meeting_and_occurrence_id: `series-uid-${instant}`,
    scheduled_start_time: new Date(instant).toISOString(),
    scheduled_end_time: new Date(instant + 30 * 60000).toISOString(),
    ...overrides,
  });

  it('merges past records before live occurrences in ascending order', () => {
    const result = buildOccurrenceNavTimeline([live(T3), live(T4)], { past: [pastRecord(T2), pastRecord(T1)], future: [] });

    expect(result.map((o) => new Date(o.start_time).getTime())).toEqual([T1, T2, T3, T4]);
    expect(result[0].meeting_and_occurrence_id).toBe(`series-uid-${T1}`);
    expect(result[2].meeting_and_occurrence_id).toBeUndefined();
  });

  it('prefers the live entry when a past record exists for the same instant (in-progress occurrence)', () => {
    const result = buildOccurrenceNavTimeline([live(T3)], { past: [pastRecord(T3)], future: [] });

    expect(result).toHaveLength(1);
    expect(result[0].meeting_and_occurrence_id).toBeUndefined();
  });

  it('uses endpoint future occurrences when no live payload is available (past page)', () => {
    const result = buildOccurrenceNavTimeline([], { past: [pastRecord(T1)], future: [live(T3), live(T4)] });

    expect(result.map((o) => new Date(o.start_time).getTime())).toEqual([T1, T3, T4]);
  });

  it('filters cancelled endpoint future occurrences via cancelled_occurrences ids', () => {
    const cancelled = live(T4);
    const result = buildOccurrenceNavTimeline([], {
      past: [],
      future: [live(T3), cancelled],
      cancelled_occurrences: [cancelled.occurrence_id],
    });

    expect(result.map((o) => new Date(o.start_time).getTime())).toEqual([T3]);
  });

  it('derives the past instant from the composite id suffix, not scheduled_start_time', () => {
    // Composite suffix and scheduled_start_time disagree — the suffix is authoritative
    const result = buildOccurrenceNavTimeline([], {
      past: [pastRecord(T1, { meeting_and_occurrence_id: `series-uid-${T2}` })],
      future: [],
    });

    expect(new Date(result[0].start_time).getTime()).toBe(T2);
    expect(result[0].occurrence_id).toBe(String(Math.floor(T2 / 1000)));
  });

  it('skips past records whose composite id has no 13-digit millisecond suffix', () => {
    const result = buildOccurrenceNavTimeline([], {
      past: [pastRecord(T1, { meeting_and_occurrence_id: 'series-uid-only' })],
      future: [],
    });

    expect(result).toHaveLength(0);
  });

  it('computes past duration from scheduled times with a fallback for missing end times', () => {
    const result = buildOccurrenceNavTimeline(
      [],
      {
        past: [pastRecord(T1), pastRecord(T2, { scheduled_end_time: undefined })],
        future: [],
      },
      45
    );

    expect(result[0].duration).toBe(30);
    expect(result[1].duration).toBe(45);
  });
});

describe('sanitizeMeetingCommittees', () => {
  it('returns [] for null, undefined, and empty input', () => {
    expect(sanitizeMeetingCommittees(null)).toEqual([]);
    expect(sanitizeMeetingCommittees(undefined)).toEqual([]);
    expect(sanitizeMeetingCommittees([])).toEqual([]);
  });

  it('drops null entries, blank uids, and keeps valid committees', () => {
    const valid: MeetingCommittee = { uid: 'group-1', name: 'TSC' };
    const result = sanitizeMeetingCommittees([null, { uid: null as unknown as string }, { uid: '' }, { uid: '   ' }, valid, undefined]);

    expect(result).toEqual([valid]);
  });
});

describe('sanitizeMeetingCommitteeUids', () => {
  it('returns [] for null, undefined, and empty input', () => {
    expect(sanitizeMeetingCommitteeUids(null)).toEqual([]);
    expect(sanitizeMeetingCommitteeUids(undefined)).toEqual([]);
    expect(sanitizeMeetingCommitteeUids([])).toEqual([]);
  });

  it('drops null, undefined, and blank uids', () => {
    expect(sanitizeMeetingCommitteeUids([null, undefined, '', '   ', 'group-1', 'group-2'])).toEqual(['group-1', 'group-2']);
  });
});

/** Builds a minimal MeetingRegistrant fixture; extractRegistrantEmails only reads `email`. */
function registrant(email: string): MeetingRegistrant {
  return { email } as MeetingRegistrant;
}

describe('extractRegistrantEmails', () => {
  it('returns trimmed emails and counts registrants with no email', () => {
    const result = extractRegistrantEmails([registrant('a@example.com'), registrant('  b@example.com  '), registrant(''), registrant('   ')]);

    expect(result.emails).toEqual(['a@example.com', 'b@example.com']);
    expect(result.skippedNoEmail).toBe(2);
  });

  it('de-duplicates case-insensitively, preserving first-seen casing', () => {
    const result = extractRegistrantEmails([registrant('Person@Example.com'), registrant('person@example.com'), registrant('PERSON@EXAMPLE.COM')]);

    expect(result.emails).toEqual(['Person@Example.com']);
    expect(result.skippedNoEmail).toBe(0);
  });

  it('handles an all-blank roster', () => {
    const result = extractRegistrantEmails([registrant(''), registrant('  '), registrant(undefined as unknown as string)]);

    expect(result.emails).toEqual([]);
    expect(result.skippedNoEmail).toBe(3);
  });

  it('returns an empty result for empty or nullish input', () => {
    expect(extractRegistrantEmails([])).toEqual({ emails: [], skippedNoEmail: 0 });
    expect(extractRegistrantEmails(null)).toEqual({ emails: [], skippedNoEmail: 0 });
    expect(extractRegistrantEmails(undefined)).toEqual({ emails: [], skippedNoEmail: 0 });
  });
});

describe('filterUnlistedEmails', () => {
  it('drops emails already present in alreadyListed, case-insensitively', () => {
    const result = filterUnlistedEmails(['a@example.com', 'B@Example.com', 'c@example.com'], ['a@example.com', 'b@example.com']);

    expect(result).toEqual(['c@example.com']);
  });

  it('returns all emails unchanged when alreadyListed is empty', () => {
    expect(filterUnlistedEmails(['a@example.com'], [])).toEqual(['a@example.com']);
  });

  it('returns an empty array when emails is empty', () => {
    expect(filterUnlistedEmails([], ['a@example.com'])).toEqual([]);
  });
});

describe('buildImportSummary', () => {
  it('reports a single added address in singular form', () => {
    expect(buildImportSummary('Q3 Roadmap', 1, 0, 0)).toBe('Added 1 address from "Q3 Roadmap".');
  });

  it('reports multiple added addresses in plural form', () => {
    expect(buildImportSummary('Q3 Roadmap', 3, 0, 0)).toBe('Added 3 addresses from "Q3 Roadmap".');
  });

  it('appends an already-listed count when present', () => {
    expect(buildImportSummary('Q3 Roadmap', 2, 1, 0)).toBe('Added 2 addresses from "Q3 Roadmap" — 1 already listed.');
  });

  it('appends a singular skipped-no-email note', () => {
    expect(buildImportSummary('Q3 Roadmap', 2, 0, 1)).toBe('Added 2 addresses from "Q3 Roadmap" — 1 registrant had no email and was skipped.');
  });

  it('appends a plural skipped-no-email note', () => {
    expect(buildImportSummary('Q3 Roadmap', 2, 0, 3)).toBe('Added 2 addresses from "Q3 Roadmap" — 3 registrants had no email and were skipped.');
  });

  it('combines already-listed and skipped-no-email notes', () => {
    expect(buildImportSummary('Q3 Roadmap', 1, 2, 1)).toBe('Added 1 address from "Q3 Roadmap" — 2 already listed — 1 registrant had no email and was skipped.');
  });

  it('reports zero added addresses in plural form', () => {
    expect(buildImportSummary('Q3 Roadmap', 0, 4, 0)).toBe('Added 0 addresses from "Q3 Roadmap" — 4 already listed.');
  });
});
