// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ITXMeetingResponseResult, MeetingOccurrence, MeetingRsvp, RsvpCounts } from '../interfaces/meeting.interface';

/**
 * Convert an `occurrence_id` string into a millisecond epoch, regardless of the
 * unit the caller happens to hold.
 *
 * Two units live in the LFX system for the same instant (see LFXV2-2864):
 * - Zoom / ITX `/itx/meetings/{id}` occurrences and the meeting-service
 *   `occurrence_calculator.go` output emit **Unix seconds** (10 digits).
 * - `v1_meeting_rsvp` and `v1_past_meeting` records (and every
 *   `meeting_and_occurrence_id` composite) store **Unix milliseconds** (13 digits).
 *
 * Any string equality between an occurrence-side id and an rsvp-side id will fail
 * unless one is normalised first. Normalisation policy: always widen to ms so the
 * result is directly comparable to `Date.getTime()`.
 *
 * Returns `null` when the input is empty or unparseable; callers must treat that
 * as "cannot compare" and skip the RSVP rather than pretend equality.
 */
export function occurrenceIdToMs(occurrenceId: string | null | undefined): number | null {
  if (!occurrenceId) return null;
  const n = Number(occurrenceId);
  if (!Number.isFinite(n) || n <= 0) return null;
  return occurrenceId.length <= 10 ? n * 1000 : n;
}

/**
 * Compare two `occurrence_id` strings while treating seconds and milliseconds as
 * the same instant. Prefer this over `===` anywhere an occurrence-side id may be
 * compared against an rsvp-side id (LFXV2-2864).
 */
export function isSameOccurrenceId(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const am = occurrenceIdToMs(a);
  const bm = occurrenceIdToMs(b);
  return am !== null && bm !== null && am === bm;
}

/**
 * Pick the single RSVP that applies to a given occurrence for one user.
 *
 * Shared between the frontend counts calculator (`calculateRsvpCounts` → per-user
 * grouping) and the BFF single-user lookup (`getMeetingRsvpForCurrentUser`). Both
 * paths were previously doing their own string-equality on `occurrence_id` and
 * both were silently wrong for the same unit-mismatch reason — consolidating
 * here keeps them from drifting apart again.
 *
 * Precedence (newest RSVP wins within each scope):
 * 1. `single` scope whose `occurrence_id` matches this occurrence (unit-normalised).
 * 2. `this_and_following` scope whose anchor (`rsvp.occurrence_id`) is at or
 *    before this occurrence's start.
 * 3. `all` scope (series-wide).
 *
 * The scopes are interleaved in a single "most recent applicable" walk rather
 * than checked in strict tiers so a fresh `this_and_following` correctly
 * overrides an older `all` for future occurrences.
 *
 * @param occurrenceId Occurrence id in either seconds or milliseconds; nullish
 *   means the caller has no per-occurrence context (non-recurring meeting or
 *   aggregate view) — most recent RSVP wins.
 * @param userRsvps All RSVPs from a single user for this meeting.
 */
export function selectApplicableRsvp(occurrenceId: string | null | undefined, userRsvps: MeetingRsvp[]): MeetingRsvp | null {
  if (userRsvps.length === 0) return null;

  // API sends `modified_at`; older payloads fall back through `updated_at` then `created_at`.
  const sortedRsvps = [...userRsvps].sort((a, b) => {
    const dateA = new Date(a.modified_at || a.updated_at || a.created_at).getTime();
    const dateB = new Date(b.modified_at || b.updated_at || b.created_at).getTime();
    return dateB - dateA;
  });

  if (!occurrenceId) {
    return sortedRsvps[0] || null;
  }

  const occurrenceMs = occurrenceIdToMs(occurrenceId);

  for (const rsvp of sortedRsvps) {
    if (rsvp.scope === 'all') {
      return rsvp;
    }

    if (rsvp.scope === 'single') {
      if (isSameOccurrenceId(rsvp.occurrence_id, occurrenceId)) {
        return rsvp;
      }
      continue;
    }

    if (rsvp.scope === 'this_and_following') {
      // The anchor is the specific occurrence at which the T&F starts applying,
      // encoded in `rsvp.occurrence_id`. Comparing against `rsvp.created_at` (the
      // previous behaviour) drifts whenever the row was written before or after
      // the anchor date — e.g. a retroactive T&F or a delayed sync. The anchor
      // itself is the correct semantic gate.
      const anchorMs = occurrenceIdToMs(rsvp.occurrence_id);
      if (anchorMs === null || occurrenceMs === null) continue;
      if (anchorMs <= occurrenceMs) {
        return rsvp;
      }
      continue;
    }
  }

  return null;
}

/**
 * Calculate RSVP counts for a specific occurrence
 * Takes into account RSVP scope (single, all, this_and_following) and uses the most recent RSVP per user
 *
 * @param occurrence - The meeting occurrence to calculate for (or null for non-recurring meetings)
 * @param allRsvps - All RSVPs for the meeting
 * @param _meetingStartTime - Reserved for future use (kept for API compatibility)
 * @returns Object with accepted, declined, maybe, and total counts
 */
export function calculateRsvpCounts(occurrence: MeetingOccurrence | null, allRsvps: MeetingRsvp[], _meetingStartTime?: string): RsvpCounts {
  if (allRsvps.length === 0) {
    return { accepted: 0, declined: 0, maybe: 0, total: 0 };
  }

  const rsvpsByRegistrant = new Map<string, MeetingRsvp[]>();

  for (const rsvp of allRsvps) {
    const key = rsvp.registrant_id;
    if (!rsvpsByRegistrant.has(key)) {
      rsvpsByRegistrant.set(key, []);
    }
    rsvpsByRegistrant.get(key)!.push(rsvp);
  }

  const applicableRsvps: MeetingRsvp[] = [];

  for (const userRsvps of rsvpsByRegistrant.values()) {
    const applicableRsvp = selectApplicableRsvp(occurrence?.occurrence_id, userRsvps);
    if (applicableRsvp) {
      applicableRsvps.push(applicableRsvp);
    }
  }

  const counts: RsvpCounts = {
    accepted: 0,
    declined: 0,
    maybe: 0,
    total: applicableRsvps.length,
  };

  for (const rsvp of applicableRsvps) {
    if (rsvp.response_type === 'accepted') {
      counts.accepted++;
    } else if (rsvp.response_type === 'declined') {
      counts.declined++;
    } else if (rsvp.response_type === 'maybe') {
      counts.maybe++;
    }
  }

  return counts;
}

/**
 * Map an ITX meeting response result to the MeetingRsvp shape used throughout the UI
 *
 * @param result - The raw response from the ITX endpoint
 * @returns A MeetingRsvp object compatible with the rest of the application
 */
export function mapITXResponseToMeetingRsvp(result: ITXMeetingResponseResult): MeetingRsvp {
  return {
    id: result.id,
    meeting_id: result.meeting_id,
    registrant_id: result.registrant_id,
    username: result.username,
    email: result.email,
    response_type: result.response,
    scope: result.scope,
    occurrence_id: result.occurrence_id,
    created_at: result.created_at,
    updated_at: result.updated_at,
  };
}
