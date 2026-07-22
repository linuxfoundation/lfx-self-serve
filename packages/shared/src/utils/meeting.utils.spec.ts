// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting.utils transitively imports @angular/common/http (HttpParams), whose declarations need the
// Angular JIT compiler when loaded outside an Angular bootstrap (as under Vitest). Importing the
// compiler first provides that facade so the module can be imported.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { RecurrenceType } from '../enums';
import { CustomRecurrencePattern, Meeting, MeetingOccurrence, MeetingRecurrence, PastMeeting, PastMeetingSummary, QueryServiceItem } from '../interfaces';
import {
  buildMeetingOrganizerDisplay,
  buildRecurrenceSummary,
  collectMeetingOrganizers,
  getMeetingOrganizerDisplayName,
  normalizeIndexedMeetingAiSummary,
  resolveMeetingOrganizer,
  resolveOccurrenceRecurrence,
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

describe('resolveMeetingOrganizer', () => {
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
  it('returns the human created_by as the sole organizer', () => {
    const meeting = { created_by: { name: 'Ada Lovelace', username: 'ada', email: 'ada@example.com' } } as Meeting;

    expect(collectMeetingOrganizers(meeting)).toEqual([{ name: 'Ada Lovelace', username: 'ada', email: 'ada@example.com' }]);
  });

  it('falls back to all host-flagged candidates when created_by is not a human', () => {
    const meeting = { created_by: { name: 'Zoom Webhooks', username: 'zoom.webhooks', email: '' } } as Meeting;
    const hosts = [
      { first_name: 'Grace', last_name: 'Hopper', username: 'ghopper', email: 'grace@example.com', host: true },
      { first_name: 'Alan', last_name: 'Turing', username: 'aturing', email: 'alan@example.com', host: true },
      { first_name: 'Not', last_name: 'Host', host: false },
    ];

    const organizers = collectMeetingOrganizers(meeting, hosts);
    expect(organizers).toHaveLength(2);
    expect(organizers.map((o) => o.name)).toEqual(['Grace Hopper', 'Alan Turing']);
  });

  it('returns an empty array when nothing resolves', () => {
    expect(collectMeetingOrganizers({} as Meeting)).toEqual([]);
    expect(collectMeetingOrganizers({} as Meeting, [{ first_name: 'A', last_name: 'B', host: false }])).toEqual([]);
  });
});

describe('buildMeetingOrganizerDisplay', () => {
  const ada = { name: 'Ada Lovelace', username: 'alovelace', email: 'ada@example.com' };
  const grace = { name: 'Grace Hopper', username: 'ghopper', email: 'grace@example.com' };
  const alan = { name: 'Alan Turing', username: 'aturing', email: 'alan@example.com' };

  it('returns null when there are no organizers', () => {
    expect(buildMeetingOrganizerDisplay([])).toBeNull();
  });

  it('labels a single organizer by name', () => {
    expect(buildMeetingOrganizerDisplay([ada])?.label).toBe('Organized by Ada Lovelace');
  });

  it('uses the "you" variant when the primary organizer matches the viewer (case/prefix-insensitive)', () => {
    expect(buildMeetingOrganizerDisplay([ada], 'ALOVELACE')?.label).toBe('Organized by you');
    expect(buildMeetingOrganizerDisplay([ada], 'auth0|alovelace')?.isYou).toBe(true);
    expect(buildMeetingOrganizerDisplay([ada], 'someone-else')?.isYou).toBe(false);
  });

  it('appends a "+N" overflow and exposes the overflow names for a popover', () => {
    const display = buildMeetingOrganizerDisplay([grace, alan, ada]);
    expect(display?.label).toBe('Organized by Grace Hopper +2');
    expect(display?.count).toBe(3);
    expect(display?.overflowNames).toEqual(['Alan Turing', 'Ada Lovelace']);
  });

  it('combines the "you" variant with the "+N" overflow', () => {
    expect(buildMeetingOrganizerDisplay([grace, alan], 'ghopper')?.label).toBe('Organized by you +1');
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
