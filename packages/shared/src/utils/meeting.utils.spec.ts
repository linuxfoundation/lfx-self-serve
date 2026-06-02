// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// meeting.utils transitively imports @angular/common/http (HttpParams), whose declarations need the
// Angular JIT compiler when loaded outside an Angular bootstrap (as under Vitest). Importing the
// compiler first provides that facade so the module can be imported.
import '@angular/compiler';

import { describe, expect, it } from 'vitest';

import { PastMeeting } from '../interfaces';
import { sortPastMeetingsDescending } from './meeting.utils';

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
