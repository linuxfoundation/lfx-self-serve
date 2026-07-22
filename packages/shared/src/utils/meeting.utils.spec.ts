// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting.utils transitively imports @angular/common/http (HttpParams), whose declarations need the
// Angular JIT compiler when loaded outside an Angular bootstrap (as under Vitest). Importing the
// compiler first provides that facade so the module can be imported.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { RecurrenceType } from '../enums';
import {
  CustomRecurrencePattern,
  Meeting,
  MeetingOccurrence,
  MeetingRecurrence,
  MeetingRegistrant,
  PastMeeting,
  PastMeetingSummary,
  QueryServiceItem,
} from '../interfaces';
import {
  buildRecurrenceSummary,
  extractRegistrantEmails,
  normalizeIndexedMeetingAiSummary,
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
