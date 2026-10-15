// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETING_OCCURRENCES_PAGE_DEFAULT_LIMIT, MEETING_OCCURRENCES_PAGE_MAX_LIMIT } from '@lfx-one/shared/constants';
import type { MeetingTimelineOccurrence, PastOccurrenceSummary } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { pageOccurrenceTimeline, parseOccurrencesPageRequest } from './meeting-occurrences.helper';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 5, 15, 0);

// Weekly occurrences, given out of order to show the helper sorts them.
const past: PastOccurrenceSummary[] = [3, 0, 2, 1, 4].map((week) => ({
  meeting_and_occurrence_id: `99152950841-${T0 + week * 7 * DAY}`,
  scheduled_start_time: new Date(T0 + week * 7 * DAY).toISOString(),
}));
const future: MeetingTimelineOccurrence[] = [7, 5, 6, 8].map((week) => ({
  occurrence_id: String((T0 + week * 7 * DAY) / 1000),
  start_time: new Date(T0 + week * 7 * DAY).toISOString(),
  duration: 30,
}));
const pastWeeks = (page: PastOccurrenceSummary[]): number[] => page.map((o) => (Date.parse(o.scheduled_start_time) - T0) / (7 * DAY));
const futureWeeks = (page: MeetingTimelineOccurrence[]): number[] => page.map((o) => (Date.parse(o.start_time) - T0) / (7 * DAY));

const reqWith = (query: Record<string, unknown>): Request => ({ query, path: '/public/api/meetings/1/occurrences' }) as unknown as Request;

describe('parseOccurrencesPageRequest', () => {
  it('is null with no paging parameter, which keeps the whole timeline', () => {
    expect(parseOccurrencesPageRequest(reqWith({}))).toBeNull();
  });

  it('defaults the limit, and reads a direction and a cursor', () => {
    expect(parseOccurrencesPageRequest(reqWith({ direction: 'past' }))).toEqual({ limit: MEETING_OCCURRENCES_PAGE_DEFAULT_LIMIT, direction: 'past' });
    expect(parseOccurrencesPageRequest(reqWith({ limit: '5', direction: 'future', cursor: String(T0) }))).toEqual({
      limit: 5,
      direction: 'future',
      cursor: T0,
    });
  });

  it.each([
    [{ limit: '0' }, 'limit'],
    [{ limit: String(MEETING_OCCURRENCES_PAGE_MAX_LIMIT + 1) }, 'limit'],
    [{ limit: '2.5' }, 'limit'],
    [{ limit: ['5', '6'] }, 'limit'],
    [{ direction: 'sideways' }, 'direction'],
    [{ direction: 'past', cursor: '1736089200' }, 'cursor'],
    [{ cursor: String(T0) }, 'direction'],
  ])('refuses %o with a 400 on %s', (query, field) => {
    expect(() => parseOccurrencesPageRequest(reqWith(query))).toThrow(
      expect.objectContaining({ statusCode: 400, validationErrors: [expect.objectContaining({ field })] })
    );
  });
});

describe('pageOccurrenceTimeline', () => {
  it('gives the window around now: the latest past and the first upcoming, both ascending', () => {
    const page = pageOccurrenceTimeline(past, future, { limit: 2 });

    expect(pastWeeks(page.past)).toEqual([3, 4]);
    expect(futureWeeks(page.future)).toEqual([5, 6]);
    expect(page).toEqual(
      expect.objectContaining({
        past_has_more: true,
        future_has_more: true,
        past_cursor: String(T0 + 3 * 7 * DAY),
        future_cursor: String(T0 + 6 * 7 * DAY),
      })
    );
  });

  it('pages back through the past with the cursor until there is no more', () => {
    const first = pageOccurrenceTimeline(past, future, { limit: 2, direction: 'past' });
    const second = pageOccurrenceTimeline(past, future, { limit: 2, direction: 'past', cursor: Number(first.past_cursor) });
    const last = pageOccurrenceTimeline(past, future, { limit: 2, direction: 'past', cursor: Number(second.past_cursor) });

    expect(first.future).toEqual([]);
    expect([pastWeeks(first.past), pastWeeks(second.past), pastWeeks(last.past)]).toEqual([[3, 4], [1, 2], [0]]);
    expect(last.past_has_more).toBe(false);
    expect(last).not.toHaveProperty('past_cursor');
  });

  it('pages forward through the future with the cursor', () => {
    const first = pageOccurrenceTimeline(past, future, { limit: 3, direction: 'future' });
    const next = pageOccurrenceTimeline(past, future, { limit: 3, direction: 'future', cursor: Number(first.future_cursor) });

    expect(first.past).toEqual([]);
    expect(futureWeeks(first.future)).toEqual([5, 6, 7]);
    expect(futureWeeks(next.future)).toEqual([8]);
    expect(next.future_has_more).toBe(false);
  });

  it('reports no more when a side fits in one page', () => {
    const page = pageOccurrenceTimeline(past, future, { limit: 10 });

    expect(page.past).toHaveLength(5);
    expect(page.future).toHaveLength(4);
    expect(page).toEqual(expect.objectContaining({ past_has_more: false, future_has_more: false }));
    expect(page).not.toHaveProperty('past_cursor');
    expect(page).not.toHaveProperty('future_cursor');
  });
});
