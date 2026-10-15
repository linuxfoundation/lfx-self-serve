// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MEETING_OCCURRENCES_PAGE_DEFAULT_LIMIT, MEETING_OCCURRENCES_PAGE_MAX_LIMIT } from '@lfx-one/shared/constants';
import { MeetingOccurrencesPageRequest, MeetingTimelineOccurrence, PastOccurrenceSummary, PublicMeetingOccurrencesResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { ServiceValidationError } from '../errors';

const OPERATION = 'get_public_meeting_occurrences';

/**
 * Reads the paging parameters of `GET /public/api/meetings/:id/occurrences` (E6-02, #3585): `limit`
 * (1 to `MEETING_OCCURRENCES_PAGE_MAX_LIMIT`, default `MEETING_OCCURRENCES_PAGE_DEFAULT_LIMIT`),
 * `direction` (`past` | `future`) and `cursor` (a 13-digit millisecond start, which needs a
 * direction). Null when none is present, so the caller keeps the whole-timeline response V1 reads.
 * Throws a `ServiceValidationError` (400) for a malformed value rather than guessing.
 */
export function parseOccurrencesPageRequest(req: Request): MeetingOccurrencesPageRequest | null {
  const { limit, direction, cursor } = req.query;
  if (limit === undefined && direction === undefined && cursor === undefined) {
    return null;
  }

  const invalid = (field: string, message: string): ServiceValidationError =>
    ServiceValidationError.forField(field, message, { operation: OPERATION, service: 'public_meeting_controller', path: req.path });

  let pageLimit = MEETING_OCCURRENCES_PAGE_DEFAULT_LIMIT;
  if (limit !== undefined) {
    const parsed = typeof limit === 'string' && /^\d+$/.test(limit) ? Number(limit) : NaN;
    if (!(parsed >= 1 && parsed <= MEETING_OCCURRENCES_PAGE_MAX_LIMIT)) {
      throw invalid('limit', `limit must be a whole number from 1 to ${MEETING_OCCURRENCES_PAGE_MAX_LIMIT}`);
    }
    pageLimit = parsed;
  }

  if (direction !== undefined && direction !== 'past' && direction !== 'future') {
    throw invalid('direction', 'direction must be past or future');
  }

  let pageCursor: number | undefined;
  if (cursor !== undefined) {
    if (typeof cursor !== 'string' || !/^\d{13}$/.test(cursor)) {
      throw invalid('cursor', 'cursor must be a 13-digit millisecond timestamp');
    }
    if (direction === undefined) {
      throw invalid('direction', 'cursor needs a direction');
    }
    pageCursor = Number(cursor);
  }

  return { limit: pageLimit, ...(direction && { direction }), ...(pageCursor !== undefined && { cursor: pageCursor }) };
}

/**
 * Cuts one page out of a series timeline (E6-02, #3585). Without a direction it is the window around
 * now: the latest `limit` past occurrences and the first `limit` upcoming ones. With one, it reads that
 * side only, older than the cursor for `past` and later than it for `future`. Both sides stay
 * ascending. Each side reports whether more exist and, when they do, the cursor for the next page.
 */
export function pageOccurrenceTimeline(
  past: PastOccurrenceSummary[],
  future: MeetingTimelineOccurrence[],
  page: MeetingOccurrencesPageRequest
): Pick<PublicMeetingOccurrencesResponse, 'past' | 'future' | 'past_has_more' | 'future_has_more' | 'past_cursor' | 'future_cursor'> {
  const pastStart = (occurrence: PastOccurrenceSummary): number => Date.parse(occurrence.scheduled_start_time);
  const futureStart = (occurrence: MeetingTimelineOccurrence): number => Date.parse(occurrence.start_time);

  let pastPage: PastOccurrenceSummary[] = [];
  let pastHasMore = false;
  if (page.direction !== 'future') {
    const sorted = [...past].sort((a, b) => pastStart(a) - pastStart(b));
    const eligible = page.cursor === undefined ? sorted : sorted.filter((occurrence) => pastStart(occurrence) < (page.cursor as number));
    pastPage = eligible.slice(-page.limit);
    pastHasMore = eligible.length > pastPage.length;
  }

  let futurePage: MeetingTimelineOccurrence[] = [];
  let futureHasMore = false;
  if (page.direction !== 'past') {
    const sorted = [...future].sort((a, b) => futureStart(a) - futureStart(b));
    const eligible = page.cursor === undefined ? sorted : sorted.filter((occurrence) => futureStart(occurrence) > (page.cursor as number));
    futurePage = eligible.slice(0, page.limit);
    futureHasMore = eligible.length > futurePage.length;
  }

  return {
    past: pastPage,
    future: futurePage,
    past_has_more: pastHasMore,
    future_has_more: futureHasMore,
    ...(pastHasMore && { past_cursor: String(pastStart(pastPage[0])) }),
    ...(futureHasMore && { future_cursor: String(futureStart(futurePage[futurePage.length - 1])) }),
  };
}
