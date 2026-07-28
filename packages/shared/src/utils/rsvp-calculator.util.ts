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
  if (typeof occurrenceId !== 'string' || occurrenceId.length === 0) return null;
  const n = Number(occurrenceId);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Values below 1e12 ms (~Sep 2001) are Unix seconds; at/above are already ms.
  // Magnitude cutoff is unit-correct regardless of string formatting (padded zeros,
  // scientific notation) and avoids reading .length on a potentially-tainted value.
  return n < 1e12 ? n * 1000 : n;
}

/**
 * Compare two `occurrence_id` strings while treating seconds and milliseconds as
 * the same instant. Prefer this over `===` anywhere an occurrence-side id may be
 * compared against an rsvp-side id (LFXV2-2864).
 *
 * Both sides go through `occurrenceIdToMs`, so malformed inputs (empty strings,
 * `"0"`, non-numeric) resolve to `null` and the comparison returns `false` —
 * callers must treat a malformed RSVP as unmatched rather than accidentally
 * equal via a string fast-path.
 */
export function isSameOccurrenceId(a: string | null | undefined, b: string | null | undefined): boolean {
  const am = occurrenceIdToMs(a);
  const bm = occurrenceIdToMs(b);
  return am !== null && bm !== null && am === bm;
}

/**
 * Return the effective occurrence id for a per-occurrence RSVP row, preferring
 * `rsvp.occurrence_id` and falling back to the suffix of the
 * `meeting_and_occurrence_id` composite (`${meeting_id}-${occurrence_id_ms}`)
 * when the direct field is empty.
 *
 * Every known write path (`mapITXResponseToMeetingRsvp` and the meeting-service
 * registrant handler) populates `occurrence_id` directly, but the query-service
 * `v1_meeting_rsvp` shape isn't provable from code — this defensive fallback
 * prevents a `single`/`this_and_following` row with only the composite from
 * silently dropping and degrading the chip to the `invite_accepted` fallback
 * (LFXV2-2864).
 */
function getRsvpOccurrenceId(rsvp: Pick<MeetingRsvp, 'occurrence_id' | 'meeting_and_occurrence_id'>): string | null {
  const direct = rsvp.occurrence_id;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const composite = rsvp.meeting_and_occurrence_id;
  if (typeof composite !== 'string' || composite.length === 0) return null;
  const idx = composite.lastIndexOf('-');
  if (idx < 0 || idx === composite.length - 1) return null;
  const suffix = composite.slice(idx + 1);
  return suffix.length > 0 ? suffix : null;
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
 * Algorithm: walk the user's RSVPs newest-first (by `modified_at` → `updated_at`
 * → `created_at`) and return the first one that is applicable to `occurrenceId`.
 * Applicability by scope:
 * - `all`: always applicable (series-wide).
 * - `single`: applicable iff `rsvp.occurrence_id` matches (unit-normalised).
 * - `this_and_following`: applicable iff the anchor occurrence (encoded in
 *   `rsvp.occurrence_id`) is at or before `occurrenceId`'s start.
 *
 * This is a "newest applicable wins" resolver, **not** a strict scope hierarchy —
 * a newer `all` will beat an older matching `single`, and a newer `single`
 * beats an older `this_and_following` on that specific occurrence. That mirrors
 * how Google Calendar / Zoom themselves resolve overlapping responses: the most
 * recent action the user took is the one that stands.
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
      if (isSameOccurrenceId(getRsvpOccurrenceId(rsvp), occurrenceId)) {
        return rsvp;
      }
      continue;
    }

    if (rsvp.scope === 'this_and_following') {
      // The anchor is the specific occurrence at which the T&F starts applying,
      // encoded in `rsvp.occurrence_id` (falling back to the composite suffix
      // when the direct field is empty — see `getRsvpOccurrenceId`).
      // Comparing against `rsvp.created_at` (the previous behaviour) drifts
      // whenever the row was written before or after the anchor date — e.g.
      // a retroactive T&F or a delayed sync. The anchor itself is the correct
      // semantic gate.
      const anchorMs = occurrenceIdToMs(getRsvpOccurrenceId(rsvp));
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
 * Calculate RSVP counts for a specific occurrence.
 *
 * Groups RSVPs by registrant, resolves each user's applicable RSVP for the
 * occurrence via {@link selectApplicableRsvp} (scope-aware, unit-normalised),
 * and tallies the resulting `response_type` values.
 *
 * @param occurrence - The meeting occurrence to calculate for (or null for non-recurring meetings)
 * @param allRsvps - All RSVPs for the meeting
 * @returns Object with accepted, declined, maybe, and total counts
 */
export function calculateRsvpCounts(occurrence: MeetingOccurrence | null, allRsvps: MeetingRsvp[]): RsvpCounts {
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

export type RegistrantAttendanceStatus = 'accepted' | 'declined' | 'maybe' | 'pending';

/**
 * Combined attendance status for a single registrant, mirroring the meeting-card
 * / guest-drawer chip logic and the meetings-dashboard RSVP filter:
 *
 * - An explicit RSVP `response_type` (accepted / declined / maybe) is authoritative.
 * - When there is no RSVP response — either the registrant has no RSVP at all,
 *   or none of their RSVPs are applicable to the target occurrence — fall back
 *   to `invite_accepted` (the series-level Google Calendar / Zoom invite state).
 * - Otherwise pending.
 *
 * The caller is responsible for pre-resolving the passed-in `rsvp` (typically
 * via {@link selectApplicableRsvp} against the target occurrence) — this helper
 * doesn't know about scopes.
 */
export function getRegistrantAttendanceStatus(registrant: {
  rsvp?: { response_type?: string | null } | null;
  invite_accepted?: boolean | null;
}): RegistrantAttendanceStatus {
  const rsvpResponse = registrant.rsvp?.response_type;
  if (rsvpResponse === 'accepted' || rsvpResponse === 'declined' || rsvpResponse === 'maybe') {
    return rsvpResponse;
  }
  if (registrant.invite_accepted === true) return 'accepted';
  if (registrant.invite_accepted === false) return 'declined';
  return 'pending';
}

/**
 * Tally attendance across a list of registrants using the same combined
 * semantics as {@link getRegistrantAttendanceStatus} (RSVP + `invite_accepted`
 * fallback). Use this instead of {@link calculateRsvpCounts} when the caller
 * has registrants in hand — otherwise a registrant with no applicable RSVP
 * but `invite_accepted === false` is invisible to the count even though their
 * chip renders as "declined" (LFXV2-2864).
 *
 * The caller must pre-resolve each registrant's `.rsvp` to the one applicable
 * to the target occurrence — the BFF's occurrence-aware
 * `getMeetingRegistrants(uid, includeRsvp, occurrenceId)` does that server-side.
 *
 * `total` counts every registrant (accepted + declined + maybe + pending), so
 * the denominator matches the meeting's invited count.
 */
export function countRegistrantAttendance(
  registrants: ReadonlyArray<{ rsvp?: { response_type?: string | null } | null; invite_accepted?: boolean | null }>
): RsvpCounts {
  const counts: RsvpCounts = { accepted: 0, declined: 0, maybe: 0, total: registrants.length };
  for (const r of registrants) {
    const status = getRegistrantAttendanceStatus(r);
    if (status === 'accepted') counts.accepted++;
    else if (status === 'declined') counts.declined++;
    else if (status === 'maybe') counts.maybe++;
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
