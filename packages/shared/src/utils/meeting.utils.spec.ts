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
  buildMeetingOrganizerChip,
  buildMeetingOrganizerMailto,
  buildRecurrenceSummary,
  collectMeetingOrganizers,
  compareMeetingPeopleByHostThenName,
  getMeetingOrganizerDisplayName,
  isUnresolvableParticipantName,
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
    expect(chip?.primary.key).toBe('alovelace');
    expect(chip?.primary.mailto).toContain('mailto:ada@example.com?subject=Sync');
    expect(chip?.overflow).toEqual([]);
  });

  it('gives same-named organizers distinct track keys (from username/email)', () => {
    const dupeA = { name: 'Alex Kim', username: 'akim1', email: 'a1@x.com' };
    const dupeB = { name: 'Alex Kim', username: 'akim2', email: 'a2@x.com' };
    const chip = buildMeetingOrganizerChip([dupeA, dupeB]);
    expect(chip?.primary.key).toBe('akim1');
    expect(chip?.overflow[0].key).toBe('akim2');
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
